import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RefactorPrdSchema } from "../../scaffold/schemas/tmpl_refactor-prd";
import { readState, writeState } from "../state";
import { parseRefactorPlan, runApproveRefactorPlan } from "./approve-refactor-plan";

async function createProjectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nvst-approve-refactor-plan-"));
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
) {
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
        tp_generation: { status: "created", file: "it_000013_TP.json" },
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
  process.exitCode = 0;
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("approve refactor-plan command", () => {
  test("registers approve refactor-plan command in CLI dispatch", async () => {
    const source = await readFile(join(process.cwd(), "src", "cli.ts"), "utf8");

    expect(source).toContain('import { runApproveRefactorPlan } from "./commands/approve-refactor-plan";');
    expect(source).toContain('if (subcommand === "refactor-plan") {');
    expect(source).toContain("await runApproveRefactorPlan({ force });");
  });

  test("requires refactor.refactor_plan.status to be pending_approval", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "pending", "it_000013_refactor-plan.md");

    await withCwd(projectRoot, async () => {
      await expect(runApproveRefactorPlan()).rejects.toThrow(
        "Cannot approve refactor plan from status 'pending'. Expected pending_approval.",
      );
    });
  });

  test("rejects when refactor.refactor_plan.file is missing", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "pending_approval", null);

    await withCwd(projectRoot, async () => {
      await expect(runApproveRefactorPlan()).rejects.toThrow(
        "Cannot approve refactor plan: refactor.refactor_plan.file is missing.",
      );
    });
  });

  test("rejects when refactor plan file does not exist on disk", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "pending_approval", "it_000013_refactor-plan.md");

    await withCwd(projectRoot, async () => {
      await expect(runApproveRefactorPlan()).rejects.toThrow(
        "Cannot approve refactor plan: file not found at",
      );
    });
  });

  test("approves refactor plan, generates refactor-prd JSON via write-json, and updates state fields", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "pending_approval", "it_000013_refactor-plan.md");

    const refactorPlanPath = join(projectRoot, ".agents", "flow", "it_000013_refactor-plan.md");
    await writeFile(
      refactorPlanPath,
      [
        "# Refactor Plan",
        "## Refactor Items",
        "### RI-001: Consolidate state updates",
        "**Description:** Move scattered state mutation into a single helper.",
        "**Rationale:** Reduces duplication and lowers the risk of inconsistent transitions.",
        "### RI-002: Improve command dependency injection",
        "**Description:**",
        "Allow command helpers to accept overrideable I/O dependencies for tests.",
        "**Rationale:**",
        "Improves testability and keeps behavior deterministic in unit tests.",
      ].join("\n"),
      "utf8",
    );

    let capturedSchema = "";
    let capturedOutPath = "";
    let capturedPayload = "";

    await withCwd(projectRoot, async () => {
      await runApproveRefactorPlan({
        invokeWriteJsonFn: async (_root, schemaName, outPath, data) => {
          capturedSchema = schemaName;
          capturedOutPath = outPath;
          capturedPayload = data;
          await writeFile(join(projectRoot, outPath), data, "utf8");
          return { exitCode: 0, stderr: "" };
        },
        nowFn: () => new Date("2026-02-26T12:00:00.000Z"),
      });
    });

    expect(capturedSchema).toBe("refactor-prd");
    expect(capturedOutPath).toBe(".agents/flow/it_000013_refactor-prd.json");

    const parsedPayload = JSON.parse(capturedPayload) as unknown;
    const validation = RefactorPrdSchema.safeParse(parsedPayload);
    expect(validation.success).toBe(true);
    if (!validation.success) {
      throw new Error("Expected refactor-prd payload to be valid");
    }
    expect(validation.data.refactorItems).toEqual([
      {
        id: "RI-001",
        title: "Consolidate state updates",
        description: "Move scattered state mutation into a single helper.",
        rationale: "Reduces duplication and lowers the risk of inconsistent transitions.",
      },
      {
        id: "RI-002",
        title: "Improve command dependency injection",
        description: "Allow command helpers to accept overrideable I/O dependencies for tests.",
        rationale: "Improves testability and keeps behavior deterministic in unit tests.",
      },
    ]);

    const state = await readState(projectRoot);
    expect(state.phases.refactor.refactor_plan.status).toBe("approved");
    expect(state.last_updated).toBe("2026-02-26T12:00:00.000Z");
    expect(state.updated_by).toBe("nvst:approve-refactor-plan");
  });

  test("prints an error and keeps refactor plan pending_approval when write-json fails", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "pending_approval", "it_000013_refactor-plan.md");

    const refactorPlanPath = join(projectRoot, ".agents", "flow", "it_000013_refactor-plan.md");
    await writeFile(
      refactorPlanPath,
      [
        "# Refactor Plan",
        "## Refactor Items",
        "### RI-001: Keep pending on write-json failure",
        "**Description:** Simulate a downstream write-json error.",
        "**Rationale:** State must not mutate when serialization/validation fails.",
      ].join("\n"),
      "utf8",
    );

    const capturedErrors: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      capturedErrors.push(args.map((arg) => String(arg)).join(" "));
    };

    try {
      await withCwd(projectRoot, async () => {
        await runApproveRefactorPlan({
          invokeWriteJsonFn: async () => ({
            exitCode: 1,
            stderr: "mock write-json failure",
          }),
        });
      });
    } finally {
      console.error = originalConsoleError;
    }

    expect(process.exitCode).toBe(1);
    expect(capturedErrors[0]).toContain(
      "Refactor PRD JSON generation failed. Refactor plan remains pending_approval.",
    );
    expect(capturedErrors[1]).toContain("mock write-json failure");

    const state = await readState(projectRoot);
    expect(state.phases.refactor.refactor_plan.status).toBe("pending_approval");
    expect(state.last_updated).toBe("2026-02-26T00:00:00.000Z");
    expect(state.updated_by).toBe("seed");
  });

  test("parseRefactorPlan extracts items from markdown sections", () => {
    const parsed = parseRefactorPlan(
      [
        "# Refactor Plan",
        "## Refactor Items",
        "### ri-007: Normalize line endings",
        "**Description:** Convert generated markdown outputs to LF only.",
        "**Rationale:** Avoid cross-platform diff noise in CI.",
      ].join("\n"),
    );

    expect(parsed).toEqual({
      refactorItems: [
        {
          id: "RI-007",
          title: "Normalize line endings",
          description: "Convert generated markdown outputs to LF only.",
          rationale: "Avoid cross-platform diff noise in CI.",
        },
      ],
    });
    const validation = RefactorPrdSchema.safeParse(parsed);
    expect(validation.success).toBe(true);
  });
});
