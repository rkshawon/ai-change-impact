import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  console.log("AI Change Impact is active!");

  const saveListener = vscode.workspace.onDidSaveTextDocument((document) => {
    const filePath = document.uri.fsPath;

    // Only watch TypeScript / JavaScript files for now
    if (
      !filePath.endsWith(".ts") &&
      !filePath.endsWith(".tsx") &&
      !filePath.endsWith(".js") &&
      !filePath.endsWith(".jsx")
    ) {
      return;
    }

    vscode.window.showInformationMessage(`Code changed: ${document.fileName}`);

    console.log(`Code changed: ${filePath}`);
  });

  context.subscriptions.push(saveListener);
}

export function deactivate() {}
