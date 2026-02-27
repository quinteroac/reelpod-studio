import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readState } from "../state";
import { runStartIteration } from "./start-iteration";

async function createProjectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nvst-start-iteration-"));
}

async function withCwd<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return await fn();
  } finally {
    process.chdir(previous);
  }
}

const createdRoots: string[] = [];

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("start-iteration command", () => {
  test("registers start iteration in CLI dispatch", async () => {
    const source = await readFile(join(process.cwd(), "src", "cli.ts"), "utf8");
    expect(source).toContain('import { runStartIteration } from "./commands/start-iteration";');
    expect(source).toContain("await runStartIteration();");
  });

  test("preserves project_context when already created (immutable across iterations)", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    const flowDir = join(projectRoot, ".agents", "flow");
    await mkdir(flowDir, { recursive: true });

    // Seed state with project_context already created
    await writeFile(
      join(projectRoot, ".agents", "state.json"),
      JSON.stringify(
        {
          current_iteration: "000008",
          current_phase: "refactor",
          phases: {
            define: {
              requirement_definition: { status: "approved", file: "it_000008_product-requirement-document.md" },
              prd_generation: { status: "completed", file: "it_000008_PRD.json" },
            },
            prototype: {
              project_context: { status: "created", file: ".agents/PROJECT_CONTEXT.md" },
              test_plan: { status: "created", file: "it_000008_TP.json" },
              tp_generation: { status: "created", file: "it_000008_TP.json" },
              prototype_build: { status: "created", file: null },
              test_execution: { status: "completed", file: null },
              prototype_approved: true,
            },
            refactor: {
              evaluation_report: { status: "created", file: null },
              refactor_plan: { status: "approved", file: null },
              refactor_execution: { status: "completed", file: null },
              changelog: { status: "created", file: null },
            },
          },
          last_updated: "2026-02-22T20:00:00.000Z",
          history: [{ iteration: "000007", archived_at: "2026-02-22T19:00:00.000Z", archived_path: ".agents/flow/archived/000007" }],
        },
        null,
        2,
      ),
    );

    // Create an iteration file to archive
    await writeFile(join(flowDir, "it_000008_ISSUES.json"), "[]");

    await withCwd(projectRoot, async () => {
      await runStartIteration();
    });

    const state = await readState(projectRoot);
    expect(state.current_iteration).toBe("000009");
    expect(state.phases.prototype.project_context).toEqual({
      status: "created",
      file: ".agents/PROJECT_CONTEXT.md",
    });
  });

  test("preserves flow_guardrail when starting a new iteration", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    const flowDir = join(projectRoot, ".agents", "flow");
    await mkdir(flowDir, { recursive: true });

    await writeFile(
      join(projectRoot, ".agents", "state.json"),
      JSON.stringify(
        {
          current_iteration: "000003",
          current_phase: "define",
          flow_guardrail: "relaxed",
          phases: {
            define: {
              requirement_definition: { status: "pending", file: null },
              prd_generation: { status: "pending", file: null },
            },
            prototype: {
              project_context: { status: "pending", file: null },
              test_plan: { status: "pending", file: null },
              tp_generation: { status: "pending", file: null },
              prototype_build: { status: "pending", file: null },
              test_execution: { status: "pending", file: null },
              prototype_approved: false,
            },
            refactor: {
              evaluation_report: { status: "pending", file: null },
              refactor_plan: { status: "pending", file: null },
              refactor_execution: { status: "pending", file: null },
              changelog: { status: "pending", file: null },
            },
          },
          last_updated: "2026-02-22T20:00:00.000Z",
          history: [],
        },
        null,
        2,
      ),
    );

    await writeFile(join(flowDir, "it_000003_PRD.json"), "{}");

    await withCwd(projectRoot, async () => {
      await runStartIteration();
    });

    const state = await readState(projectRoot);
    expect(state.current_iteration).toBe("000004");
    expect(state.flow_guardrail).toBe("relaxed");
  });

  test("does not preserve project_context when it was pending", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    const flowDir = join(projectRoot, ".agents", "flow");
    await mkdir(flowDir, { recursive: true });

    await writeFile(
      join(projectRoot, ".agents", "state.json"),
      JSON.stringify(
        {
          current_iteration: "000002",
          current_phase: "define",
          phases: {
            define: {
              requirement_definition: { status: "pending", file: null },
              prd_generation: { status: "pending", file: null },
            },
            prototype: {
              project_context: { status: "pending", file: null },
              test_plan: { status: "pending", file: null },
              tp_generation: { status: "pending", file: null },
              prototype_build: { status: "pending", file: null },
              test_execution: { status: "pending", file: null },
              prototype_approved: false,
            },
            refactor: {
              evaluation_report: { status: "pending", file: null },
              refactor_plan: { status: "pending", file: null },
              refactor_execution: { status: "pending", file: null },
              changelog: { status: "pending", file: null },
            },
          },
          last_updated: "2026-02-22T20:00:00.000Z",
          history: [],
        },
        null,
        2,
      ),
    );

    await writeFile(join(flowDir, "it_000002_PRD.json"), "{}");

    await withCwd(projectRoot, async () => {
      await runStartIteration();
    });

    const state = await readState(projectRoot);
    expect(state.phases.prototype.project_context).toEqual({
      status: "pending",
      file: null,
    });
  });
});
