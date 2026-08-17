import * as assert from "assert";
import * as path from "path";
import { parseImpactReport } from "../ai/AIProvider";
import { safePath, searchFiles, listFiles } from "../analysis/projectTools";

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

  test("parseImpactReport parses valid JSON response", () => {
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

    const report = parseImpactReport(rawJson);
    assert.strictEqual(report.summary, "Added button component logging.");
    assert.strictEqual(report.severity, "low");
    assert.strictEqual(report.changedFiles.length, 1);
    assert.strictEqual(report.affectedFiles.length, 1);
    assert.strictEqual(report.risks.length, 1);
    assert.strictEqual(report.recommendations.length, 1);
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
});
