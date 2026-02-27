import { afterEach, describe, expect, test } from "bun:test";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const PROJECT_ROOT = join(import.meta.dir, "..");
const pkg = (await Bun.file(join(PROJECT_ROOT, "package.json")).json()) as { version?: string };
const PACKAGE_VERSION = pkg?.version ?? "0.1.0";
// Scoped packages: npm pack produces scope-package-version.tgz
const TARBALL_BASENAME = `quinteroac-agents-coding-toolkit-${PACKAGE_VERSION}.tgz`;

function runPackageScript(): { exitCode: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bun", ["run", "package"], {
    cwd: PROJECT_ROOT,
    encoding: "utf-8",
  });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function listTarballContents(tarballPath: string): string[] {
  const result = spawnSync("tar", ["-tf", tarballPath], {
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`tar -tf failed: ${result.stderr}`);
  }
  return (result.stdout ?? "").trim().split("\n").filter(Boolean);
}

function extractFileFromTarball(tarballPath: string, memberPath: string): string {
  const result = spawnSync("tar", ["-xOf", tarballPath, memberPath], {
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`tar -xOf failed: ${result.stderr}`);
  }
  return result.stdout ?? "";
}

afterEach(async () => {
  const tarballPath = join(PROJECT_ROOT, TARBALL_BASENAME);
  try {
    await rm(tarballPath, { force: true });
  } catch {
    // ignore if file does not exist
  }
});

describe("package command", () => {
  test("US-001-AC01: running package command produces a valid .tgz file", async () => {
    const { exitCode } = runPackageScript();
    expect(exitCode).toBe(0);

    const tarballPath = join(PROJECT_ROOT, TARBALL_BASENAME);
    const entries = await readdir(PROJECT_ROOT);
    const hasTgz = entries.some((e) => e === TARBALL_BASENAME);
    expect(hasTgz).toBe(true);

    const stat = await Bun.file(tarballPath).exists();
    expect(stat).toBe(true);

    const contents = listTarballContents(tarballPath);
    expect(contents.length).toBeGreaterThan(0);
    expect(contents.some((p) => p.includes("package.json"))).toBe(true);
  });

  test("US-001-AC02: package includes all necessary dependencies and source files", async () => {
    runPackageScript();

    const tarballPath = join(PROJECT_ROOT, TARBALL_BASENAME);
    const contents = listTarballContents(tarballPath);

    const packageJsonPath = contents.find((p) => p.endsWith("package.json"));
    expect(packageJsonPath).toBeDefined();

    const baseDir = packageJsonPath!.replace(/\/package\.json$/, "");
    const requiredPaths = [
      `${baseDir}/package.json`,
      `${baseDir}/src/cli.ts`,
      `${baseDir}/src/state.ts`,
      `${baseDir}/scaffold`,
      `${baseDir}/schemas`,
    ];
    for (const required of requiredPaths) {
      const found = contents.some((p) => p === required || p.startsWith(required + "/"));
      expect(found).toBe(true);
    }

    const pkgContent = extractFileFromTarball(tarballPath, "package/package.json");
    const pkg = JSON.parse(pkgContent);
    expect(pkg.dependencies).toBeDefined();
    expect(pkg.dependencies.zod).toBeDefined();
  });

  test("US-001-AC03: build process completes without errors", () => {
    const { exitCode, stderr } = runPackageScript();
    expect(exitCode).toBe(0);
    expect(stderr).not.toMatch(/\b(Error|ERR!)\b/);
  });
});
