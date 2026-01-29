import * as vscode from "vscode";
import * as fs from "node:fs";

import { RpcClient, type CoreEdge, type CoreGraph, type CoreNode, type CorePosition } from "./rpcClient";
import { prepareUiGraph, extractTopLevelFunction, validateSpecProps } from "../../ui/src/logic";
import { PortSpec } from "../../ui/src/ports";

type WebviewToExtensionMessage =
  | {
      type: "ui.ready";
    }
  | {
      type: "ui.nodesChanged";
      nodes: Array<{ id: string; position: { x: number; y: number } }>;
    }
  | {
      type: "ui.edgeCreated";
      edge: { source: string; target: string; sourcePort?: string | null; targetPort?: string | null };
    }
  | {
      type: "ui.nodeCreated";
      node: {
        id: string;
        type: string;
        label: string;
        inputs: Array<{ id: string; kind?: PortKind | null; label?: string | null; multi?: boolean | null }>;
        outputs: Array<{ id: string; kind?: PortKind | null; label?: string | null; multi?: boolean | null }>;
        props?: Record<string, unknown> | null;
      };
      position?: { x: number; y: number } | null;
    }
  | {
      type: "ui.node.aiRequest";
      nodeId: string;
      instruction: string;
    }
  | {
      type: "ui.node.describeRequest";
      nodeId: string;
    }
  | {
      type: "ui.node.deleteRequest";
      nodeId: string;
    }
  | {
      type: "ui.node.patchRequest";
      nodeId: string;
      props?: Record<string, unknown> | null;
      label?: string | null;
    }
  | {
      type: "ui.workflow.run";
      workflowName: string;
    }
  | {
      type: "rpc.stop";
    };

type ExtensionToWebviewMessage =
  | {
      type: "graph.init";
      nodes: Array<{
        id: string;
        name: string;
        kind: "node" | "workflow" | "spec";
        position?: { x: number; y: number } | null;
        label?: string;
        nodeType?: string;
        summary?: string;
        badges?: string[];
        ports?: PortSpec[];
      }>;
      edges: Array<{ source: string; target: string; sourcePort?: string | null; targetPort?: string | null; kind?: "code" | "link" }>;
    }
  | {
      type: "graph.update";
      nodes: Array<{
        id: string;
        name: string;
        kind: "node" | "workflow" | "spec";
        position?: { x: number; y: number } | null;
        label?: string;
        nodeType?: string;
        summary?: string;
        badges?: string[];
        ports?: PortSpec[];
      }>;
      edges: Array<{ source: string; target: string; sourcePort?: string | null; targetPort?: string | null; kind?: "code" | "link" }>;
    }
  | {
      type: "graph.error";
      error: string;
    }
  | {
      type: "ai.status";
      nodeId: string;
      status: "idle" | "working" | "error" | "done";
      message?: string;
    }
  | {
      type: "execution.output";
      output: Record<string, unknown>;
    };

export class HolonPanel {
  public static currentPanel: HolonPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private rpc: RpcClient | undefined;
  private readonly extensionUri: vscode.Uri;
  private readonly output: vscode.OutputChannel;

  private readonly positions = new Map<string, CorePosition>();
  private readonly annotations = new Map<string, { summary?: string; badges?: string[] }>();
  private lastGraph: CoreGraph | undefined;
  private hasSentGraph = false;

  private readonly parseTimers = new Map<string, NodeJS.Timeout>();
  private readonly parseVersions = new Map<string, number>();

  private lastHolonDocumentUri: vscode.Uri | undefined;

  private readonly workspaceRoot: vscode.Uri | undefined;
  private positionsSaveTimer: NodeJS.Timeout | undefined;
  private annotationsSaveTimer: NodeJS.Timeout | undefined;

  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (HolonPanel.currentPanel) {
      // Also refresh HTML so rebuilt UI assets are picked up during development.
      HolonPanel.currentPanel.reloadWebviewHtml();
      HolonPanel.currentPanel.panel.reveal(column);
      return;
    }

    const uiDist = vscode.Uri.joinPath(extensionUri, "..", "ui", "dist");

    const panel = vscode.window.createWebviewPanel(
      "holon",
      "Holon",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri, uiDist],
      }
    );

    HolonPanel.currentPanel = new HolonPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.output = vscode.window.createOutputChannel("Holon");

    this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    this.output.appendLine(`workspaceRoot: ${this.workspaceRoot?.fsPath ?? "<none>"}`);

    this.output.show(true);
    this.output.appendLine("HolonPanel: created");

    this.panel.webview.html = this.getHtml(this.panel.webview, extensionUri);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message: WebviewToExtensionMessage) => {
        try {
          // Helpful for diagnosing message flow issues.
          const t = (message as unknown as { type?: unknown }).type;
          this.output.appendLine(`webview->ext: ${typeof t === "string" ? t : "<no type>"}`);
        } catch {
          // ignore
        }

        switch (message.type) {
          case "ui.ready":
            await this.onUiReady();
            return;
          case "ui.nodesChanged":
            this.onUiNodesChanged(message.nodes);
            return;
          case "ui.edgeCreated":
            await this.onUiEdgeCreated(message.edge);
            return;
          case "ui.nodeCreated":
            await this.onUiNodeCreated(message.node, message.position ?? null);
            return;
          case "ui.node.aiRequest":
            await this.onUiAiRequest(message.nodeId, message.instruction);
            return;
          case "ui.node.describeRequest":
            await this.onUiDescribeRequest(message.nodeId);
            return;
          case "ui.node.deleteRequest":
            await this.onUiDeleteRequest(message.nodeId);
            return;
          case "ui.node.patchRequest":
            await this.onUiPatchRequest(message.nodeId, message.props ?? null, message.label ?? null);
            return;
          case "ui.workflow.run":
            await this.onUiWorkflowRun(message.workflowName);
            return;
          case "rpc.stop":
            await this.onStop();
            return;
          default:
            this.output.appendLine(`webview->ext: unknown message`);
            return;
        }
      },
      null,
      this.disposables
    );
  }

  public reloadWebviewHtml(): void {
    try {
      this.panel.webview.html = this.getHtml(this.panel.webview, this.extensionUri);
      this.output.appendLine("HolonPanel: webview HTML reloaded");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`HolonPanel: failed to reload webview HTML: ${message}`);
    }
  }

  public dispose(): void {
    HolonPanel.currentPanel = undefined;

    void this.onStop();

    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }

  private async onUiReady(): Promise<void> {
    this.output.appendLine("UI: ready");
    try {
      await this.ensureRpc();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`RPC start error: ${message}`);
      this.postMessage({ type: "graph.error", error: message });
      return;
    }

    // Bind document listeners once the UI is ready.
    this.bindEditorWatchers();

    // Parse the current active editor if it's a holon file.
    const active = vscode.window.activeTextEditor?.document;
    if (active && isHolonDocument(active)) {
      this.scheduleParse(active, { reason: "ui.ready" });
      return;
    }

    // No holon file open; render empty state.
    this.hasSentGraph = true;
    this.postMessage({ type: "graph.init", nodes: [], edges: [] });
  }

  private onUiNodesChanged(nodes: Array<{ id: string; position: { x: number; y: number } }>): void {
    this.output.appendLine(`ui.nodesChanged: ${nodes.length}`);

    // If we haven't parsed yet (or lastHolonDocumentUri wasn't set for some reason),
    // infer the target from the active editor.
    if (!this.lastHolonDocumentUri) {
      const active = vscode.window.activeTextEditor?.document;
      if (active && isHolonDocument(active)) {
        this.lastHolonDocumentUri = active.uri;
        this.output.appendLine(`lastHolonDocumentUri inferred: ${active.uri.fsPath}`);
      } else {
        this.output.appendLine("positions warning: no holon document to persist for");
      }
    }

    for (const n of nodes) {
      this.positions.set(n.id, { x: n.position.x, y: n.position.y });
    }

    this.schedulePersistPositions();

    // Re-emit the last graph with updated positions.
    if (this.lastGraph) {
      this.postGraphUpdate(this.lastGraph);
    }
  }

  private async onUiEdgeCreated(edge: {
    source: string;
    target: string;
    sourcePort?: string | null;
    targetPort?: string | null;
  }): Promise<void> {
    this.output.appendLine(`ui.edgeCreated: ${edge.source} -> ${edge.target}`);

    if (!this.lastHolonDocumentUri) {
      const active = vscode.window.activeTextEditor?.document;
      if (active && isHolonDocument(active)) {
        this.lastHolonDocumentUri = active.uri;
      }
    }
    if (!this.lastHolonDocumentUri) {
      this.output.appendLine("edge persist warning: no holon document to persist for");
      return;
    }

    const sourcePort = edge.sourcePort ?? "output";
    const targetPort = edge.targetPort ?? "input";

    const targetUri = this.lastHolonDocumentUri;
    const doc = await vscode.workspace.openTextDocument(targetUri);
    const editor =
      vscode.window.activeTextEditor?.document.uri.toString() === targetUri.toString()
        ? vscode.window.activeTextEditor
        : await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });

    const source = doc.getText();
    const rpc = await this.ensureRpc();
    const workflowName = pickWorkflowName(this.lastGraph);
    if (!workflowName) {
      this.output.appendLine("edge add warning: no workflow found");
      return;
    }
    const updated = await rpc.addLink(source, workflowName, edge.source, sourcePort, edge.target, targetPort);

    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(source.length));
    const ok = await editor.edit((editBuilder) => {
      editBuilder.replace(fullRange, updated);
    });
    if (!ok) {
      throw new Error("Editor rejected the edit");
    }
  }

  private async onUiNodeCreated(
    node: {
      id: string;
      type: string;
      label: string;
      inputs: Array<{ id: string; kind?: PortKind | null; label?: string | null; multi?: boolean | null }>;
      outputs: Array<{ id: string; kind?: PortKind | null; label?: string | null; multi?: boolean | null }>;
      props?: Record<string, unknown> | null;
    },
    position: { x: number; y: number } | null
  ): Promise<void> {
    this.output.appendLine(`ui.nodeCreated: ${node.id} (${node.type})`);

    if (!this.lastHolonDocumentUri) {
      const active = vscode.window.activeTextEditor?.document;
      if (active && isHolonDocument(active)) {
        this.lastHolonDocumentUri = active.uri;
      }
    }
    if (!this.lastHolonDocumentUri) {
      this.output.appendLine("node persist warning: no holon document to persist for");
      return;
    }

    const targetUri = this.lastHolonDocumentUri;
    const doc = await vscode.workspace.openTextDocument(targetUri);
    const editor =
      vscode.window.activeTextEditor?.document.uri.toString() === targetUri.toString()
        ? vscode.window.activeTextEditor
        : await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });

    const source = doc.getText();
    const rpc = await this.ensureRpc();
    const updated = await rpc.addSpecNode(source, node.id, node.type, node.label ?? null, node.props ?? null);

    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(source.length));
    const ok = await editor.edit((editBuilder) => {
      editBuilder.replace(fullRange, updated);
    });
    if (!ok) {
      throw new Error("Editor rejected the edit");
    }

    if (position) {
      this.positions.set(node.id, { x: position.x, y: position.y });
      this.schedulePersistPositions();
    }
  }

  private async onUiAiRequest(nodeId: string, instruction: string): Promise<void> {
    this.output.appendLine(`ui.node.aiRequest: ${nodeId} (${instruction.length} chars)`);

    if (!nodeId.startsWith("node:") && !nodeId.startsWith("spec:")) {
      this.postMessage({
        type: "ai.status",
        nodeId,
        status: "error",
        message: "AI patch is only supported for node:* and spec:*",
      });
      return;
    }

    const targetUri = this.lastHolonDocumentUri ?? vscode.window.activeTextEditor?.document?.uri;
    if (!targetUri) {
      this.postMessage({
        type: "ai.status",
        nodeId,
        status: "error",
        message: "No target document available to patch",
      });
      return;
    }

    const doc = await vscode.workspace.openTextDocument(targetUri);
    if (!isHolonDocument(doc)) {
      this.postMessage({
        type: "ai.status",
        nodeId,
        status: "error",
        message: "Target document is not a *.holon.py file",
      });
      return;
    }

    const editor =
      vscode.window.activeTextEditor?.document.uri.toString() === targetUri.toString()
        ? vscode.window.activeTextEditor
        : await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });

    const source = doc.getText();

    this.postMessage({ type: "ai.status", nodeId, status: "working", message: "Asking Copilot..." });

    try {
      const rpc = await this.ensureRpc();

      let updated: string;
      if (nodeId.startsWith("node:")) {
        const nodeName = nodeId.slice("node:".length);
        const functionCode = extractTopLevelFunction(source, nodeName);
        if (!functionCode) {
          this.postMessage({
            type: "ai.status",
            nodeId,
            status: "error",
            message: `Couldn't find function: ${nodeName}`,
          });
          return;
        }

        const replacement = await requestCopilotFunctionReplacement({
          output: this.output,
          functionCode,
          instruction,
          token: new vscode.CancellationTokenSource().token,
        });

        this.postMessage({ type: "ai.status", nodeId, status: "working", message: "Applying patch..." });
        updated = await rpc.patchNode(source, nodeName, replacement);
      } else {
        const specInfo = this.findNodeInfo(nodeId);
        const patch = await requestCopilotSpecPatch({
          output: this.output,
          nodeId,
          instruction,
          current: specInfo,
          token: new vscode.CancellationTokenSource().token,
        });

        const hasType = Object.prototype.hasOwnProperty.call(patch, "type");
        const hasLabel = Object.prototype.hasOwnProperty.call(patch, "label");
        const hasProps = Object.prototype.hasOwnProperty.call(patch, "props");

        if (!hasType && !hasLabel && !hasProps) {
          throw new Error("Copilot produced an empty spec patch (no fields)");
        }

        this.postMessage({ type: "ai.status", nodeId, status: "working", message: "Applying patch..." });
        updated = await rpc.patchSpecNode({
          source,
          nodeId,
          nodeType: hasType ? (typeof patch.type === "string" ? patch.type : null) : null,
          label: hasLabel ? (typeof patch.label === "string" ? patch.label : null) : null,
          props: hasProps ? (isRecord(patch.props) ? (patch.props as Record<string, unknown>) : null) : null,
          setNodeType: hasType,
          setLabel: hasLabel,
          setProps: hasProps,
        });
      }

      const fullRange = new vscode.Range(
        doc.positionAt(0),
        doc.positionAt(source.length)
      );

      const ok = await editor.edit((editBuilder) => {
        editBuilder.replace(fullRange, updated);
      });

      if (!ok) {
        throw new Error("Editor rejected the edit");
      }

      this.postMessage({ type: "ai.status", nodeId, status: "done", message: "Patched" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`AI patch error: ${message}`);
      this.postMessage({ type: "ai.status", nodeId, status: "error", message });
    }
  }

  private async onUiDescribeRequest(nodeId: string): Promise<void> {
    this.output.appendLine(`ui.node.describeRequest: ${nodeId}`);

    await this.describeNode(nodeId);
  }

  public async refreshAllDescriptions(): Promise<void> {
    const graph = this.lastGraph;
    if (!graph) {
      vscode.window.showInformationMessage("Holon: nothing to describe yet (open a *.holon.py file and run Holon: Open).");
      return;
    }

    const candidates = graph.nodes
      .map((n) => n.id)
      .filter((id) => typeof id === "string" && (id.startsWith("node:") || id.startsWith("spec:")));

    if (candidates.length === 0) {
      vscode.window.showInformationMessage("Holon: no nodes eligible for description.");
      return;
    }

    this.output.appendLine(`refreshAllDescriptions: ${candidates.length} nodes`);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Holon: Refreshing descriptions",
        cancellable: false,
      },
      async (progress) => {
        let completed = 0;
        for (const nodeId of candidates) {
          progress.report({
            message: `${completed + 1}/${candidates.length} - ${nodeId}`,
            increment: (100 / candidates.length),
          });
          try {
            await this.describeNode(nodeId);
            completed++;
          } catch {
            // describeNode already emits an ai.status error; keep going.
            completed++;
          }
        }
        progress.report({ message: "Done", increment: 100 });
      }
    );

    vscode.window.showInformationMessage(`Holon: Refreshed descriptions for ${candidates.length} nodes.`);
  }

  private async describeNode(nodeId: string): Promise<void> {
    const baseInfo = this.findNodeInfo(nodeId);
    const info = await this.enrichNodeInfoFromSource(nodeId, baseInfo);
    if (!info) {
      this.postMessage({ type: "ai.status", nodeId, status: "error", message: "Unknown nodeId" });
      throw new Error("Unknown nodeId");
    }

    this.postMessage({ type: "ai.status", nodeId, status: "working", message: "Asking Copilot..." });

    try {
      const description = await requestCopilotNodeDescription({
        output: this.output,
        nodeId,
        info,
        token: new vscode.CancellationTokenSource().token,
      });

      this.annotations.set(nodeId, description);
      this.schedulePersistAnnotations();

      if (this.lastGraph) {
        this.postGraphUpdate(this.lastGraph);
      }

      this.postMessage({ type: "ai.status", nodeId, status: "done", message: "Described" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`AI describe error: ${message}`);
      this.postMessage({ type: "ai.status", nodeId, status: "error", message });
      throw err;
    }
  }

  private async onStop(): Promise<void> {
    for (const timer of this.parseTimers.values()) {
      clearTimeout(timer);
    }
    this.parseTimers.clear();

    if (this.positionsSaveTimer) {
      clearTimeout(this.positionsSaveTimer);
      this.positionsSaveTimer = undefined;
    }

    if (this.annotationsSaveTimer) {
      clearTimeout(this.annotationsSaveTimer);
      this.annotationsSaveTimer = undefined;
    }

    const rpc = this.rpc;
    this.rpc = undefined;
    if (rpc) {
      await rpc.stop();
    }
  }

  private async onUiDeleteRequest(nodeId: string): Promise<void> {
    this.output.appendLine(`ui.node.deleteRequest: ${nodeId}`);

    if (!(nodeId.startsWith("node:") || nodeId.startsWith("spec:"))) {
      this.postMessage({ type: "ai.status", nodeId, status: "error", message: "Delete supports node:* and spec:* only." });
      return;
    }

    const targetUri = this.lastHolonDocumentUri ?? vscode.window.activeTextEditor?.document.uri;
    if (!targetUri) {
      this.postMessage({ type: "ai.status", nodeId, status: "error", message: "No active Holon document." });
      return;
    }

    const doc = await vscode.workspace.openTextDocument(targetUri);
    const editor =
      vscode.window.activeTextEditor?.document.uri.toString() === targetUri.toString()
        ? vscode.window.activeTextEditor
        : await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });

    const source = doc.getText();
    this.postMessage({ type: "ai.status", nodeId, status: "working", message: "Deleting..." });

    try {
      const rpc = await this.ensureRpc();
      const updated = await rpc.deleteNode(source, nodeId);

      const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(source.length));
      const ok = await editor.edit((editBuilder) => {
        editBuilder.replace(fullRange, updated);
      });
      if (!ok) {
        throw new Error("Editor rejected the edit");
      }

      // Drop UI-only metadata.
      this.positions.delete(nodeId);
      this.annotations.delete(nodeId);
      this.schedulePersistPositions();
      this.schedulePersistAnnotations();

      // Refresh graph (parser watcher will also run, but this is immediate).
      this.scheduleParse(doc, { reason: "ui.node.deleteRequest" });

      this.postMessage({ type: "ai.status", nodeId, status: "done", message: "Deleted" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`Delete error: ${message}`);
      this.postMessage({ type: "ai.status", nodeId, status: "error", message });
    }
  }

  private async onUiPatchRequest(
    nodeId: string,
    props: Record<string, unknown> | null,
    label: string | null
  ): Promise<void> {
    this.output.appendLine(`ui.node.patchRequest: ${nodeId}`);

    if (!nodeId.startsWith("spec:")) {
      return;
    }

    const targetUri = this.lastHolonDocumentUri ?? vscode.window.activeTextEditor?.document?.uri;
    if (!targetUri) {
      return;
    }

    const doc = await vscode.workspace.openTextDocument(targetUri);
    const editor =
      vscode.window.activeTextEditor?.document.uri.toString() === targetUri.toString()
        ? vscode.window.activeTextEditor
        : await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });

    const source = doc.getText();
    const rpc = await this.ensureRpc();

    const updated = await rpc.patchSpecNode({
      source,
      nodeId,
      label: label,
      props: props,
      setNodeType: false,
      setLabel: label !== null,
      setProps: props !== null,
    });

    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(source.length));
    const ok = await editor.edit((editBuilder) => {
      editBuilder.replace(fullRange, updated);
    });
    if (!ok) {
      throw new Error("Editor rejected the edit");
    }
  }

  private async onUiWorkflowRun(workflowName: string): Promise<void> {
    this.output.appendLine(`ui.workflow.run: ${workflowName}`);

    const targetUri = this.lastHolonDocumentUri ?? vscode.window.activeTextEditor?.document?.uri;
    if (!targetUri) {
      this.postMessage({ type: "execution.output", output: { error: "No active holon file" } });
      return;
    }

    const rpc = await this.ensureRpc();
    try {
      const result = await rpc.executeWorkflow({
        filePath: targetUri.fsPath,
        workflowName: workflowName,
      });
      // Normalize output to an object so the UI Zod schema accepts it,
      // and key it by the workflow node id expected by the UI (`workflow:<name>`).
      let out: unknown = result;
      if (isObject(result) && Object.prototype.hasOwnProperty.call(result, "output")) {
        out = (result as Record<string, unknown>)["output"];
      }
      if (!isObject(out)) {
        out = { result: out };
      }
      const key = `workflow:${workflowName}`;
      this.postMessage({ type: "execution.output", output: { [key]: out as Record<string, unknown> } });
    } catch (error) {
      this.postMessage({
        type: "execution.output",
        output: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private postMessage(message: ExtensionToWebviewMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private async ensureRpc(): Promise<RpcClient> {
    if (!this.rpc) {
      this.rpc = await RpcClient.start(this.extensionUri, this.output);
    }
    return this.rpc;
  }

  private bindEditorWatchers(): void {
    if (this.disposables.some((d) => (d as unknown as { __holonWatch?: boolean }).__holonWatch)) {
      return;
    }

    const mark = <T extends vscode.Disposable>(d: T): T => {
      (d as unknown as { __holonWatch?: boolean }).__holonWatch = true;
      return d;
    };

    this.disposables.push(
      mark(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
          const doc = editor?.document;
          if (!doc || !isHolonDocument(doc)) {
            return;
          }
          this.scheduleParse(doc, { reason: "activeEditorChanged" });
        })
      )
    );

    this.disposables.push(
      mark(
        vscode.workspace.onDidChangeTextDocument((event) => {
          const doc = event.document;
          if (!isHolonDocument(doc)) {
            return;
          }
          this.scheduleParse(doc, { reason: "textChanged" });
        })
      )
    );
  }

  private scheduleParse(document: vscode.TextDocument, input: { reason: string }): void {
    const uriKey = document.uri.toString();

    const next = (this.parseVersions.get(uriKey) ?? 0) + 1;
    this.parseVersions.set(uriKey, next);

    const existing = this.parseTimers.get(uriKey);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      void this.parseNow(document.uri, next, input.reason);
    }, 320);

    this.parseTimers.set(uriKey, timer);
  }

  private async parseNow(uri: vscode.Uri, version: number, reason: string): Promise<void> {
    const uriKey = uri.toString();
    const latest = this.parseVersions.get(uriKey);
    if (latest !== version) {
      return;
    }

    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uriKey);
    if (!doc) {
      return;
    }

    if (isHolonDocument(doc)) {
      this.lastHolonDocumentUri = doc.uri;

      // Load persisted positions for this document and merge into the in-memory map.
      try {
        const persisted = await this.loadPersistedPositions(doc.uri);
        for (const [id, pos] of Object.entries(persisted)) {
          this.positions.set(id, pos);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.output.appendLine(`positions load warning: ${message}`);
      }

      // Load persisted annotations for this document and merge into the in-memory map.
      try {
        const persisted = await this.loadPersistedAnnotations(doc.uri);
        for (const [id, ann] of Object.entries(persisted)) {
          this.annotations.set(id, ann);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.output.appendLine(`annotations load warning: ${message}`);
      }

    }

    try {
      const rpc = await this.ensureRpc();
      const graph = await rpc.parseSource(doc.getText());

      // Drop stale responses.
      const stillLatest = this.parseVersions.get(uriKey);
      if (stillLatest !== version) {
        return;
      }

      this.output.appendLine(`parse_source ok (${reason}): nodes=${graph.nodes.length} edges=${graph.edges.length}`);
      this.lastGraph = graph;
      this.postGraphInitOrUpdate(graph);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`parse_source error: ${message}`);
      this.postMessage({ type: "graph.error", error: message });
    }
  }

  private postGraphInitOrUpdate(graph: CoreGraph): void {
    const { nodes, edges } = this.buildMergedGraph(graph);

    if (!this.hasSentGraph) {
      this.hasSentGraph = true;
      this.postMessage({ type: "graph.init", nodes, edges });
      return;
    }

    this.postGraphUpdate(graph);
  }

  private postGraphUpdate(graph: CoreGraph): void {
    const { nodes, edges } = this.buildMergedGraph(graph);
    this.postMessage({ type: "graph.update", nodes, edges });
  }

  private mergePosition(n: CoreNode): CoreNode {
    const stored = this.positions.get(n.id);
    if (!stored) {
      return n;
    }
    return { ...n, position: stored };
  }

  private mergePositionById(id: string, position: CorePosition | null | undefined): CorePosition | null | undefined {
    const stored = this.positions.get(id);
    if (stored) {
      return stored;
    }
    return position;
  }

  private buildMergedGraph(graph: CoreGraph): {
    nodes: Array<{
      id: string;
      name: string;
      kind: "node" | "workflow" | "spec";
      position?: { x: number; y: number } | null;
      label?: string;
      nodeType?: string;
      summary?: string;
      badges?: string[];
      ports?: PortSpec[];
    }>;
    edges: Array<{ source: string; target: string; sourcePort?: string | null; targetPort?: string | null; kind?: "code" | "link" }>;
  } {
    const positions = Object.fromEntries(this.positions.entries());
    const annotations = Object.fromEntries(this.annotations.entries());

    const { nodes, edges } = prepareUiGraph(graph, positions, annotations);

    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        name: n.name,
        kind: n.kind,
        label: n.label || `${n.kind}: ${n.name}`,
        position: n.position ?? null,
        ...(n.nodeType ? { nodeType: n.nodeType } : {}),
        ...(n.summary ? { summary: n.summary } : {}),
        ...(n.badges ? { badges: n.badges } : {}),
        ...(n.ports ? { ports: n.ports } : {}),
      })),
      edges,
    };
  }

  private findNodeInfo(nodeId: string): NodeInfo | undefined {
    const graph = this.lastGraph;
    if (!graph) {
      return undefined;
    }
    const n = graph.nodes.find((x) => x.id === nodeId);
    if (!n) {
      return undefined;
    }

    const label = (n as unknown as { label?: string | null }).label;
    const nodeType =
      (n as unknown as { node_type?: string | null; nodeType?: string | null }).node_type ??
      (n as unknown as { nodeType?: string | null }).nodeType;
    const props = (n as unknown as { props?: Record<string, unknown> | null }).props;

    return {
      id: n.id,
      name: n.name,
      kind: n.kind,
      ...(typeof label === "string" ? { label } : {}),
      ...(typeof nodeType === "string" ? { nodeType } : {}),
      ...(isRecord(props) ? { props } : {}),
    };
  }

  private async enrichNodeInfoFromSource(nodeId: string, info: NodeInfo | undefined): Promise<NodeInfo | undefined> {
    if (!info) {
      return undefined;
    }
    if (!nodeId.startsWith("node:")) {
      return info;
    }

    const targetUri = this.lastHolonDocumentUri ?? vscode.window.activeTextEditor?.document?.uri;
    if (!targetUri) {
      return info;
    }
    try {
      const doc = await vscode.workspace.openTextDocument(targetUri);
      if (!isHolonDocument(doc)) {
        return info;
      }
      const nodeName = nodeId.slice("node:".length);
      const functionCode = extractTopLevelFunction(doc.getText(), nodeName);
      if (!functionCode) {
        return info;
      }
      return { ...info, functionCode };
    } catch {
      return info;
    }
  }

  private schedulePersistPositions(): void {
    if (!this.lastHolonDocumentUri) {
      return;
    }
    if (this.positionsSaveTimer) {
      clearTimeout(this.positionsSaveTimer);
    }
    this.positionsSaveTimer = setTimeout(() => {
      void this.persistPositionsNow(this.lastHolonDocumentUri!).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.output.appendLine(`positions save error: ${message}`);
      });
    }, 250);
  }

  private async persistPositionsNow(docUri: vscode.Uri): Promise<void> {
    if (!this.workspaceRoot) {
      this.output.appendLine("positions save skipped: no workspace root");
      return;
    }
    const rel = vscode.workspace.asRelativePath(docUri, false);
    const store = await this.readPositionsStore();
    store.files[rel] = Object.fromEntries(this.positions.entries());
    await this.writePositionsStore(store);
    this.output.appendLine(`positions saved: ${rel}`);
  }

  private async loadPersistedPositions(docUri: vscode.Uri): Promise<Record<string, CorePosition>> {
    if (!this.workspaceRoot) {
      return {};
    }
    const rel = vscode.workspace.asRelativePath(docUri, false);
    const store = await this.readPositionsStore();
    return store.files[rel] ?? {};
  }

  private positionsStorePath(): vscode.Uri | undefined {
    if (!this.workspaceRoot) {
      return undefined;
    }
    return vscode.Uri.joinPath(this.workspaceRoot, ".holon", "positions.json");
  }

  private async readPositionsStore(): Promise<{ version: 1; files: Record<string, Record<string, CorePosition>> }> {
    const storeUri = this.positionsStorePath();
    if (!storeUri) {
      return { version: 1, files: {} };
    }

    try {
      const bytes = await vscode.workspace.fs.readFile(storeUri);
      const text = Buffer.from(bytes).toString("utf8");
      const parsed = JSON.parse(text) as unknown;
      if (!isPositionsStore(parsed)) {
        return { version: 1, files: {} };
      }
      return parsed;
    } catch {
      return { version: 1, files: {} };
    }
  }

  private async writePositionsStore(store: { version: 1; files: Record<string, Record<string, CorePosition>> }): Promise<void> {
    const storeUri = this.positionsStorePath();
    if (!storeUri || !this.workspaceRoot) {
      return;
    }

    this.output.appendLine(`positions store path: ${storeUri.fsPath}`);

    // Ensure .holon dir exists.
    const dir = vscode.Uri.joinPath(this.workspaceRoot, ".holon");
    try {
      await vscode.workspace.fs.stat(dir);
    } catch {
      await vscode.workspace.fs.createDirectory(dir);
    }

    const json = JSON.stringify(store, null, 2);
    await vscode.workspace.fs.writeFile(storeUri, Buffer.from(json, "utf8"));
  }

  private schedulePersistAnnotations(): void {
    if (!this.lastHolonDocumentUri) {
      return;
    }
    if (this.annotationsSaveTimer) {
      clearTimeout(this.annotationsSaveTimer);
    }
    this.annotationsSaveTimer = setTimeout(() => {
      void this.persistAnnotationsNow(this.lastHolonDocumentUri!).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.output.appendLine(`annotations save error: ${message}`);
      });
    }, 250);
  }

  private async persistAnnotationsNow(docUri: vscode.Uri): Promise<void> {
    if (!this.workspaceRoot) {
      this.output.appendLine("annotations save skipped: no workspace root");
      return;
    }
    const rel = vscode.workspace.asRelativePath(docUri, false);
    const store = await this.readAnnotationsStore();
    store.files[rel] = Object.fromEntries(this.annotations.entries());
    await this.writeAnnotationsStore(store);
    this.output.appendLine(`annotations saved: ${rel}`);
  }

  private async loadPersistedAnnotations(docUri: vscode.Uri): Promise<Record<string, { summary?: string; badges?: string[] }>> {
    if (!this.workspaceRoot) {
      return {};
    }
    const rel = vscode.workspace.asRelativePath(docUri, false);
    const store = await this.readAnnotationsStore();
    return store.files[rel] ?? {};
  }

  private annotationsStorePath(): vscode.Uri | undefined {
    if (!this.workspaceRoot) {
      return undefined;
    }
    return vscode.Uri.joinPath(this.workspaceRoot, ".holon", "annotations.json");
  }

  private async readAnnotationsStore(): Promise<{
    version: 1;
    files: Record<string, Record<string, { summary?: string; badges?: string[] }>>;
  }> {
    const storeUri = this.annotationsStorePath();
    if (!storeUri) {
      return { version: 1, files: {} };
    }

    try {
      const bytes = await vscode.workspace.fs.readFile(storeUri);
      const text = Buffer.from(bytes).toString("utf8");
      const parsed = JSON.parse(text) as unknown;
      if (!isAnnotationsStore(parsed)) {
        return { version: 1, files: {} };
      }
      return parsed;
    } catch {
      return { version: 1, files: {} };
    }
  }

  private async writeAnnotationsStore(store: {
    version: 1;
    files: Record<string, Record<string, { summary?: string; badges?: string[] }>>;
  }): Promise<void> {
    const storeUri = this.annotationsStorePath();
    if (!storeUri || !this.workspaceRoot) {
      return;
    }

    // Ensure .holon dir exists.
    const dir = vscode.Uri.joinPath(this.workspaceRoot, ".holon");
    try {
      await vscode.workspace.fs.stat(dir);
    } catch {
      await vscode.workspace.fs.createDirectory(dir);
    }

    const json = JSON.stringify(store, null, 2);
    await vscode.workspace.fs.writeFile(storeUri, Buffer.from(json, "utf8"));
  }


  private getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = getNonce();

    const uiDist = vscode.Uri.joinPath(extensionUri, "..", "ui", "dist");
    const indexPath = vscode.Uri.joinPath(uiDist, "index.html").fsPath;

    let html: string;
    try {
      html = fs.readFileSync(indexPath, { encoding: "utf8" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`UI load error: ${message}`);
      return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Holon</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; padding: 16px;">
    <h2>Holon UI not built</h2>
    <p>Couldn't read <code>ui/dist/index.html</code>.</p>
    <pre style="white-space: pre-wrap;">${escapeHtml(message)}</pre>
    <p>Build it with:</p>
    <pre>cd ui && npm install && npm run build</pre>
    <button id="stop">Stop Python</button>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      document.getElementById('stop').addEventListener('click', () => vscode.postMessage({ type: 'rpc.stop' }));
    </script>
  </body>
</html>`;
    }

    // Rewrite asset URLs like /assets/... or assets/... into webview URIs.
    html = html.replace(
      /(src|href)=("|')(\/assets\/[^"']+|assets\/[^"']+)("|')/g,
      (_match, attr: string, q1: string, assetPath: string, q2: string) => {
        const rel = assetPath.startsWith("/") ? assetPath.slice(1) : assetPath;
        const diskUri = vscode.Uri.joinPath(uiDist, ...rel.split("/"));
        const webUri = webview.asWebviewUri(diskUri);
        return `${attr}=${q1}${webUri.toString()}${q2}`;
      }
    );

    // Inject CSP suited for a Vite-built bundle.
    html = html.replace(
      /<meta http-equiv="Content-Security-Policy"[^>]*>/i,
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';">`
    );

    // If the built HTML doesn't already contain a CSP meta, add one.
    if (!/Content-Security-Policy/i.test(html)) {
      html = html.replace(
        /<head>/i,
        `<head>\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';">`
      );
    }

    // Add nonce to all script tags to satisfy CSP. (Safe for module scripts.)
    html = html.replace(/<script(\s)/g, `<script nonce="${nonce}"$1`);

    return html;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i += 1) {
    value += chars[Math.floor(Math.random() * chars.length)];
  }
  return value;
}

function isHolonDocument(doc: vscode.TextDocument): boolean {
  // Minimal matcher for **/*.holon.py
  return doc.uri.scheme === "file" && doc.fileName.endsWith(".holon.py");
}

function isPositionsStore(
  value: unknown
): value is { version: 1; files: Record<string, Record<string, CorePosition>> } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  if (v["version"] !== 1) {
    return false;
  }
  const files = v["files"];
  if (typeof files !== "object" || files === null) {
    return false;
  }
  for (const filePositions of Object.values(files as Record<string, unknown>)) {
    if (typeof filePositions !== "object" || filePositions === null) {
      return false;
    }
    for (const pos of Object.values(filePositions as Record<string, unknown>)) {
      if (typeof pos !== "object" || pos === null) {
        return false;
      }
      const p = pos as Record<string, unknown>;
      if (typeof p["x"] !== "number" || typeof p["y"] !== "number") {
        return false;
      }
    }
  }
  return true;
}

function isAnnotationsStore(
  value: unknown
): value is {
  version: 1;
  files: Record<string, Record<string, { summary?: string; badges?: string[] }>>;
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  if (v["version"] !== 1) {
    return false;
  }
  const files = v["files"];
  if (typeof files !== "object" || files === null) {
    return false;
  }

  for (const perFile of Object.values(files as Record<string, unknown>)) {
    if (typeof perFile !== "object" || perFile === null) {
      return false;
    }
    for (const ann of Object.values(perFile as Record<string, unknown>)) {
      if (typeof ann !== "object" || ann === null) {
        return false;
      }
      const a = ann as Record<string, unknown>;
      if (a["summary"] !== undefined && typeof a["summary"] !== "string") {
        return false;
      }
      if (a["badges"] !== undefined) {
        if (!Array.isArray(a["badges"])) {
          return false;
        }
        if (!(a["badges"] as unknown[]).every((b) => typeof b === "string")) {
          return false;
        }
      }
    }
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type NodeInfo = {
  id: string;
  name: string;
  kind: "node" | "workflow" | "spec";
  label?: string;
  nodeType?: string;
  props?: Record<string, unknown>;
  functionCode?: string;
};

type PortDirection = "input" | "output";
type PortKind = "data" | "llm" | "memory" | "tool" | "parser" | "control";

function pickWorkflowName(graph: CoreGraph | undefined): string | undefined {
  if (!graph) {
    return undefined;
  }
  const workflows = graph.nodes.filter((n) => n.kind === "workflow");
  const main = workflows.find((w) => w.name === "main");
  return main?.name ?? workflows[0]?.name;
}

async function requestCopilotFunctionReplacement(input: {
  output: vscode.OutputChannel;
  functionCode: string;
  instruction: string;
  token: vscode.CancellationToken;
}): Promise<string> {
  const lm = (vscode as unknown as { lm?: unknown }).lm;
  if (!isLmApi(lm)) {
    throw new Error("No VS Code LM API available (vscode.lm)");
  }

  const models = await lm.selectChatModels({ vendor: "copilot" });
  const model = models[0];
  if (!model) {
    throw new Error("No Copilot chat model available (consent not granted?)");
  }

  const system =
    "You are a code generator that outputs only Python function definitions. " +
    "Return ONLY the full replacement function definition, no markdown fences, no explanations.";

  const user =
    "Task: Modify the following Holon @node function.\n" +
    "Constraints:\n" +
    "- Preserve the function name and signature exactly\n" +
    "- Do not rename unrelated symbols\n" +
    "- Output only the function definition\n\n" +
    `User instruction:\n${input.instruction.trim()}\n\n` +
    `Current function code:\n${input.functionCode}`;

  input.output.appendLine("LM: sending request to copilot...");

  const response = await model.sendRequest(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    {},
    input.token
  );

  const text = await readLmResponseText(response);
  const cleaned = stripMarkdownFences(text).trimEnd() + "\n";
  if (!/^(async\s+def|def)\s+\w+\s*\(/m.test(cleaned)) {
    throw new Error("Copilot response did not look like a function definition");
  }
  return cleaned;
}

async function requestCopilotNodeDescription(input: {
  output: vscode.OutputChannel;
  nodeId: string;
  info: NodeInfo;
  token: vscode.CancellationToken;
}): Promise<{ summary?: string; badges?: string[] }> {
  const system =
    "You are a UI assistant that produces a compact description of a node. " +
    "Return ONLY valid JSON, no markdown, no explanations. " +
    "Schema: {summary: string, badges: string[]}. " +
    "Badges are freeform short strings (can include icons/emoji). " +
    "Badge style guide (optional but encouraged): prefer consistent categories like " +
    "'kind:compute', 'kind:io', 'kind:llm', 'kind:memory', 'kind:tool', 'kind:parse', 'risk:side-effects', 'perf:heavy'.";

  const contextParts: string[] = [];
  contextParts.push(`nodeId: ${input.nodeId}`);
  contextParts.push(`kind: ${input.info.kind}`);
  contextParts.push(`name: ${input.info.name}`);
  if (input.info.label) contextParts.push(`label: ${input.info.label}`);
  if (input.info.nodeType) contextParts.push(`type: ${input.info.nodeType}`);
  if (input.info.props) contextParts.push(`props: ${JSON.stringify(input.info.props)}`);
  if (input.info.functionCode) contextParts.push(`functionCode:\n${input.info.functionCode}`);

  const user =
    "Describe this Holon node for display in a graph UI.\n" +
    "Constraints:\n" +
    "- summary: one sentence, <= 140 chars\n" +
    "- badges: 0..6 items, each <= 20 chars\n" +
    "- Output ONLY JSON\n\n" +
    contextParts.join("\n");

  const obj = await requestCopilotJsonObject({ output: input.output, system, user, token: input.token });
  const summary = typeof obj["summary"] === "string" ? obj["summary"] : undefined;
  const badgesRaw = obj["badges"];
  const badges = Array.isArray(badgesRaw) ? badgesRaw.filter((b) => typeof b === "string") : undefined;
  return { ...(summary ? { summary } : {}), ...(badges ? { badges } : {}) };
}

type SpecPatch = { type?: unknown; label?: unknown; props?: unknown };

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function validateSpecPatch(patch: Record<string, unknown>, currentType?: string | undefined): SpecPatch {
  const allowed = new Set(["type", "label", "props"]);
  const unknownKeys = Object.keys(patch).filter((k) => !allowed.has(k));
  if (unknownKeys.length) {
    throw new Error(`Copilot spec patch contained unknown keys: ${unknownKeys.join(", ")}. Allowed keys: type, label, props.`);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "type")) {
    if (typeof patch["type"] !== "string" || patch["type"].trim().length === 0) {
      throw new Error(`Spec patch key 'type' must be a non-empty string (got ${describeType(patch["type"])})`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, "label")) {
    const v = patch["label"];
    if (!(typeof v === "string" || v === null)) {
      throw new Error(`Spec patch key 'label' must be a string or null (got ${describeType(v)})`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, "props")) {
    const v = patch["props"];
    if (!(isRecord(v) || v === null)) {
      throw new Error(`Spec patch key 'props' must be an object or null (got ${describeType(v)})`);
    }

    // Optional: validate some known types to avoid common bad outputs.
    const typeToCheck = (typeof patch["type"] === "string" ? (patch["type"] as string) : currentType) ?? undefined;
    if (typeToCheck && v !== null && isRecord(v)) {
      validateSpecProps(typeToCheck, v);
    }
  }

  return patch as SpecPatch;
}

async function requestCopilotSpecPatch(input: {
  output: vscode.OutputChannel;
  nodeId: string;
  instruction: string;
  current: NodeInfo | undefined;
  token: vscode.CancellationToken;
}): Promise<SpecPatch> {
  const system =
    "You are a code-edit assistant that outputs ONLY JSON patches for Holon spec(...) nodes. " +
    "Return ONLY valid JSON object, no markdown. " +
    "Allowed keys: type, label, props. " +
    "Omit keys you don't want to change. " +
    "Values: type is string, label is string|null, props is object|null.";

  const current = input.current;
  const user =
    "We are editing a single spec(...) node in Python code.\n" +
    "Return a JSON object describing the changes.\n\n" +
    `nodeId: ${input.nodeId}\n` +
    (current?.nodeType ? `current.type: ${current.nodeType}\n` : "") +
    (current?.label ? `current.label: ${current.label}\n` : "") +
    (current?.props ? `current.props: ${JSON.stringify(current.props)}\n` : "") +
    `User instruction: ${input.instruction.trim()}\n`;

  const obj = await requestCopilotJsonObject({ output: input.output, system, user, token: input.token });

  // Validate contracts eagerly so we can show actionable errors before patching.
  return validateSpecPatch(obj, input.current?.nodeType);
}

async function requestCopilotJsonObject(input: {
  output: vscode.OutputChannel;
  system: string;
  user: string;
  token: vscode.CancellationToken;
}): Promise<Record<string, unknown>> {
  const lm = (vscode as unknown as { lm?: unknown }).lm;
  if (!isLmApi(lm)) {
    throw new Error("No VS Code LM API available (vscode.lm)");
  }

  const models = await lm.selectChatModels({ vendor: "copilot" });
  const model = models[0];
  if (!model) {
    throw new Error("No Copilot chat model available (consent not granted?)");
  }

  const response = await model.sendRequest(
    [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
    {},
    input.token
  );

  const text = await readLmResponseText(response);
  const cleaned = stripMarkdownFences(text).trim();

  const parsed = parseJsonObjectLenient(cleaned);
  if (!isRecord(parsed)) {
    throw new Error("Copilot response was not a JSON object");
  }
  return parsed;
}

function parseJsonObjectLenient(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    // Best-effort: extract first {...} block.
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      const slice = value.slice(start, end + 1);
      try {
        return JSON.parse(slice);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

type LmApi = {
  selectChatModels: (options: { vendor: string }) => Thenable<LmChatModel[]>;
};

type LmChatModel = {
  sendRequest: (
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    options: unknown,
    token: vscode.CancellationToken
  ) => Thenable<unknown>;
};

function isLmApi(value: unknown): value is LmApi {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return typeof v["selectChatModels"] === "function";
}

async function readLmResponseText(response: unknown): Promise<string> {
  // Common shapes across VS Code LM API versions.
  if (typeof response === "string") {
    return response;
  }
  if (typeof response === "object" && response !== null) {
    const r = response as Record<string, unknown>;
    if (typeof r["text"] === "string") {
      return r["text"];
    }

    // Some APIs expose `content` as an array of parts.
    const content = r["content"];
    if (Array.isArray(content)) {
      return content
        .map((p) => {
          if (typeof p === "string") {
            return p;
          }
          if (typeof p === "object" && p !== null) {
            const pp = p as Record<string, unknown>;
            if (typeof pp["text"] === "string") {
              return pp["text"];
            }
            if (typeof pp["value"] === "string") {
              return pp["value"];
            }
          }
          return "";
        })
        .join("");
    }
  }
  throw new Error("Unsupported LM response shape");
}

function stripMarkdownFences(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return value;
  }

  // Remove a single fenced block if present.
  const lines = trimmed.split(/\r?\n/);
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (
    lines.length >= 2 &&
    typeof first === "string" &&
    typeof last === "string" &&
    first.startsWith("```") &&
    last.startsWith("```")
  ) {
    return lines.slice(1, -1).join("\n");
  }
  return value;
}
