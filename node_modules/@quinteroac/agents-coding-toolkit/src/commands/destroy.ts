import { access, rm, rmdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { getScaffoldEntries } from "./init";

const ARCHIVED_DIR = ".agents/flow/archived";

interface DestroyOptions {
  clean: boolean;
}

function normalizeRelativePath(absolutePath: string, projectRoot: string): string {
  return relative(projectRoot, absolutePath).replaceAll("\\", "/");
}

function isArchivedPath(absolutePath: string, projectRoot: string): boolean {
  const relPath = normalizeRelativePath(absolutePath, projectRoot);
  return relPath === ARCHIVED_DIR || relPath.startsWith(`${ARCHIVED_DIR}/`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function confirmDeletion(clean: boolean, count: number): Promise<boolean> {
  const modeDescription = clean
    ? "This will remove all nvst-generated files, including archived files."
    : "This will remove nvst-generated files, preserving .agents/flow/archived.";
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${modeDescription}\nDelete ${count} file(s)? [y/N] `);
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

function collectDirectories(paths: string[], projectRoot: string): string[] {
  const directories = new Set<string>();

  for (const filePath of paths) {
    let currentDir = dirname(filePath);
    while (currentDir.startsWith(projectRoot) && currentDir !== projectRoot) {
      directories.add(currentDir);
      currentDir = dirname(currentDir);
    }
  }

  return [...directories].sort((a, b) => b.length - a.length);
}

async function removeEmptyDirectories(directories: string[]): Promise<void> {
  for (const dirPath of directories) {
    try {
      await rmdir(dirPath);
      console.log(`Removed empty directory: ${dirPath}`);
    } catch {
      // Ignore non-empty or missing directories.
    }
  }
}

export async function runDestroy(options: DestroyOptions): Promise<void> {
  const projectRoot = process.cwd();
  const entries = await getScaffoldEntries(projectRoot);

  const filesToDelete = entries
    .map((entry) => entry.destinationPath)
    .filter((path) => options.clean || !isArchivedPath(path, projectRoot));

  if (filesToDelete.length === 0) {
    console.log("Nothing to remove.");
    return;
  }

  const confirmed = await confirmDeletion(options.clean, filesToDelete.length);
  if (!confirmed) {
    console.log("Destroy canceled.");
    return;
  }

  const removed: string[] = [];

  for (const filePath of filesToDelete) {
    if (!(await exists(filePath))) {
      continue;
    }
    await rm(filePath, { force: true });
    removed.push(normalizeRelativePath(filePath, projectRoot));
    console.log(`Removed: ${normalizeRelativePath(filePath, projectRoot)}`);
  }

  if (options.clean) {
    const archivedAbsolutePath = join(projectRoot, ARCHIVED_DIR);
    if (await exists(archivedAbsolutePath)) {
      await rm(archivedAbsolutePath, { recursive: true, force: true });
      removed.push(ARCHIVED_DIR);
      console.log(`Removed: ${ARCHIVED_DIR}`);
    }
  }

  const directories = collectDirectories(filesToDelete, projectRoot);
  await removeEmptyDirectories(directories);

  console.log(`\nDestroy complete. Removed ${removed.length} file(s).`);
}
