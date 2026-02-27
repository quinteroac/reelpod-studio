import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentResult } from "../agent";
import { readState, writeState } from "../state";
import { runDefineRefactorPlan } from "./define-refactor-plan";

async function createProjectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nvst-define-refactor-plan-"));
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

async function seedState(
  projectRoot: string,
  stateOverrides: {
    currentPhase?: "define" | "prototype" | "refactor";
    refactorPlanStatus?: "pending" | "pending_approval" | "approved";
    prototypeApproved?: boolean;
  } = {},
): Promise<void> {
  const currentPhase = stateOverrides.currentPhase ?? "refactor";
  const refactorPlanStatus = stateOverrides.refactorPlanStatus ?? "pending";
  const prototypeApproved = stateOverrides.prototypeApproved ?? true;

  await mkdir(join(projectRoot, ".agents", "flow"), { recursive: true });

  await writeState(projectRoot, {
    current_iteration: "000013",
    current_phase: currentPhase,
    phases: {
      define: {
        requirement_definition: { status: "approved", file: "it_000013_product-requirement-document.md" },
        prd_generation: { status: "completed", file: "it_000013_PRD.json" },
      },
      prototype: {
        project_context: { status: "created", file: ".agents/PROJECT_CONTEXT.md" },
        test_plan: { status: "created", file: "it_000013_test-plan.md" },
        tp_generation: { status: "created", file: "it_000013_TEST-PLAN.json" },
        prototype_build: { status: "created", file: "it_000013_progress.json" },
        test_execution: { status: "completed", file: "it_000013_test-execution-report.json" },
        prototype_approved: prototypeApproved,
      },
      refactor: {
        evaluation_report: { status: "pending", file: null },
        refactor_plan: { status: refactorPlanStatus, file: null },
        refactor_execution: { status: "pending", file: null },
        changelog: { status: "pending", file: null },
      },
    },
    last_updated: "2026-02-26T00:00:00.000Z",
    updated_by: "seed",
    history: [],
  });
}

const createdRoots: string[] = [];

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("define refactor-plan command", () => {
  test("registers define refactor-plan command in CLI dispatch", async () => {
    const source = await readFile(join(process.cwd(), "src", "cli.ts"), "utf8");

    expect(source).toContain('import { runDefineRefactorPlan } from "./commands/define-refactor-plan";');
    expect(source).toContain('if (subcommand === "refactor-plan") {');
    expect(source).toContain("await runDefineRefactorPlan({ provider, force });");
  });

  test("rejects when prototype_approved is false", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, { prototypeApproved: false });

    await withCwd(projectRoot, async () => {
      await expect(runDefineRefactorPlan({ provider: "codex" })).rejects.toThrow(
        "Cannot define refactor plan: phases.prototype.prototype_approved must be true",
      );
    });
  });

  test("allows bypassing prototype_approved guard with force", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, { prototypeApproved: false });

    await withCwd(projectRoot, async () => {
      await runDefineRefactorPlan(
        { provider: "codex", force: true },
        {
          loadSkillFn: async () => "Refactor planning instructions",
          invokeAgentFn: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
          nowFn: () => new Date("2026-02-26T10:00:00.000Z"),
        },
      );
    });

    const state = await readState(projectRoot);
    expect(state.phases.refactor.evaluation_report.status).toBe("created");
    expect(state.phases.refactor.refactor_plan.status).toBe("pending_approval");
  });

  test("rejects when current_phase is define", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, { currentPhase: "define", prototypeApproved: true });

    await withCwd(projectRoot, async () => {
      await expect(runDefineRefactorPlan({ provider: "codex" })).rejects.toThrow(
        "Cannot define refactor plan: current_phase must be 'prototype' or 'refactor'",
      );
    });
  });

  test("accepts when current_phase is prototype and prototype_approved is true, transitions to refactor", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, { currentPhase: "prototype" });

    await withCwd(projectRoot, async () => {
      await runDefineRefactorPlan(
        { provider: "codex" },
        {
          loadSkillFn: async () => "Refactor planning instructions",
          invokeAgentFn: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
          nowFn: () => new Date("2026-02-26T10:00:00.000Z"),
        },
      );
    });

    const state = await readState(projectRoot);
    expect(state.current_phase).toBe("refactor");
    expect(state.phases.refactor.evaluation_report.status).toBe("created");
    expect(state.phases.refactor.refactor_plan.status).toBe("pending_approval");
  });

  test("rejects when refactor.refactor_plan.status is not pending", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, { refactorPlanStatus: "approved" });

    await withCwd(projectRoot, async () => {
      await expect(runDefineRefactorPlan({ provider: "codex" })).rejects.toThrow(
        "Cannot define refactor plan from status 'approved'. Expected pending.",
      );
    });
  });

  test("loads plan-refactor skill, invokes interactive agent, and persists pending_approval state", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot);

    let loadedSkill = "";
    let invocation: { interactive: boolean | undefined; prompt: string } | undefined;

    await withCwd(projectRoot, async () => {
      await runDefineRefactorPlan(
        { provider: "codex" },
        {
          loadSkillFn: async (_root, skillName) => {
            loadedSkill = skillName;
            return "Refactor planning instructions from SKILL.md";
          },
          invokeAgentFn: async (options): Promise<AgentResult> => {
            invocation = {
              interactive: options.interactive,
              prompt: options.prompt,
            };
            return { exitCode: 0, stdout: "", stderr: "" };
          },
          nowFn: () => new Date("2026-02-26T10:00:00.000Z"),
        },
      );
    });

    expect(loadedSkill).toBe("plan-refactor");
    if (invocation === undefined) {
      throw new Error("Agent invocation was not captured");
    }
    expect(invocation.interactive).toBe(true);
    expect(invocation.prompt).toContain("Refactor planning instructions from SKILL.md");
    expect(invocation.prompt).toContain("### current_iteration");
    expect(invocation.prompt).toContain("000013");

    const state = await readState(projectRoot);
    expect(state.phases.refactor.evaluation_report.status).toBe("created");
    expect(state.phases.refactor.evaluation_report.file).toBe(
      "it_000013_evaluation-report.md",
    );
    expect(state.phases.refactor.refactor_plan.status).toBe("pending_approval");
    expect(state.phases.refactor.refactor_plan.file).toBe("it_000013_refactor-plan.md");
    expect(state.last_updated).toBe("2026-02-26T10:00:00.000Z");
    expect(state.updated_by).toBe("nvst:define-refactor-plan");
  });
});
