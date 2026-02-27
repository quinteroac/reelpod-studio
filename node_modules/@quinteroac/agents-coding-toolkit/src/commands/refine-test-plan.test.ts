import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentResult } from "../agent";
import { readState, writeState } from "../state";
import { runRefineTestPlan } from "./refine-test-plan";

async function createProjectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nvst-refine-test-plan-"));
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
  status: "pending" | "pending_approval" | "created",
  file: string | null,
) {
  await mkdir(join(projectRoot, ".agents", "flow"), { recursive: true });

  await writeState(projectRoot, {
    current_iteration: "000003",
    current_phase: "prototype",
    phases: {
      define: {
        requirement_definition: { status: "approved", file: "it_000003_product-requirement-document.md" },
        prd_generation: { status: "completed", file: "it_000003_PRD.json" },
      },
      prototype: {
        project_context: { status: "created", file: ".agents/PROJECT_CONTEXT.md" },
        test_plan: { status, file },
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
    last_updated: "2026-02-21T00:00:00.000Z",
    updated_by: "seed",
    history: [],
  });
}

const createdRoots: string[] = [];

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("refine test-plan command", () => {
  test("registers refine test-plan command in CLI dispatch", async () => {
    const source = await readFile(join(process.cwd(), "src", "cli.ts"), "utf8");

    expect(source).toContain('import { runRefineTestPlan } from "./commands/refine-test-plan";');
    expect(source).toContain('if (subcommand === "test-plan") {');
    expect(source).toContain('const challenge = postForceArgs.includes("--challenge");');
    expect(source).toContain("await runRefineTestPlan({ provider, challenge, force });");
  });

  test("loads refine-test-plan skill, reads test plan file context, invokes agent interactively, and does not update state", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "pending_approval", "it_000003_test-plan.md");

    const testPlanPath = join(projectRoot, ".agents", "flow", "it_000003_test-plan.md");
    await writeFile(testPlanPath, "# Existing Test Plan\n- Case A\n", "utf8");

    let loadedSkill = "";
    let invocation: { interactive: boolean | undefined; prompt: string } | undefined;
    const stateBefore = JSON.stringify(await readState(projectRoot));

    await withCwd(projectRoot, async () => {
      await runRefineTestPlan(
        { provider: "codex", challenge: false },
        {
          loadSkillFn: async (_root, skillName) => {
            loadedSkill = skillName;
            return "Refine test plan skill";
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

    expect(loadedSkill).toBe("refine-test-plan");
    if (invocation === undefined) {
      throw new Error("Agent invocation was not captured");
    }

    expect(invocation.interactive).toBe(true);
    expect(invocation.prompt).toContain("### current_iteration");
    expect(invocation.prompt).toContain("000003");
    expect(invocation.prompt).toContain("### test_plan_file");
    expect(invocation.prompt).toContain("it_000003_test-plan.md");
    expect(invocation.prompt).toContain("### test_plan_content");
    expect(invocation.prompt).toContain("# Existing Test Plan");

    const stateAfter = JSON.stringify(await readState(projectRoot));
    expect(stateAfter).toBe(stateBefore);
  });

  test("passes mode=challenger in prompt context when challenge mode is enabled without updating state", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "pending_approval", "it_000003_test-plan.md");

    const testPlanPath = join(projectRoot, ".agents", "flow", "it_000003_test-plan.md");
    await writeFile(testPlanPath, "# Existing Test Plan\n- Case B\n", "utf8");

    let invocationPrompt = "";
    const stateBefore = JSON.stringify(await readState(projectRoot));

    await withCwd(projectRoot, async () => {
      await runRefineTestPlan(
        { provider: "codex", challenge: true },
        {
          loadSkillFn: async () => "Refine test plan skill",
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

  test("requires test_plan.status to be pending_approval", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "pending", "it_000003_test-plan.md");

    await withCwd(projectRoot, async () => {
      await expect(
        runRefineTestPlan(
          { provider: "codex", challenge: false },
          {
            loadSkillFn: async () => "unused",
            invokeAgentFn: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
          },
        ),
      ).rejects.toThrow("Cannot refine test plan from status 'pending'. Expected pending_approval.");
    });
  });
});

describe("refine-test-plan skill definition", () => {
  test("has YAML frontmatter and required editor/challenger guidance", async () => {
    const skillPath = join(
      process.cwd(),
      ".agents",
      "skills",
      "refine-test-plan",
      "SKILL.md",
    );
    const source = await readFile(skillPath, "utf8");

    expect(source.startsWith("---\n")).toBe(true);
    expect(source).toContain("name: refine-test-plan");
    expect(source).toContain("description:");
    expect(source).toContain("user-invocable: true");
    expect(source).toContain("Editor mode");
    expect(source).toContain("default");
    expect(source).toContain("Preserve the existing section structure");
    expect(source).toContain("Challenger mode");
    expect(source).toContain("`mode = \"challenger\"`");
    expect(source).toContain("Coverage gaps");
    expect(source).toContain("Weak or non-verifiable assertions");
    expect(source).toContain("Over-reliance on manual testing");
    expect(source).toContain("Update `it_{current_iteration}_test-plan.md` in place.");
    expect(source).toContain("Same output file path is preserved");
  });
});
