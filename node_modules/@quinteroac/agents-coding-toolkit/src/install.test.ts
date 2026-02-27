import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const PROJECT_ROOT = join(import.meta.dir, "..");
const PACKAGE_VERSION =
  (await Bun.file(join(PROJECT_ROOT, "package.json")).json()) as { version?: string };
const PACKAGE_VERSION_STR = PACKAGE_VERSION?.version ?? "0.1.0";
// Scoped packages: npm pack produces scope-package-version.tgz
const TARBALL_BASENAME = `quinteroac-agents-coding-toolkit-${PACKAGE_VERSION_STR}.tgz`;
const TARBALL_PATH = join(PROJECT_ROOT, TARBALL_BASENAME);

const tempProjectRoots: string[] = [];

async function createTempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nvst-install-test-"));
  tempProjectRoots.push(root);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "test-consumer", version: "1.0.0", private: true }),
    "utf-8",
  );
  return root;
}

function bunAdd(cwd: string, spec: string): { exitCode: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bun", ["add", spec], {
    cwd,
    encoding: "utf-8",
  });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function runNvst(cwd: string, args: string[]): { exitCode: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bunx", ["--bun", "nvst", ...args], {
    cwd,
    encoding: "utf-8",
  });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

beforeAll(() => {
  const packResult = spawnSync("bun", ["run", "package"], {
    cwd: PROJECT_ROOT,
    encoding: "utf-8",
  });
  if (packResult.status !== 0) {
    throw new Error(`Pre-test package failed: ${packResult.stderr}`);
  }
});

afterEach(async () => {
  await Promise.all(
    tempProjectRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("install package", () => {
  test("US-002-AC03: CLI --version outputs packaged version (run from source)", () => {
    const result = spawnSync("bun", [join(PROJECT_ROOT, "src", "cli.ts"), "--version"], {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout?.trim()).toBe(PACKAGE_VERSION_STR);
  });

  test("US-002-AC01: user can install the package from the local file system or registry", async () => {
    const tempRoot = await createTempProject();

    const { exitCode, stderr } = bunAdd(tempRoot, PROJECT_ROOT);
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("error");

    const nodeModules = join(tempRoot, "node_modules", "@quinteroac", "agents-coding-toolkit");
    const entries = await readdir(join(tempRoot, "node_modules"));
    expect(entries).toContain("@quinteroac");

    const pkgJsonPath = join(nodeModules, "package.json");
    const pkg = (await Bun.file(pkgJsonPath).json()) as { version?: string; bin?: Record<string, string> };
    expect(pkg.version).toBe(PACKAGE_VERSION_STR);
    expect(pkg.bin).toBeDefined();
    expect(pkg.bin?.nvst).toBeDefined();
  });

  test("US-002-AC01: user can install from packed tarball", async () => {
    const tempRoot = await createTempProject();

    const { exitCode, stderr } = bunAdd(tempRoot, TARBALL_PATH);
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("error");

    const entries = await readdir(join(tempRoot, "node_modules"));
    expect(entries).toContain("@quinteroac");
  });

  test("US-002-AC02: after installation, the nvst command is available in the shell", async () => {
    const tempRoot = await createTempProject();
    bunAdd(tempRoot, PROJECT_ROOT);

    const { exitCode, stdout } = runNvst(tempRoot, ["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: nvst <command> [options]");
    expect(stdout).toContain("init");
    expect(stdout).toContain("destroy");
  });

  test("US-002-AC03: installed version matches the packaged version", async () => {
    const tempRoot = await createTempProject();
    bunAdd(tempRoot, PROJECT_ROOT);

    const { exitCode, stdout } = runNvst(tempRoot, ["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(PACKAGE_VERSION_STR);
  });
});
