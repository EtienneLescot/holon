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
      nodes: Array<{ id: string; name: string; kind: "node" | "workflow"; position?: { x: number; y: number } | null }>;
      edges: Array<{ source: string; target: string }>;
    }
  | {
      type: "graph.update";
      nodes: Array<{ id: string; name: string; kind: "node" | "workflow"; position?: { x: number; y: number } | null }>;
      edges: Array<{ source: string; target: string }>;
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

  private readonly parseTimers = new Map<string, NodeJS.Timeout>();
  private readonly parseVersions = new Map<string, number>();

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

    this.output.show(true);
    this.output.appendLine("HolonPanel: created");

    this.panel.webview.html = this.getHtml(this.panel.webview, extensionUri);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message: WebviewToExtensionMessage) => {
        switch (message.type) {
          case "ui.ready":
            await this.onUiReady();
            return;
          case "ui.nodesChanged":
            this.onUiNodesChanged(message.nodes);
            return;
          case "ui.node.aiRequest":
            await this.onUiAiRequest(message.nodeId, message.instruction);
            return;
          case "rpc.stop":
            await this.onStop();
            return;
          default:
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
    for (const n of nodes) {
      this.positions.set(n.id, { x: n.position.x, y: n.position.y });
    }

    // Re-emit the last graph with updated positions.
    if (this.lastGraph) {
      this.postGraphUpdate(this.lastGraph);
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
    const editor = vscode.window.activeTextEditor;
    const doc = editor?.document;
    if (!editor || !doc || !isHolonDocument(doc)) {
      this.postMessage({
        type: "ai.status",
        nodeId,
        status: "error",
        message: "Open a *.holon.py file to patch",
      });
      return;
    }

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
      this.rpc = await RpcClient.start(this.extensionUri);
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
    const nodes = graph.nodes.map((n) => this.mergePosition(n));
    const edges = graph.edges;

    if (!this.hasSentGraph) {
      this.hasSentGraph = true;
      this.postMessage({ type: "graph.init", nodes, edges });
      return;
    }

    this.postGraphUpdate(graph);
  }

  private postGraphUpdate(graph: CoreGraph): void {
    const nodes = graph.nodes.map((n) => this.mergePosition(n));
    const edges = graph.edges;
    this.postMessage({ type: "graph.update", nodes, edges });
  }

  private mergePosition(n: CoreNode): CoreNode {
    const stored = this.positions.get(n.id);
    if (!stored) {
      return n;
    }
    return { ...n, position: stored };
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
