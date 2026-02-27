import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentResult } from "../agent";
import { readState, writeState } from "../state";
import { runRefineRefactorPlan } from "./refine-refactor-plan";

async function createProjectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nvst-refine-refactor-plan-"));
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
  status: "pending" | "pending_approval" | "approved",
  file: string | null,
): Promise<void> {
  await mkdir(join(projectRoot, ".agents", "flow"), { recursive: true });

  await writeState(projectRoot, {
    current_iteration: "000013",
    current_phase: "refactor",
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
        prototype_approved: true,
      },
      refactor: {
        evaluation_report: { status: "created", file: "it_000013_evaluation-report.md" },
        refactor_plan: { status, file },
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

describe("refine refactor-plan command", () => {
  test("registers refine refactor-plan command in CLI dispatch", async () => {
    const source = await readFile(join(process.cwd(), "src", "cli.ts"), "utf8");

    expect(source).toContain('import { runRefineRefactorPlan } from "./commands/refine-refactor-plan";');
    expect(source).toContain('if (subcommand === "refactor-plan") {');
    expect(source).toContain('const challenge = postForceArgs.includes("--challenge");');
    expect(source).toContain("await runRefineRefactorPlan({ provider, challenge, force });");
  });

  test("requires refactor.refactor_plan.status to be pending_approval", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "approved", "it_000013_refactor-plan.md");

    await withCwd(projectRoot, async () => {
      await expect(
        runRefineRefactorPlan(
          { provider: "codex", challenge: false },
          {
            loadSkillFn: async () => "unused",
            invokeAgentFn: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
          },
        ),
      ).rejects.toThrow(
        "Cannot refine refactor plan from status 'approved'. Expected pending_approval.",
      );
    });
  });

  test("rejects when refactor.refactor_plan.file is missing", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "pending_approval", null);

    await withCwd(projectRoot, async () => {
      await expect(
        runRefineRefactorPlan(
          { provider: "codex", challenge: false },
          {
            loadSkillFn: async () => "unused",
            invokeAgentFn: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
          },
        ),
      ).rejects.toThrow("Cannot refine refactor plan: refactor.refactor_plan.file is missing.");
    });
  });

  test("rejects when refactor plan file does not exist on disk", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "pending_approval", "it_000013_refactor-plan.md");

    await withCwd(projectRoot, async () => {
      await expect(
        runRefineRefactorPlan(
          { provider: "codex", challenge: false },
          {
            loadSkillFn: async () => "unused",
            invokeAgentFn: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
          },
        ),
      ).rejects.toThrow("Cannot refine refactor plan: file not found at");
    });
  });

  test("loads refine-refactor-plan skill, reads file context, invokes interactively, and does not mutate state", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "pending_approval", "it_000013_refactor-plan.md");

    const refactorPlanPath = join(projectRoot, ".agents", "flow", "it_000013_refactor-plan.md");
    await writeFile(refactorPlanPath, "# Current Refactor Plan\n- Refactor module A\n", "utf8");

    let loadedSkill = "";
    let invocation: { interactive: boolean | undefined; prompt: string } | undefined;
    const stateBefore = JSON.stringify(await readState(projectRoot));

    await withCwd(projectRoot, async () => {
      await runRefineRefactorPlan(
        { provider: "codex", challenge: false },
        {
          loadSkillFn: async (_root, skillName) => {
            loadedSkill = skillName;
            return "Refine refactor plan skill";
          },
          invokeAgentFn: async (options): Promise<AgentResult> => {
            invocation = {
              interactive: options.interactive,
              prompt: options.prompt,
            };
            return { exitCode: 0, stdout: "", stderr: "" };
          },
        },
      );
    });

    expect(loadedSkill).toBe("refine-refactor-plan");
    if (invocation === undefined) {
      throw new Error("Agent invocation was not captured");
    }

    expect(invocation.interactive).toBe(true);
    expect(invocation.prompt).toContain("### current_iteration");
    expect(invocation.prompt).toContain("000013");
    expect(invocation.prompt).toContain("### refactor_plan_file");
    expect(invocation.prompt).toContain("it_000013_refactor-plan.md");
    expect(invocation.prompt).toContain("### refactor_plan_content");
    expect(invocation.prompt).toContain("# Current Refactor Plan");

    const stateAfter = JSON.stringify(await readState(projectRoot));
    expect(stateAfter).toBe(stateBefore);
  });

  test("passes mode=challenger in prompt context when challenge mode is enabled", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "pending_approval", "it_000013_refactor-plan.md");

    const refactorPlanPath = join(projectRoot, ".agents", "flow", "it_000013_refactor-plan.md");
    await writeFile(refactorPlanPath, "# Current Refactor Plan\n- Refactor module B\n", "utf8");

    let invocationPrompt = "";
    const stateBefore = JSON.stringify(await readState(projectRoot));

    await withCwd(projectRoot, async () => {
      await runRefineRefactorPlan(
        { provider: "codex", challenge: true },
        {
          loadSkillFn: async () => "Refine refactor plan skill",
          invokeAgentFn: async (options): Promise<AgentResult> => {
            invocationPrompt = options.prompt;
            return { exitCode: 0, stdout: "", stderr: "" };
          },
        },
      );
    });

    expect(invocationPrompt).toContain("### mode");
    expect(invocationPrompt).toContain("challenger");

    const stateAfter = JSON.stringify(await readState(projectRoot));
    expect(stateAfter).toBe(stateBefore);
  });
});
