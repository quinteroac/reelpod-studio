import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentResult } from "../agent";
import { readState, writeState } from "../state";
import { parseTestPlanForValidation, runCreateTestPlan } from "./create-test-plan";

async function createProjectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nvst-create-test-plan-"));
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

async function seedState(projectRoot: string, projectContextStatus: "pending" | "pending_approval" | "created") {
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
        project_context: { status: projectContextStatus, file: ".agents/PROJECT_CONTEXT.md" },
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
    last_updated: "2026-02-20T00:00:00.000Z",
    updated_by: "seed",
    history: [],
  });

  await writeFile(join(projectRoot, ".agents", "PROJECT_CONTEXT.md"), "# Context\n", "utf8");
}

const createdRoots: string[] = [];

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("create test-plan command", () => {
  test("registers create test-plan command in CLI dispatch", async () => {
    const source = await readFile(join(process.cwd(), "src", "cli.ts"), "utf8");

    expect(source).toContain('import { runCreateTestPlan } from "./commands/create-test-plan";');
    expect(source).toContain('if (subcommand === "test-plan") {');
    expect(source).toContain("await runCreateTestPlan({ provider, force });");
  });

  test("loads create-test-plan skill, invokes agent interactively with iteration context, writes state", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "created");

    let loadedSkill = "";
    let invocation: { interactive: boolean | undefined; prompt: string } | undefined;
    const outputPath = join(projectRoot, ".agents", "flow", "it_000003_test-plan.md");

    await withCwd(projectRoot, async () => {
      await runCreateTestPlan(
        { provider: "codex" },
        {
          loadSkillFn: async (_root, skillName) => {
            loadedSkill = skillName;
            return [
              "# Create Test Plan",
              "Every functional requirement (`FR-N`) must appear in at least one test case `Correlated Requirements` field.",
              "Use this table column exactly: Correlated Requirements (US-XXX, FR-X).",
            ].join("\n");
          },
          invokeAgentFn: async (options): Promise<AgentResult> => {
            invocation = {
              interactive: options.interactive,
              prompt: options.prompt,
            };
            await writeFile(
              outputPath,
              [
                "# Test Plan - Iteration 000003",
                "## User Story: US-001 - Example Story",
                "| Test Case ID | Description | Type (unit/integration/e2e) | Mode (automated/manual) | Correlated Requirements (US-XXX, FR-X) | Expected Result |",
                "|---|---|---|---|---|---|",
                "| TC-US001-01 | Validate login success | integration | automated | US-001, FR-1 | Login succeeds with valid credentials |",
                "## Scope",
                "- Validate login and session behavior",
                "## Environment and data",
                "- Node 22 with seeded test user",
              ].join("\n"),
              "utf8",
            );
            return { exitCode: 0, stdout: "", stderr: "" };
          },
          nowFn: () => new Date("2026-02-21T03:00:00.000Z"),
        },
      );
    });

    expect(loadedSkill).toBe("create-test-plan");
    if (invocation === undefined) {
      throw new Error("Agent invocation was not captured");
    }
    expect(invocation.interactive).toBe(true);
    expect(invocation.prompt).toContain("### iteration");
    expect(invocation.prompt).toContain("000003");
    expect(invocation.prompt).toContain("Correlated Requirements (US-XXX, FR-X)");
    expect(invocation.prompt).toContain(
      "Every functional requirement (`FR-N`) must appear in at least one test case `Correlated Requirements` field.",
    );

    const content = await readFile(outputPath, "utf8");
    expect(content).toContain("# Test Plan");

    const state = await readState(projectRoot);
    expect(state.phases.prototype.test_plan.status).toBe("pending_approval");
    expect(state.phases.prototype.test_plan.file).toBe("it_000003_test-plan.md");
    expect(state.last_updated).toBe("2026-02-21T03:00:00.000Z");
    expect(state.updated_by).toBe("nvst:create-test-plan");
  });

  test("supports --agent cursor and writes stdout output to the test-plan file", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "created");

    const outputPath = join(projectRoot, ".agents", "flow", "it_000003_test-plan.md");
    let capturedPrompt = "";
    let capturedProvider = "";

    await withCwd(projectRoot, async () => {
      await runCreateTestPlan(
        { provider: "cursor" },
        {
          loadSkillFn: async () => "Create a test plan using iteration and project context.",
          invokeAgentFn: async (options): Promise<AgentResult> => {
            capturedPrompt = options.prompt;
            capturedProvider = options.provider;
            return {
              exitCode: 0,
              stdout: [
                "# Test Plan - Iteration 000003",
                "## User Story: US-001 - Cursor flow",
                "| Test Case ID | Description | Type (unit/integration/e2e) | Mode (automated/manual) | Correlated Requirements (US-XXX, FR-X) | Expected Result |",
                "|---|---|---|---|---|---|",
                "| TC-US001-01 | Validate cursor provider flow | integration | automated | US-001, FR-1 | Cursor provider generates plan output |",
                "## Scope",
                "- Cursor provider compatibility",
                "## Environment and data",
                "- Local dev shell",
              ].join("\n"),
              stderr: "",
            };
          },
          nowFn: () => new Date("2026-02-21T03:30:00.000Z"),
        },
      );
    });

    expect(capturedProvider).toBe("cursor");
    expect(capturedPrompt).toContain("### iteration");
    expect(capturedPrompt).toContain("000003");
    expect(capturedPrompt).toContain("### project_context");
    expect(capturedPrompt).toContain("# Context");

    const content = await readFile(outputPath, "utf8");
    expect(content).toContain("TC-US001-01");
    expect(content).toContain("Cursor provider compatibility");

    const state = await readState(projectRoot);
    expect(state.phases.prototype.test_plan.status).toBe("pending_approval");
    expect(state.phases.prototype.test_plan.file).toBe("it_000003_test-plan.md");
    expect(state.last_updated).toBe("2026-02-21T03:30:00.000Z");
    expect(state.updated_by).toBe("nvst:create-test-plan");
  });

  test("requires project_context.status to be created", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "pending");

    await withCwd(projectRoot, async () => {
      await expect(
        runCreateTestPlan(
          { provider: "codex" },
          {
            loadSkillFn: async () => "unused",
            invokeAgentFn: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
          },
        ),
      ).rejects.toThrow("Cannot create test plan: prototype.project_context.status must be created");
    });
  });

  test("asks for confirmation before overwrite and cancels when denied", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "created");

    const outputPath = join(projectRoot, ".agents", "flow", "it_000003_test-plan.md");
    await writeFile(outputPath, "old", "utf8");

    let confirmCalls = 0;
    let invokeCalls = 0;

    await withCwd(projectRoot, async () => {
      await runCreateTestPlan(
        { provider: "codex" },
        {
          confirmOverwriteFn: async () => {
            confirmCalls += 1;
            return false;
          },
          loadSkillFn: async () => "unused",
          invokeAgentFn: async () => {
            invokeCalls += 1;
            return { exitCode: 0, stdout: "", stderr: "" };
          },
        },
      );
    });

    expect(confirmCalls).toBe(1);
    expect(invokeCalls).toBe(0);

    const state = await readState(projectRoot);
    expect(state.phases.prototype.test_plan.status).toBe("pending");
    expect(state.phases.prototype.test_plan.file).toBeNull();
  });

  test("force overwrite bypasses confirmation", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "created");

    const outputPath = join(projectRoot, ".agents", "flow", "it_000003_test-plan.md");
    await writeFile(outputPath, "old", "utf8");

    let confirmCalled = false;
    let invokeCalls = 0;

    await withCwd(projectRoot, async () => {
      await runCreateTestPlan(
        { provider: "codex", force: true },
        {
          confirmOverwriteFn: async () => {
            confirmCalled = true;
            return true;
          },
          loadSkillFn: async () => "skill",
          invokeAgentFn: async () => {
            invokeCalls += 1;
            await writeFile(
              outputPath,
              [
                "# Test Plan - Iteration 000003",
                "## User Story: US-001 - Example Story",
                "| Test Case ID | Description | Type (unit/integration/e2e) | Mode (automated/manual) | Correlated Requirements (US-XXX, FR-X) | Expected Result |",
                "|---|---|---|---|---|---|",
                "| TC-US001-01 | Validate login success | integration | automated | US-001, FR-1 | Login succeeds with valid credentials |",
              ].join("\n"),
              "utf8",
            );
            return { exitCode: 0, stdout: "", stderr: "" };
          },
        },
      );
    });

    expect(confirmCalled).toBe(false);
    expect(invokeCalls).toBe(1);
    expect(await readFile(outputPath, "utf8")).toContain("Correlated Requirements");
  });

  test("fails when generated markdown table omits correlated requirement IDs", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "created");

    const outputPath = join(projectRoot, ".agents", "flow", "it_000003_test-plan.md");

    await withCwd(projectRoot, async () => {
      await expect(
        runCreateTestPlan(
          { provider: "codex" },
          {
            loadSkillFn: async () => "skill",
            invokeAgentFn: async () => {
              await writeFile(
                outputPath,
                [
                  "# Test Plan - Iteration 000003",
                  "## User Story: US-001 - Example Story",
                  "| Test Case ID | Description | Type (unit/integration/e2e) | Mode (automated/manual) | Expected Result |",
                  "|---|---|---|---|---|",
                  "| TC-US001-01 | Validate login success | integration | automated | Login succeeds with valid credentials |",
                ].join("\n"),
                "utf8",
              );
              return { exitCode: 0, stdout: "", stderr: "" };
            },
          },
        ),
      ).rejects.toThrow(
        "Generated test plan does not satisfy traceability requirements for the test-plan schema.",
      );
    });

    const state = await readState(projectRoot);
    expect(state.phases.prototype.test_plan.status).toBe("pending");
    expect(state.phases.prototype.test_plan.file).toBeNull();
  });
});

describe("create-test-plan skill definition", () => {
  test("has YAML frontmatter and required automation-first instructions", async () => {
    const skillPath = join(
      process.cwd(),
      ".agents",
      "skills",
      "create-test-plan",
      "SKILL.md",
    );
    const source = await readFile(skillPath, "utf8");

    expect(source.startsWith("---\n")).toBe(true);
    expect(source).toContain("name: create-test-plan");
    expect(source).toContain("description:");
    expect(source).toContain("user-invocable: true");
    expect(source).toContain("Read these first to understand what must be tested:");
    expect(source).toContain("`it_{iteration}_PRD.json`");
    expect(source).toContain("`.agents/PROJECT_CONTEXT.md`");
    expect(source).toContain("structured by user story");
    expect(source).toContain("| Test Case ID | Description | Type (unit/integration/e2e) | Mode (automated/manual) | Correlated Requirements (US-XXX, FR-X) | Expected Result |");
    expect(source).toContain("Every functional requirement (`FR-N`) must have automated coverage.");
    expect(source).toContain("Every functional requirement (`FR-N`) must appear in at least one test case `Correlated Requirements` field.");
    expect(source).toContain("`Correlated Requirements` with at least one requirement ID (`US-XXX`, `FR-X`)");
    expect(source).toContain(
      "Manual tests are allowed only for UI/UX nuances that cannot be reliably validated through DOM/state assertions",
    );
    expect(source).toContain("`.agents/flow/it_{iteration}_test-plan.md`");
  });
});

describe("parseTestPlanForValidation", () => {
  test("maps requirement traceability into schema-compatible test items", () => {
    const parsed = parseTestPlanForValidation(
      [
        "# Test Plan - Iteration 000003",
        "| Test Case ID | Description | Type (unit/integration/e2e) | Mode (automated/manual) | Correlated Requirements (US-XXX, FR-X) | Expected Result |",
        "|---|---|---|---|---|---|",
        "| TC-US001-01 | Validate login success | integration | automated | US-001, FR-1 | Login succeeds with valid credentials |",
      ].join("\n"),
    );

    expect(parsed.overallStatus).toBe("pending");
    expect(parsed.automatedTests).toHaveLength(1);
    expect(parsed.automatedTests[0]?.correlatedRequirements).toEqual(["US-001", "FR-1"]);
  });
});
