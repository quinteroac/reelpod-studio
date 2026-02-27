import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PrdSchema } from "../../scaffold/schemas/tmpl_prd";
import { readState, writeState } from "../state";
import { runApproveRequirement } from "./approve-requirement";

async function createProjectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nvst-approve-requirement-"));
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
  status: "pending" | "in_progress" | "approved",
  file: string | null,
) {
  await mkdir(join(projectRoot, ".agents", "flow"), { recursive: true });
  await writeState(projectRoot, {
    current_iteration: "000001",
    current_phase: "define",
    phases: {
      define: {
        requirement_definition: { status, file },
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
    last_updated: "2026-02-20T00:00:00.000Z",
    updated_by: "seed",
    history: [],
  });
}

const MINIMAL_PRD_MARKDOWN = [
  "# Product Requirement Document",
  "## Goals",
  "- Ship the feature",
  "## User Stories",
  "### US-001: Core feature",
  "As a developer, I want to build the feature.",
  "**Acceptance Criteria:**",
  "- [ ] Feature is built",
  "## Functional Requirements",
  "- FR-1: The system must do something",
].join("\n");

const createdRoots: string[] = [];

afterEach(async () => {
  process.exitCode = 0;
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("approve requirement command", () => {
  test("registers approve requirement command in CLI dispatch", async () => {
    const source = await readFile(join(process.cwd(), "src", "cli.ts"), "utf8");

    expect(source).toContain('import { runApproveRequirement } from "./commands/approve-requirement";');
    expect(source).toContain('if (subcommand === "requirement") {');
    expect(source).toContain("await runApproveRequirement({ force });");
  });

  test("rejects when requirement_definition.status is not in_progress", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "pending", "it_000001_product-requirement-document.md");

    await withCwd(projectRoot, async () => {
      await expect(runApproveRequirement()).rejects.toThrow(
        "Cannot approve requirement from status 'pending'. Expected in_progress.",
      );
    });
  });

  test("rejects when requirement_definition.file is null", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "in_progress", null);

    await withCwd(projectRoot, async () => {
      await expect(runApproveRequirement()).rejects.toThrow(
        "Cannot approve requirement: define.requirement_definition.file is missing.",
      );
    });
  });

  test("rejects when requirement file does not exist on disk", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "in_progress", "it_000001_product-requirement-document.md");

    await withCwd(projectRoot, async () => {
      await expect(runApproveRequirement()).rejects.toThrow(
        "Cannot approve requirement: file not found at",
      );
    });
  });

  test("approves requirement, generates PRD JSON via write-json, and updates state fields", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "in_progress", "it_000001_product-requirement-document.md");

    const requirementPath = join(
      projectRoot,
      ".agents",
      "flow",
      "it_000001_product-requirement-document.md",
    );
    await writeFile(requirementPath, MINIMAL_PRD_MARKDOWN, "utf8");

    let capturedSchema = "";
    let capturedOutPath = "";
    let capturedPayload = "";

    await withCwd(projectRoot, async () => {
      await runApproveRequirement({
        invokeWriteJsonFn: async (_root, schemaName, outPath, data) => {
          capturedSchema = schemaName;
          capturedOutPath = outPath;
          capturedPayload = data;
          await writeFile(join(projectRoot, outPath), data, "utf8");
          return { exitCode: 0, stderr: "" };
        },
        nowFn: () => new Date("2026-02-20T08:00:00.000Z"),
      });
    });

    expect(capturedSchema).toBe("prd");
    expect(capturedOutPath).toBe(".agents/flow/it_000001_PRD.json");

    const parsedPayload = JSON.parse(capturedPayload) as unknown;
    const validation = PrdSchema.safeParse(parsedPayload);
    expect(validation.success).toBe(true);
    if (!validation.success) {
      throw new Error("Expected PRD payload to be valid");
    }
    expect(validation.data.goals).toEqual(["Ship the feature"]);
    expect(validation.data.userStories[0]).toMatchObject({
      id: "US-001",
      title: "Core feature",
    });
    expect(validation.data.functionalRequirements[0]).toEqual({
      id: "FR-1",
      description: "The system must do something",
    });

    const state = await readState(projectRoot);
    expect(state.phases.define.requirement_definition.status).toBe("approved");
    expect(state.phases.define.prd_generation.status).toBe("completed");
    expect(state.phases.define.prd_generation.file).toBe("it_000001_PRD.json");
    expect(state.last_updated).toBe("2026-02-20T08:00:00.000Z");
    expect(state.updated_by).toBe("nvst:approve-requirement");
  });

  test("prints error and keeps status in_progress when write-json fails", async () => {
    const projectRoot = await createProjectRoot();
    createdRoots.push(projectRoot);
    await seedState(projectRoot, "in_progress", "it_000001_product-requirement-document.md");

    const requirementPath = join(
      projectRoot,
      ".agents",
      "flow",
      "it_000001_product-requirement-document.md",
    );
    await writeFile(requirementPath, MINIMAL_PRD_MARKDOWN, "utf8");

    const capturedErrors: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      capturedErrors.push(args.map((arg) => String(arg)).join(" "));
    };

    try {
      await withCwd(projectRoot, async () => {
        await runApproveRequirement({
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
      "PRD JSON generation failed. Requirement remains in_progress.",
    );
    expect(capturedErrors[1]).toContain("mock write-json failure");

    const state = await readState(projectRoot);
    expect(state.phases.define.requirement_definition.status).toBe("in_progress");
    expect(state.last_updated).toBe("2026-02-20T00:00:00.000Z");
    expect(state.updated_by).toBe("seed");
  });
});
