import * as vscode from "vscode";

import { HolonPanel } from "./webview";

export function activate(context: vscode.ExtensionContext): void {
  const openCommand = vscode.commands.registerCommand("holon.open", () => {
    HolonPanel.createOrShow(context.extensionUri);
  });

  context.subscriptions.push(openCommand);
}

export function deactivate(): void {
  // No-op.
}
