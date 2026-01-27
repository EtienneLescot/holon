import * as vscode from "vscode";

import { HolonPanel } from "./webview";

export function activate(context: vscode.ExtensionContext): void {
  const openCommand = vscode.commands.registerCommand("holon.open", () => {
    HolonPanel.createOrShow(context.extensionUri);
  });

  const refreshDescriptionsCommand = vscode.commands.registerCommand("holon.refreshDescriptions", async () => {
    // Ensure a panel exists so it has the right document context.
    if (!HolonPanel.currentPanel) {
      HolonPanel.createOrShow(context.extensionUri);
    }

    const panel = HolonPanel.currentPanel;
    if (!panel) {
      return;
    }

    const choice = await vscode.window.showWarningMessage(
      "Refresh descriptions for all nodes? This will make multiple Copilot requests.",
      { modal: true },
      "Refresh"
    );
    if (choice !== "Refresh") {
      return;
    }

    await panel.refreshAllDescriptions();
  });

  context.subscriptions.push(openCommand, refreshDescriptionsCommand);
}

export function deactivate(): void {
  // No-op.
}
