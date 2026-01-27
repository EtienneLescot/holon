import * as vscode from "vscode";
import * as fs from "node:fs";

import { RpcClient } from "./rpcClient";

type WebviewToExtensionMessage =
  | {
      type: "ui.ready";
    }
  | {
      type: "ui.nodesChanged";
      nodes: Array<{ id: string; position: { x: number; y: number } }>;
    }
  | {
      type: "rpc.stop";
    };

type ExtensionToWebviewMessage =
  | {
      type: "graph.init";
      nodes: Array<{ id: string; name: string; kind: "node" | "workflow"; position?: { x: number; y: number } | null }>;
    }
  | {
      type: "rpc.hello.error";
      error: string;
    };

export class HolonPanel {
  public static currentPanel: HolonPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private rpc: RpcClient | undefined;
  private readonly extensionUri: vscode.Uri;
  private readonly output: vscode.OutputChannel;

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
    try {
      this.output.appendLine("UI: ready");
      if (!this.rpc) {
        this.rpc = await RpcClient.start(this.extensionUri);
      }

      // Phase 4: for now we seed a tiny graph. Next step will call core parser.
      // We still call hello to validate the RPC path.
      await this.rpc.hello();

      this.postMessage({
        type: "graph.init",
        nodes: [
          { id: "workflow:main", name: "main", kind: "workflow", position: { x: 80, y: 60 } },
          { id: "node:analyze", name: "analyze", kind: "node", position: { x: 80, y: 200 } },
        ],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`UI init error: ${message}`);
      this.postMessage({ type: "rpc.hello.error", error: message });
    }
  }

  private onUiNodesChanged(nodes: Array<{ id: string; position: { x: number; y: number } }>): void {
    this.output.appendLine(`ui.nodesChanged: ${JSON.stringify(nodes)}`);
  }

  private async onStop(): Promise<void> {
    const rpc = this.rpc;
    this.rpc = undefined;
    if (rpc) {
      await rpc.stop();
    }
  }

  private postMessage(message: ExtensionToWebviewMessage): void {
    void this.panel.webview.postMessage(message);
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
