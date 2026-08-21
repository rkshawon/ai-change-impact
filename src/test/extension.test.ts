import * as assert from "assert";
import * as path from "path";
import type { ProjectDiagnostic } from "../ai/AIProvider";
import { parseImpactReport } from "../ai/AIProvider";
import {
  safePath,
  searchFiles,
  listFiles,
  formatDiagnostics,
  getUntrackedFiles,
} from "../analysis/projectTools";

suite("Change Guard Test Suite", () => {
  const workspaceRoot = path.resolve(__dirname, "../..");

  test("safePath prevents path escaping", () => {
    // Valid relative path
    const valid = safePath(workspaceRoot, "package.json");
    assert.ok(valid.includes("package.json"));

    // Reject path traversal outside workspace
    assert.throws(() => {
      safePath(workspaceRoot, "../outside.txt");
    }, /Path escapes the workspace/);
  });

  test("parseImpactReport parses valid JSON response and preserves diagnostics", () => {
    const rawJson = JSON.stringify({
      summary: "Added button component logging.",
      severity: "low",
      changedFiles: [
        { path: "components/AppButton.tsx", changes: ["Added console.log"] },
      ],
      affectedFiles: [
        {
          path: "components/LoginForm.tsx",
          reason: "Uses AppButton",
          severity: "low",
        },
      ],
      risks: [
        { level: "low", description: "Debug log in production" },
      ],
      recommendations: ["Remove console.log before merge"],
    });

    const mockDiagnostics: ProjectDiagnostic[] = [
      {
        filePath: "components/AppButton.tsx",
        line: 12,
        column: 5,
        severity: "error",
        source: "typescript",
        code: 2322,
        message: "Type 'string' is not assignable to type 'number'.",
      },
    ];

    const report = parseImpactReport(rawJson, [], mockDiagnostics);
    assert.strictEqual(report.summary, "Added button component logging.");
    assert.strictEqual(report.severity, "low");
    assert.strictEqual(report.changedFiles.length, 1);
    assert.strictEqual(report.affectedFiles.length, 1);
    assert.strictEqual(report.risks.length, 1);
    assert.strictEqual(report.recommendations.length, 1);
    assert.strictEqual(report.diagnostics?.length, 1);
    assert.strictEqual(report.diagnostics?.[0].source, "typescript");
  });

  test("formatDiagnostics formats multi-language compiler errors cleanly", () => {
    const diagnostics: ProjectDiagnostic[] = [
      {
        filePath: "main.go",
        line: 45,
        column: 8,
        severity: "error",
        source: "gopls",
        message: "undefined: UserSession",
      },
      {
        filePath: "UserService.java",
        line: 102,
        column: 15,
        severity: "warning",
        source: "javac",
        message: "Unchecked call to add(E)",
      },
    ];

    const formatted = formatDiagnostics(diagnostics);
    assert.ok(formatted.includes("[ERROR] main.go:45:8 [gopls] - undefined: UserSession"));
    assert.ok(formatted.includes("[WARNING] UserService.java:102:15 [javac] - Unchecked call to add(E)"));

    const filtered = formatDiagnostics(diagnostics, "main.go");
    assert.ok(filtered.includes("main.go"));
    assert.ok(!filtered.includes("UserService.java"));
  });

  test("parseImpactReport handles markdown wrapped JSON", () => {
    const md = "```json\n" + JSON.stringify({
      summary: "Critical security patch",
      severity: "CRITICAL",
      changedFiles: [{ path: "auth/token.ts", changes: ["Fixed leak"] }],
      affectedFiles: [],
      risks: [{ level: "critical", description: "Token exposure" }],
      recommendations: ["Rotate keys"],
    }) + "\n```";

    const report = parseImpactReport(md);
    assert.strictEqual(report.summary, "Critical security patch");
    assert.strictEqual(report.severity, "critical");
  });

  test("searchFiles searches codebase and lists matches", async () => {
    const results = await searchFiles(workspaceRoot, "change-guard.previewChanges");
    assert.ok(results.length > 0, "Should find occurrences of previewChanges command");
  });

  test("listFiles lists root directory files", async () => {
    const files = await listFiles(workspaceRoot, ".");
    assert.ok(files.includes("package.json"), "package.json should be in listed directory");
  });

  test("getUntrackedFiles returns an array without throwing", async () => {
    const untracked = await getUntrackedFiles(workspaceRoot);
    assert.ok(Array.isArray(untracked));
  });
});
