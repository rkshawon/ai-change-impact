# Change Guard

**Change Guard** is an AI-powered VS Code extension that analyzes the impact and blast radius of your code changes before you commit. Powered by Gemini, Change Guard inspects your Git diffs, explores codebase dependencies, detects potential language/type errors, and delivers structured, actionable impact reports right inside VS Code.

---

## Features

- **Semantic Change Analysis:** Automatically summarizes modified, added, and deleted files with high-level descriptions of intent.
- **Blast Radius & Dependency Tracking:** Identifies downstream components, consumers, and APIs that could be affected by your changes.
- **Language & Runtime Error Detection:** Checks for potential breaking type mismatches, missing imports, syntax inconsistencies, and runtime issues.
- **Interactive Impact Webview:** Visualizes changes by severity (Critical, Warning, Info) with detailed rationales and remediation suggestions.
- **Agentic Codebase Inspection:** Leverages project tools and symbol search to verify impact across your repository before generating reports.
- **Seamless Git & IDE Integration:** Trigger analysis with one click from the Status Bar, Source Control (SCM) title bar, or keyboard shortcut.

---

## Getting Started

### 1. Prerequisites
- VS Code `1.125.0` or newer.
- Git initialized repository with active changes (unstaged or staged).
- Google Gemini API Key.

### 2. Configuration
Change Guard looks for your API key in a `.env` file within the extension directory or your environment variables:

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

*(Optional)* You can also specify the Gemini model (defaults to `gemini-3.6-flash` with automatic fallback to `gemini-3.5-flash-lite` and `gemini-2.5-flash`):
```env
GEMINI_MODEL=gemini-3.6-flash
```

---

## How to Use

1. **Make code changes** in your repository.
2. Trigger **Change Guard** via any of the following methods:
   - **Keyboard Shortcut:** `Ctrl+Alt+G` (or `Cmd+Alt+G` on macOS).
   - **Status Bar:** Click the `$(shield) Change Guard` item in the bottom right corner.
   - **Source Control View:** Click the Change Guard icon in the Source Control title bar.
   - **Command Palette:** Run `Ctrl+Shift+P` -> `Change Guard: Preview Changes`.
3. An interactive report panel will open displaying the detected impact, risks, affected areas, and recommendations.

---

## Extension Settings

Change Guard contributes the following commands and keybindings:

* `change-guard.previewChanges`: Opens the impact analysis panel for current changes (Shortcut: `Ctrl+Alt+G`).

---

## License

This project is licensed under the [MIT License](LICENSE).
