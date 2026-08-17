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
 * get_git_diff
 * -----------------------------------------------------------------
 */

/**
 * Get the current Git diff for the workspace.
 */
export async function getGitDiff(workspaceRoot: string): Promise<string> {
  return new Promise((resolve, reject) => {
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

        resolve(stdout);
      },
    );
  });
}
