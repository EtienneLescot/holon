import * as vscode from "vscode";
import * as fs from "node:fs";

import { RpcClient, type CoreEdge, type CoreGraph, type CoreNode, type CorePosition } from "./rpcClient";

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
    };

export class HolonPanel {
  public static currentPanel: HolonPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private rpc: RpcClient | undefined;
  private readonly extensionUri: vscode.Uri;
  private readonly output: vscode.OutputChannel;

  private readonly positions = new Map<string, CorePosition>();
  private lastGraph: CoreGraph | undefined;
  private hasSentGraph = false;

  private metaNodes: NodeSpec[] = [];
  private metaEdges: EdgeSpec[] = [];

  private readonly parseTimers = new Map<string, NodeJS.Timeout>();
  private readonly parseVersions = new Map<string, number>();

  private lastHolonDocumentUri: vscode.Uri | undefined;

  private readonly workspaceRoot: vscode.Uri | undefined;
  private positionsSaveTimer: NodeJS.Timeout | undefined;

  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (HolonPanel.currentPanel) {
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

    const spec: EdgeSpec = {
      sourceNodeId: edge.source,
      sourcePort,
      targetNodeId: edge.target,
      targetPort,
    };

    // Deduplicate in-memory.
    const key = `${spec.sourceNodeId}:${spec.sourcePort}->${spec.targetNodeId}:${spec.targetPort}`;
    const existingKeys = new Set(
      this.metaEdges.map((e) => `${e.sourceNodeId}:${e.sourcePort}->${e.targetNodeId}:${e.targetPort}`)
    );
    if (!existingKeys.has(key)) {
      this.metaEdges = [...this.metaEdges, spec];
    }

    // Persist to store.
    await this.persistGraphNow(this.lastHolonDocumentUri);

    // Re-emit graph with updated edges.
    if (this.lastGraph) {
      this.postGraphUpdate(this.lastGraph);
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

    const spec: NodeSpec = {
      id: node.id,
      type: node.type,
      label: node.label,
      inputs: node.inputs.map((p) => ({
        id: p.id,
        ...(p.kind ? { kind: p.kind } : {}),
        ...(p.label ? { label: p.label } : {}),
        ...(typeof p.multi === "boolean" ? { multi: p.multi } : {}),
      })),
      outputs: node.outputs.map((p) => ({
        id: p.id,
        ...(p.kind ? { kind: p.kind } : {}),
        ...(p.label ? { label: p.label } : {}),
        ...(typeof p.multi === "boolean" ? { multi: p.multi } : {}),
      })),
      props: node.props ?? {},
    };

    const existing = new Set(this.metaNodes.map((n) => n.id));
    if (!existing.has(spec.id)) {
      this.metaNodes = [...this.metaNodes, spec];
    }

    if (position) {
      this.positions.set(spec.id, { x: position.x, y: position.y });
      this.schedulePersistPositions();
    }

    await this.persistGraphNow(this.lastHolonDocumentUri);

    if (this.lastGraph) {
      this.postGraphUpdate(this.lastGraph);
    } else {
      // If we haven't parsed yet, still show the metadata node(s).
      this.hasSentGraph = true;
      const merged = this.buildMergedGraph({ nodes: [], edges: [] });
      this.postMessage({ type: "graph.init", nodes: merged.nodes, edges: merged.edges });
    }
  }

  private async onUiAiRequest(nodeId: string, instruction: string): Promise<void> {
    this.output.appendLine(`ui.node.aiRequest: ${nodeId} (${instruction.length} chars)`);

    if (!nodeId.startsWith("node:")) {
      this.postMessage({
        type: "ai.status",
        nodeId,
        status: "error",
        message: "AI patch is only supported for node:*",
      });
      return;
    }

    const nodeName = nodeId.slice("node:".length);
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

    this.postMessage({ type: "ai.status", nodeId, status: "working", message: "Asking Copilot..." });

    try {
      const replacement = await requestCopilotFunctionReplacement({
        output: this.output,
        functionCode,
        instruction,
        token: new vscode.CancellationTokenSource().token,
      });

      this.postMessage({ type: "ai.status", nodeId, status: "working", message: "Applying patch..." });

      const rpc = await this.ensureRpc();
      const updated = await rpc.patchNode(source, nodeName, replacement);

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

  private async onStop(): Promise<void> {
    for (const timer of this.parseTimers.values()) {
      clearTimeout(timer);
    }
    this.parseTimers.clear();

    if (this.positionsSaveTimer) {
      clearTimeout(this.positionsSaveTimer);
      this.positionsSaveTimer = undefined;
    }

    const rpc = this.rpc;
    this.rpc = undefined;
    if (rpc) {
      await rpc.stop();
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

      // Load persisted graph metadata (nodes + edges).
      try {
        const meta = await this.loadPersistedGraph(doc.uri);
        this.metaNodes = meta.nodes;
        this.metaEdges = meta.edges;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.output.appendLine(`graph metadata load warning: ${message}`);
        this.metaNodes = [];
        this.metaEdges = [];
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
      ports?: PortSpec[];
    }>;
    edges: Array<{ source: string; target: string; sourcePort?: string | null; targetPort?: string | null; kind?: "code" | "link" }>;
  } {
    const nodes: Array<{
      id: string;
      name: string;
      kind: "node" | "workflow" | "spec";
      position?: { x: number; y: number } | null;
      label?: string;
      nodeType?: string;
      ports?: PortSpec[];
    }> = [];

    // 1) Nodes from code.
    for (const n of graph.nodes) {
      nodes.push({
        ...this.mergePosition(n),
        kind: n.kind,
        label: `${n.kind}: ${n.name}`,
        ports: defaultPortsForCodeNode(n),
      });
    }

    // 2) Metadata-only nodes.
    const seenIds = new Set(nodes.map((n) => n.id));
    for (const s of this.metaNodes) {
      if (seenIds.has(s.id)) {
        // Future: allow overriding label/ports for code nodes.
        continue;
      }
      nodes.push({
        id: s.id,
        name: s.label,
        kind: "spec",
        position: this.mergePositionById(s.id, null) ?? null,
        label: s.label,
        nodeType: s.type,
        ports: portsFromNodeSpec(s),
      });
    }

    // 3) Edges: code-derived + metadata links.
    const edges: Array<{ source: string; target: string; sourcePort?: string | null; targetPort?: string | null; kind?: "code" | "link" }> = [];
    for (const e of graph.edges) {
      edges.push({ source: e.source, target: e.target, kind: "code" });
    }
    for (const e of this.metaEdges) {
      edges.push({
        source: e.sourceNodeId,
        target: e.targetNodeId,
        sourcePort: e.sourcePort,
        targetPort: e.targetPort,
        kind: "link",
      });
    }

    // Deduplicate edges by full key.
    const seenEdge = new Set<string>();
    const deduped = edges.filter((e) => {
      const k = `${e.kind ?? "code"}:${e.source}:${e.sourcePort ?? ""}->${e.target}:${e.targetPort ?? ""}`;
      if (seenEdge.has(k)) {
        return false;
      }
      seenEdge.add(k);
      return true;
    });

    return { nodes, edges: deduped };
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

  private graphStorePath(): vscode.Uri | undefined {
    if (!this.workspaceRoot) {
      return undefined;
    }
    return vscode.Uri.joinPath(this.workspaceRoot, ".holon", "graph.json");
  }

  private async loadPersistedGraph(docUri: vscode.Uri): Promise<{ nodes: NodeSpec[]; edges: EdgeSpec[] }> {
    if (!this.workspaceRoot) {
      return { nodes: [], edges: [] };
    }
    const rel = vscode.workspace.asRelativePath(docUri, false);
    const store = await this.readGraphStore();
    return store.files[rel] ?? { nodes: [], edges: [] };
  }

  private async persistGraphNow(docUri: vscode.Uri): Promise<void> {
    if (!this.workspaceRoot) {
      this.output.appendLine("graph save skipped: no workspace root");
      return;
    }
    const rel = vscode.workspace.asRelativePath(docUri, false);
    const store = await this.readGraphStore();
    store.files[rel] = { nodes: this.metaNodes, edges: this.metaEdges };
    await this.writeGraphStore(store);
    this.output.appendLine(`graph saved: ${rel}`);
  }

  private async readGraphStore(): Promise<{ version: 1; files: Record<string, { nodes: NodeSpec[]; edges: EdgeSpec[] }> }> {
    const storeUri = this.graphStorePath();
    if (!storeUri) {
      return { version: 1, files: {} };
    }

    try {
      const bytes = await vscode.workspace.fs.readFile(storeUri);
      const text = Buffer.from(bytes).toString("utf8");
      const parsed = JSON.parse(text) as unknown;
      if (!isGraphStore(parsed)) {
        return { version: 1, files: {} };
      }
      return parsed;
    } catch {
      return { version: 1, files: {} };
    }
  }

  private async writeGraphStore(store: { version: 1; files: Record<string, { nodes: NodeSpec[]; edges: EdgeSpec[] }> }): Promise<void> {
    const storeUri = this.graphStorePath();
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

function extractTopLevelFunction(source: string, functionName: string): string | undefined {
  const lines = source.split(/\r?\n/);

  const defRe = new RegExp(`^(?<indent>\\s*)(async\\s+def|def)\\s+${escapeRegExp(functionName)}\\s*\\(`);

  let defLine = -1;
  let indent = "";
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i]?.match(defRe);
    if (!m) {
      continue;
    }
    indent = (m.groups?.["indent"] ?? "") as string;
    if (indent.length !== 0) {
      continue;
    }
    defLine = i;
    break;
  }

  if (defLine === -1) {
    return undefined;
  }

  // Include decorators above the def.
  let start = defLine;
  for (let i = defLine - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? "";
    if (line.startsWith("@")) {
      start = i;
      continue;
    }
    if (line.trim() === "") {
      // Allow blank lines between decorators and def.
      start = i;
      continue;
    }
    break;
  }
  // Move forward to first decorator/def line (skip leading blanks we may have included).
  while (start < defLine && (lines[start]?.trim() ?? "") === "") {
    start += 1;
  }

  // Find end: next top-level def/class/decorator.
  let end = lines.length;
  const boundaryRe = /^(@|def\b|async\s+def\b|class\b)/;
  for (let i = defLine + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.length === 0) {
      continue;
    }
    if (!line.startsWith(" ") && !line.startsWith("\t") && boundaryRe.test(line)) {
      end = i;
      break;
    }
  }

  return lines.slice(start, end).join("\n").trimEnd() + "\n";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

type PortDirection = "input" | "output";
type PortKind = "data" | "llm" | "memory" | "tool" | "parser" | "control";

type PortSpec = {
  id: string;
  direction: PortDirection;
  kind?: PortKind | undefined;
  label?: string | undefined;
  multi?: boolean | undefined;
};

type NodeSpec = {
  id: string;
  type: string;
  label: string;
  inputs?: Array<{ id: string; kind?: PortKind; label?: string; multi?: boolean }>;
  outputs?: Array<{ id: string; kind?: PortKind; label?: string; multi?: boolean }>;
  props?: Record<string, unknown>;
};

type EdgeSpec = { sourceNodeId: string; sourcePort: string; targetNodeId: string; targetPort: string };

function portsFromNodeSpec(node: NodeSpec): PortSpec[] {
  const inputs = (node.inputs ?? []).map((p) => ({
    id: p.id,
    direction: "input" as const,
    kind: p.kind,
    label: p.label,
    multi: p.multi,
  }));
  const outputs = (node.outputs ?? []).map((p) => ({
    id: p.id,
    direction: "output" as const,
    kind: p.kind,
    label: p.label,
    multi: p.multi,
  }));
  return [...inputs, ...outputs];
}

function defaultPortsForCodeNode(node: CoreNode): PortSpec[] {
  if (node.kind === "workflow") {
    return [{ id: "start", direction: "output", kind: "control", label: "start" }];
  }
  return [
    { id: "input", direction: "input", kind: "data", label: "input" },
    { id: "output", direction: "output", kind: "data", label: "output" },
  ];
}

function isGraphStore(
  value: unknown
): value is { version: 1; files: Record<string, { nodes: NodeSpec[]; edges: EdgeSpec[] }> } {
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
  for (const entry of Object.values(files as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) {
      return false;
    }
    const e = entry as Record<string, unknown>;
    if (!Array.isArray(e["nodes"]) || !Array.isArray(e["edges"])) {
      return false;
    }
    // Light validation: required fields only.
    for (const n of e["nodes"] as unknown[]) {
      if (typeof n !== "object" || n === null) {
        return false;
      }
      const nn = n as Record<string, unknown>;
      if (typeof nn["id"] !== "string" || typeof nn["type"] !== "string" || typeof nn["label"] !== "string") {
        return false;
      }
    }
    for (const ed of e["edges"] as unknown[]) {
      if (typeof ed !== "object" || ed === null) {
        return false;
      }
      const ee = ed as Record<string, unknown>;
      if (
        typeof ee["sourceNodeId"] !== "string" ||
        typeof ee["sourcePort"] !== "string" ||
        typeof ee["targetNodeId"] !== "string" ||
        typeof ee["targetPort"] !== "string"
      ) {
        return false;
      }
    }
  }
  return true;
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
