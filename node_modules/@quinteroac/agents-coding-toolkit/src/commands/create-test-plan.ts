import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import {
  buildPrompt,
  invokeAgent,
  loadSkill,
  type AgentInvokeOptions,
  type AgentProvider,
  type AgentResult,
} from "../agent";
import { assertGuardrail } from "../guardrail";
import { exists, FLOW_REL_DIR, readState, writeState } from "../state";
import { TestPlanSchema, type TestPlan } from "../../scaffold/schemas/tmpl_test-plan";

export interface CreateTestPlanOptions {
  provider: AgentProvider;
  force?: boolean;
}

interface CreateTestPlanDeps {
  confirmOverwriteFn: (question: string) => Promise<boolean>;
  existsFn: (path: string) => Promise<boolean>;
  invokeAgentFn: (options: AgentInvokeOptions) => Promise<AgentResult>;
  loadSkillFn: (projectRoot: string, skillName: string) => Promise<string>;
  mkdirFn: typeof mkdir;
  nowFn: () => Date;
  readFileFn: typeof readFile;
}

const defaultDeps: CreateTestPlanDeps = {
  confirmOverwriteFn: promptForConfirmation,
  existsFn: exists,
  invokeAgentFn: invokeAgent,
  loadSkillFn: loadSkill,
  mkdirFn: mkdir,
  nowFn: () => new Date(),
  readFileFn: readFile,
};

function parseRequirements(cell: string): string[] {
  return cell
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => /^(US-\d{3}|FR-\d+)$/i.test(entry))
    .map((entry) => entry.toUpperCase());
}

export function parseTestPlanForValidation(markdown: string): TestPlan {
  const scope: string[] = [];
  const environmentData: string[] = [];
  const automatedTests: TestPlan["automatedTests"] = [];
  const exploratoryManualTests: TestPlan["exploratoryManualTests"] = [];

  type Section = "scope" | "environmentData" | null;
  let currentSection: Section = null;
  let inTable = false;

  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();

    if (/^##\s+Scope$/i.test(trimmed)) {
      currentSection = "scope";
      inTable = false;
      continue;
    }
    if (/^##\s+Environment\s*(?:and|&)\s*data$/i.test(trimmed)) {
      currentSection = "environmentData";
      inTable = false;
      continue;
    }

    if (
      trimmed.startsWith("|")
      && trimmed.includes("Test Case ID")
      && trimmed.includes("Correlated Requirements")
    ) {
      inTable = true;
      currentSection = null;
      continue;
    }

    if (inTable && trimmed.startsWith("|")) {
      if (trimmed.includes("---|")) continue;

      const cells = trimmed
        .split("|")
        .map((cell) => cell.trim())
        .filter((cell, index, all) => index > 0 && index < all.length - 1);

      if (cells.length >= 6) {
        const [id, description, , mode, correlatedRequirementsCell] = cells;
        if (id === "Test Case ID") continue;

        const item = {
          id,
          description,
          status: "pending" as const,
          correlatedRequirements: parseRequirements(correlatedRequirementsCell),
        };
        if (mode.toLowerCase().includes("automated")) {
          automatedTests.push(item);
        } else {
          exploratoryManualTests.push(item);
        }
      }
      continue;
    }

    if (inTable && trimmed.length === 0) {
      inTable = false;
      continue;
    }

    if (!currentSection || trimmed.length === 0 || /^<!--/.test(trimmed)) {
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    const value = bulletMatch ? bulletMatch[1].trim() : trimmed;
    if (!value) continue;

    if (currentSection === "scope") scope.push(value);
    if (currentSection === "environmentData") environmentData.push(value);
  }

  return {
    overallStatus: "pending",
    scope,
    environmentData,
    automatedTests,
    exploratoryManualTests,
  };
}

export async function promptForConfirmation(question: string): Promise<boolean> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = (await readline.question(question)).trim();
    return /^y(?:es)?$/i.test(answer);
  } finally {
    readline.close();
  }
}

export async function runCreateTestPlan(
  opts: CreateTestPlanOptions,
  deps: Partial<CreateTestPlanDeps> = {},
): Promise<void> {
  const projectRoot = process.cwd();
  const state = await readState(projectRoot);
  const mergedDeps: CreateTestPlanDeps = { ...defaultDeps, ...deps };

  await assertGuardrail(
    state,
    state.phases.prototype.project_context.status !== "created",
    "Cannot create test plan: prototype.project_context.status must be created. Run `bun nvst approve project-context` first.",
    { force: opts.force },
  );

  const iteration = state.current_iteration;
  const fileName = `it_${iteration}_test-plan.md`;
  const flowDir = join(projectRoot, FLOW_REL_DIR);
  const outputPath = join(flowDir, fileName);

  await mergedDeps.mkdirFn(flowDir, { recursive: true });

  if ((await mergedDeps.existsFn(outputPath)) && !opts.force) {
    const shouldOverwrite = await mergedDeps.confirmOverwriteFn(
      `Test plan file already exists at ${join(FLOW_REL_DIR, fileName)}. Overwrite? [y/N] `,
    );

    if (!shouldOverwrite) {
      console.log("Test plan creation cancelled.");
      return;
    }
  }

  let skillBody: string;
  try {
    skillBody = await mergedDeps.loadSkillFn(projectRoot, "create-test-plan");
  } catch {
    throw new Error(
      "Required skill missing: expected .agents/skills/create-test-plan/SKILL.md.",
    );
  }

  const projectContextPath = join(projectRoot, ".agents", "PROJECT_CONTEXT.md");
  if (!(await mergedDeps.existsFn(projectContextPath))) {
    throw new Error("Project context missing: expected .agents/PROJECT_CONTEXT.md.");
  }

  const projectContextContent = await mergedDeps.readFileFn(projectContextPath, "utf8");
  const prompt = buildPrompt(skillBody, {
    iteration,
    project_context: projectContextContent,
  });

  const result = await mergedDeps.invokeAgentFn({
    provider: opts.provider,
    prompt,
    cwd: projectRoot,
    interactive: true,
  });

  if (result.exitCode !== 0) {
    throw new Error(`Agent invocation failed with exit code ${result.exitCode}.`);
  }

  if (!(await mergedDeps.existsFn(outputPath)) && result.stdout.trim().length > 0) {
    const content = result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`;
    await Bun.write(outputPath, content);
  }

  if (!(await mergedDeps.existsFn(outputPath))) {
    throw new Error(
      `Test plan generation did not produce ${join(FLOW_REL_DIR, fileName)}.`,
    );
  }

  const generatedMarkdown = await mergedDeps.readFileFn(outputPath, "utf8");
  const parsed = parseTestPlanForValidation(generatedMarkdown);
  const totalTestCases = parsed.automatedTests.length + parsed.exploratoryManualTests.length;
  if (totalTestCases === 0) {
    throw new Error(
      "Generated test plan does not satisfy traceability requirements for the test-plan schema.",
    );
  }
  const validation = TestPlanSchema.safeParse(parsed);
  if (!validation.success) {
    throw new Error(
      "Generated test plan does not satisfy traceability requirements for the test-plan schema.",
      { cause: validation.error },
    );
  }

  state.phases.prototype.test_plan.status = "pending_approval";
  state.phases.prototype.test_plan.file = fileName;
  state.last_updated = mergedDeps.nowFn().toISOString();
  state.updated_by = "nvst:create-test-plan";

  await writeState(projectRoot, state);

  console.log("Test plan generated and marked as pending approval.");
}
