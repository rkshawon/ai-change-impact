/**
 * Project tools for Change Guard.
 *
 * These tools give an AI model **read-only** access to the
 * current workspace. They are provider-independent — nothing
 * in this file imports or references any specific AI SDK.
 *
 * Security constraints:
 * - All file paths are resolved and validated to stay inside the workspace root.
 * - No write / delete / execute operations are exposed.
 * - Maximum file size prevents accidentally loading huge files.
 * - Search results and list results are capped.
 * - Common build and dependency directories are excluded.
 */

import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";

/*
 * -----------------------------------------------------------------
 * Constants
 * -----------------------------------------------------------------
 */

/** Maximum file size we will read (bytes). */
const MAX_FILE_SIZE = 500 * 1024; // 500 KB

/** Maximum number of search match lines returned. */
const MAX_SEARCH_RESULTS = 50;

/** Maximum number of files listed per directory. */
const MAX_LIST_RESULTS = 200;

/** Directories excluded from search and exploration. */
const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  ".turbo",
  ".vscode",
  ".cache",
]);

/*
 * -----------------------------------------------------------------
 * Path validation
 * -----------------------------------------------------------------
 */

/**
 * Resolve a workspace-relative `filePath` to an absolute path
 * and ensure it stays strictly inside `workspaceRoot`.
 *
 * Rejects absolute paths and path-traversal attempts.
 */
export function safePath(workspaceRoot: string, filePath: string): string {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("Invalid file path.");
  }

  // Reject explicit absolute paths
  if (path.isAbsolute(filePath)) {
    throw new Error(`Absolute paths are not allowed: ${filePath}`);
  }

  const resolvedRoot = path.resolve(workspaceRoot);
  const resolved = path.resolve(resolvedRoot, filePath);
  const normalizedRoot = resolvedRoot + path.sep;

  if (!resolved.startsWith(normalizedRoot) && resolved !== resolvedRoot) {
    throw new Error(`Path escapes the workspace: ${filePath}`);
  }

  return resolved;
}

/*
 * -----------------------------------------------------------------
 * read_file
 * -----------------------------------------------------------------
 */

/**
 * Read the UTF-8 content of a file within the workspace.
 */
export async function readFile(
  workspaceRoot: string,
  filePath: string,
): Promise<string> {
  const absolute = safePath(workspaceRoot, filePath);

  let stats: fs.Stats;
  try {
    stats = await fs.promises.stat(absolute);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }

  if (!stats.isFile()) {
    throw new Error(`Not a regular file: ${filePath}`);
  }

  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(
      `File too large (${(stats.size / 1024).toFixed(0)} KB, max ${MAX_FILE_SIZE / 1024} KB): ${filePath}`,
    );
  }

  return fs.promises.readFile(absolute, "utf-8");
}

/*
 * -----------------------------------------------------------------
 * search_files
 * -----------------------------------------------------------------
 */

/**
 * Search project files for a query string and return matching file locations with line context.
 */
export async function searchFiles(
  workspaceRoot: string,
  query: string,
): Promise<string[]> {
  if (!query || !query.trim()) {
    throw new Error("Search query must not be empty.");
  }

  const trimmedQuery = query.trim().toLowerCase();
  const results: string[] = [];

  await walkForSearch(workspaceRoot, workspaceRoot, trimmedQuery, results);

  return results;
}

/**
 * Recursively walk the workspace looking for files whose content contains `query`.
 */
async function walkForSearch(
  workspaceRoot: string,
  dir: string,
  query: string,
  results: string[],
): Promise<void> {
  if (results.length >= MAX_SEARCH_RESULTS) {
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return; // skip unreadable directories
  }

  for (const entry of entries) {
    if (results.length >= MAX_SEARCH_RESULTS) {
      return;
    }

    if (EXCLUDED_DIRS.has(entry.name)) {
      continue;
    }

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walkForSearch(workspaceRoot, full, query, results);
    } else if (entry.isFile()) {
      try {
        const stat = await fs.promises.stat(full);
        if (stat.size > MAX_FILE_SIZE) {
          continue;
        }

        const content = await fs.promises.readFile(full, "utf-8");
        const lowerContent = content.toLowerCase();

        if (lowerContent.includes(query)) {
          const relPath = path.relative(workspaceRoot, full).replace(/\\/g, "/");
          const lines = content.split(/\r?\n/);

          for (let i = 0; i < lines.length; i++) {
            if (results.length >= MAX_SEARCH_RESULTS) {
              break;
            }
            if (lines[i].toLowerCase().includes(query)) {
              const lineSnippet = lines[i].trim();
              results.push(`${relPath}:${i + 1}: ${lineSnippet}`);
            }
          }
        }
      } catch {
        // skip unreadable or binary files
      }
    }
  }
}

/*
 * -----------------------------------------------------------------
 * list_files
 * -----------------------------------------------------------------
 */

/**
 * List files and directories under a workspace-relative directory path.
 */
export async function listFiles(
  workspaceRoot: string,
  directory: string = ".",
): Promise<string[]> {
  const normalizedDir = directory && directory.trim() ? directory.trim() : ".";
  const absolute = safePath(workspaceRoot, normalizedDir);

  let stats: fs.Stats;
  try {
    stats = await fs.promises.stat(absolute);
  } catch {
    throw new Error(`Directory not found: ${directory}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`Not a directory: ${directory}`);
  }

  const entries = await fs.promises.readdir(absolute, { withFileTypes: true });
  const result: string[] = [];

  for (const entry of entries) {
    if (result.length >= MAX_LIST_RESULTS) {
      break;
    }

    if (EXCLUDED_DIRS.has(entry.name)) {
      continue;
    }

    const suffix = entry.isDirectory() ? "/" : "";
    result.push(entry.name + suffix);
  }

  return result;
}

/*
 * -----------------------------------------------------------------
 * Project Diagnostics & Multi-Language Support
 * -----------------------------------------------------------------
 */

export interface ProjectDiagnostic {
  filePath: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  source?: string;
  code?: string | number;
  message: string;
}

/**
 * Format project diagnostics into a readable string for AI investigation tools.
 */
export function formatDiagnostics(
  diagnostics: ProjectDiagnostic[],
  filterPath?: string,
): string {
  if (!diagnostics || diagnostics.length === 0) {
    return "0 compiler/type diagnostics found. All language checks clean.";
  }

  let filtered = diagnostics;
  if (filterPath && filterPath.trim()) {
    const normFilter = filterPath.trim().replace(/\\/g, "/");
    filtered = diagnostics.filter((d) =>
      d.filePath.replace(/\\/g, "/").includes(normFilter),
    );
  }

  if (filtered.length === 0) {
    return `No compiler diagnostics found matching path "${filterPath}".`;
  }

  return filtered
    .map((d) => {
      const src = d.source ? ` [${d.source}]` : "";
      const code = d.code !== undefined ? ` (${d.code})` : "";
      const sev = d.severity.toUpperCase();
      return `[${sev}] ${d.filePath}:${d.line}:${d.column}${src}${code} - ${d.message}`;
    })
    .join("\n");
}

/*
 * -----------------------------------------------------------------
 * get_git_diff & Untracked Files
 * -----------------------------------------------------------------
 */

/**
 * Discover untracked files in the workspace.
 */
export async function getUntrackedFiles(
  workspaceRoot: string,
): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["ls-files", "--others", "--exclude-standard"],
      {
        cwd: workspaceRoot,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error || !stdout) {
          resolve([]);
          return;
        }

        const files = stdout
          .split(/\r?\n/)
          .map((f) => f.trim())
          .filter(Boolean);
        resolve(files);
      },
    );
  });
}

/**
 * Synthesize a unified diff representation for an untracked new file.
 */
async function synthesizeNewFileDiff(
  workspaceRoot: string,
  relPath: string,
): Promise<string | null> {
  try {
    const content = await readFile(workspaceRoot, relPath);
    const lines = content.split(/\r?\n/);
    const lineCount = lines.length;
    const normPath = relPath.replace(/\\/g, "/");

    let diff = `diff --git a/${normPath} b/${normPath}\n`;
    diff += `new file mode 100644\n`;
    diff += `--- /dev/null\n`;
    diff += `+++ b/${normPath}\n`;
    diff += `@@ -0,0 +1,${lineCount} @@\n`;
    diff += lines.map((l) => `+${l}`).join("\n");
    diff += "\n";
    return diff;
  } catch {
    return null;
  }
}

/**
 * Get the current Git diff for the workspace including untracked new files.
 */
export async function getGitDiff(workspaceRoot: string): Promise<string> {
  const trackedDiff = await new Promise<string>((resolve, reject) => {
    execFile(
      "git",
      ["diff", "HEAD", "--unified=3"],
      {
        cwd: workspaceRoot,
        windowsHide: true,
        maxBuffer: 5 * 1024 * 1024, // 5 MB
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout || "");
      },
    );
  });

  const untracked = await getUntrackedFiles(workspaceRoot);
  if (untracked.length === 0) {
    return trackedDiff;
  }

  const newFileDiffs: string[] = [];
  // Limit untracked file synthesis to avoid overloading memory for huge batches
  for (const file of untracked.slice(0, 30)) {
    const diff = await synthesizeNewFileDiff(workspaceRoot, file);
    if (diff) {
      newFileDiffs.push(diff);
    }
  }

  if (newFileDiffs.length === 0) {
    return trackedDiff;
  }

  return (
    (trackedDiff ? trackedDiff.trimEnd() + "\n\n" : "") +
    newFileDiffs.join("\n")
  );
}

/*
 * -----------------------------------------------------------------
 * Commit History Analysis Helpers
 * -----------------------------------------------------------------
 */

export interface CommitSummary {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

/**
 * Get a list of recent commits for selection in QuickPick.
 */
export async function getCommitList(
  workspaceRoot: string,
  maxCount: number = 30,
): Promise<CommitSummary[]> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [
        "log",
        `-n${maxCount}`,
        "--pretty=format:%H%x00%h%x00%an%x00%ad%x00%s",
        "--date=relative",
      ],
      {
        cwd: workspaceRoot,
        windowsHide: true,
        maxBuffer: 5 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }

        const lines = stdout.split(/\r?\n/).filter(Boolean);
        const commits: CommitSummary[] = [];

        for (const line of lines) {
          const parts = line.split("\0");
          if (parts.length >= 5) {
            commits.push({
              hash: parts[0].trim(),
              shortHash: parts[1].trim(),
              author: parts[2].trim(),
              date: parts[3].trim(),
              message: parts[4].trim(),
            });
          }
        }

        resolve(commits);
      },
    );
  });
}

/**
 * Get the unified diff / patch for a specific commit.
 */
export async function getCommitDiff(
  workspaceRoot: string,
  commitHash: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["show", "--unified=3", "--stat", "--patch", commitHash],
      {
        cwd: workspaceRoot,
        windowsHide: true,
        maxBuffer: 5 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout || "");
      },
    );
  });
}

/**
 * Fetch chronological sequence of recent commits with individual diffs.
 */
export async function getRecentCommits(
  workspaceRoot: string,
  count: number = 5,
  startRef: string = "HEAD",
): Promise<Array<CommitSummary & { diff: string }>> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [
        "log",
        `-n${count}`,
        startRef,
        "--pretty=format:COMMIT_HEADER:%H%x00%h%x00%an%x00%ad%x00%s",
        "--date=relative",
        "-p",
        "--unified=3",
      ],
      {
        cwd: workspaceRoot,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }

        const raw = stdout || "";
        const commitBlocks = raw.split("COMMIT_HEADER:").filter(Boolean);
        const results: Array<CommitSummary & { diff: string }> = [];

        for (const block of commitBlocks) {
          const firstLineEnd = block.indexOf("\n");
          const headerLine =
            firstLineEnd !== -1 ? block.slice(0, firstLineEnd) : block;
          const diffContent =
            firstLineEnd !== -1 ? block.slice(firstLineEnd).trim() : "";

          const parts = headerLine.split("\0");
          if (parts.length >= 5) {
            results.push({
              hash: parts[0].trim(),
              shortHash: parts[1].trim(),
              author: parts[2].trim(),
              date: parts[3].trim(),
              message: parts[4].trim(),
              diff: diffContent,
            });
          }
        }

        resolve(results);
      },
    );
  });
}

