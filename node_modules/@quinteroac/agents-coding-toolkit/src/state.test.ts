import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";
import { ZodError } from "zod";

import { readState, STATE_REL_PATH } from "./state";

async function createTempProjectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nvst-state-test-"));
}

async function writeStateFile(projectRoot: string, content: string): Promise<void> {
  const statePath = join(projectRoot, STATE_REL_PATH);
  await mkdir(join(projectRoot, ".agents"), { recursive: true });
  await writeFile(statePath, content, "utf8");
}

const createdProjectRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdProjectRoots.splice(0).map((projectRoot) => rm(projectRoot, { recursive: true, force: true })),
  );
});

describe("readState", () => {
  test("uses StateSchema.safeParse in source", async () => {
    const source = await readFile(join(process.cwd(), "src", "state.ts"), "utf8");
    expect(source).toContain("StateSchema.safeParse");
    expect(source).not.toContain("StateSchema.parse(");
  });

  test("returns schema validation failure with safeParse error as cause", async () => {
    const projectRoot = await createTempProjectRoot();
    createdProjectRoots.push(projectRoot);

    await writeStateFile(projectRoot, JSON.stringify({ current_iteration: "000001" }));

    await expect(readState(projectRoot)).rejects.toMatchObject({
      message: expect.stringContaining("failed schema validation"),
      cause: expect.any(ZodError),
    });
  });

  test("surfaces descriptive ENOENT message when state file is missing", async () => {
    const projectRoot = await createTempProjectRoot();
    createdProjectRoots.push(projectRoot);

    await expect(readState(projectRoot)).rejects.toThrow(
      `State file not found at ${join(projectRoot, STATE_REL_PATH)}.`,
    );
  });

  test("surfaces descriptive malformed JSON message", async () => {
    const projectRoot = await createTempProjectRoot();
    createdProjectRoots.push(projectRoot);

    await writeStateFile(projectRoot, "{");

    await expect(readState(projectRoot)).rejects.toThrow(
      `Malformed JSON in state file at ${join(projectRoot, STATE_REL_PATH)}.`,
    );
  });
});
