/**
 * Project tools for Change Guard.
 *
 * These tools give an AI model **read-only** access to the
 * current workspace.  They are provider-independent — nothing
 * in this file imports or references any specific AI SDK.
 *
 * Security constraints:
 *
 * - All file paths are resolved and validated to stay inside
 *   the workspace root.
 * - No write / delete / execute operations are exposed.
 * - A maximum file size prevents accidentally loading huge files.
 * - Search results are capped.
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

/** Maximum number of search results returned. */
const MAX_SEARCH_RESULTS = 50;

/** Maximum number of files listed per directory. */
const MAX_LIST_RESULTS = 200;

/** Directories excluded from search. */
const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "out",
  "coverage",
  ".turbo",
]);

/*
 * -----------------------------------------------------------------
 * Path validation
 * -----------------------------------------------------------------
 */

/**
 * Resolve a workspace-relative `filePath` to an absolute path
 * and ensure it stays inside `workspaceRoot`.
 *
 * Rejects absolute paths and path-traversal attempts.
 */
function safePath(workspaceRoot: string, filePath: string): string {
  /*
   * Reject obviously absolute paths on any platform.
   */
  if (path.isAbsolute(filePath)) {
    throw new Error(`Absolute paths are not allowed: ${filePath}`);
  }

  const resolved = path.resolve(workspaceRoot, filePath);

  const normalizedRoot = path.resolve(workspaceRoot) + path.sep;

  if (!resolved.startsWith(normalizedRoot) && resolved !== path.resolve(workspaceRoot)) {
    throw new Error(`Path escapes the workspace: ${filePath}`);
  }

  return resolved;
}

/*
 * -----------------------------------------------------------------
 * read_file
 * -----------------------------------------------------------------
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
    throw new Error(`Not a file: ${filePath}`);
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

export async function searchFiles(
  workspaceRoot: string,
  query: string,
): Promise<string[]> {
  if (!query || !query.trim()) {
    throw new Error("Search query must not be empty.");
  }

  const results: string[] = [];

  await walkForSearch(workspaceRoot, workspaceRoot, query.toLowerCase(), results);

  return results;
}

/**
 * Recursively walk the workspace looking for files whose
 * content contains `query`.
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

        if (content.toLowerCase().includes(query)) {
          results.push(path.relative(workspaceRoot, full));
        }
      } catch {
        // skip unreadable files
      }
    }
  }
}

/*
 * -----------------------------------------------------------------
 * list_files
 * -----------------------------------------------------------------
 */

export async function listFiles(
  workspaceRoot: string,
  directory: string,
): Promise<string[]> {
  const absolute = safePath(workspaceRoot, directory);

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
