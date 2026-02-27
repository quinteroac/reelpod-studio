import { access, mkdir, readdir } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

const TEMPLATE_PREFIX = "tmpl_";
const SCAFFOLD_ROOT = join(import.meta.dir, "..", "..", "scaffold");

export interface ScaffoldEntry {
  sourcePath: string;
  destinationPath: string;
  relativeDestinationPath: string;
}

function stripTemplatePrefix(fileName: string): string {
  return fileName.startsWith(TEMPLATE_PREFIX) ? fileName.slice(TEMPLATE_PREFIX.length) : fileName;
}

async function walkFiles(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const filePaths: string[] = [];

  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      filePaths.push(...(await walkFiles(entryPath)));
      continue;
    }
    if (entry.isFile()) {
      filePaths.push(entryPath);
    }
  }

  return filePaths;
}

export async function getScaffoldEntries(projectRoot: string): Promise<ScaffoldEntry[]> {
  const sourceFiles = await walkFiles(SCAFFOLD_ROOT);

  return sourceFiles.map((sourcePath) => {
    const relativeFromScaffold = relative(SCAFFOLD_ROOT, sourcePath);
    const sourceDir = dirname(relativeFromScaffold);
    const targetFileName = stripTemplatePrefix(basename(relativeFromScaffold));
    const relativeDestinationPath =
      sourceDir === "." ? targetFileName : join(sourceDir, targetFileName);

    return {
      sourcePath,
      destinationPath: join(projectRoot, relativeDestinationPath),
      relativeDestinationPath,
    };
  });
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function runInit(): Promise<void> {
  const projectRoot = process.cwd();
  const entries = await getScaffoldEntries(projectRoot);

  const created: string[] = [];
  const skipped: string[] = [];

  for (const entry of entries) {
    if (await exists(entry.destinationPath)) {
      console.warn(`Skipping existing file: ${entry.relativeDestinationPath}`);
      skipped.push(entry.relativeDestinationPath);
      continue;
    }

    await mkdir(dirname(entry.destinationPath), { recursive: true });
    await Bun.write(entry.destinationPath, Bun.file(entry.sourcePath));
    created.push(entry.relativeDestinationPath);
    console.log(`Created: ${entry.relativeDestinationPath}`);
  }

  console.log(
    `\nInit complete. Created ${created.length} file(s), skipped ${skipped.length} existing file(s).`,
  );
}
