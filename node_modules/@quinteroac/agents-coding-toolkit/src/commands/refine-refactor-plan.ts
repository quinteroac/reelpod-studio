import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  buildPrompt,
  invokeAgent,
  loadSkill,
  type AgentInvokeOptions,
  type AgentProvider,
  type AgentResult,
} from "../agent";
import { assertGuardrail } from "../guardrail";
import { exists, FLOW_REL_DIR, readState } from "../state";

export interface RefineRefactorPlanOptions {
  provider: AgentProvider;
  challenge: boolean;
  force?: boolean;
}

interface RefineRefactorPlanDeps {
  existsFn: (path: string) => Promise<boolean>;
  invokeAgentFn: (options: AgentInvokeOptions) => Promise<AgentResult>;
  loadSkillFn: (projectRoot: string, skillName: string) => Promise<string>;
  readFileFn: typeof readFile;
}

const defaultDeps: RefineRefactorPlanDeps = {
  existsFn: exists,
  invokeAgentFn: invokeAgent,
  loadSkillFn: loadSkill,
  readFileFn: readFile,
};

export async function runRefineRefactorPlan(
  opts: RefineRefactorPlanOptions,
  deps: Partial<RefineRefactorPlanDeps> = {},
): Promise<void> {
  const { provider, challenge, force = false } = opts;
  const projectRoot = process.cwd();
  const state = await readState(projectRoot);
  const mergedDeps: RefineRefactorPlanDeps = { ...defaultDeps, ...deps };

  const refactorPlan = state.phases.refactor.refactor_plan;
  await assertGuardrail(
    state,
    refactorPlan.status !== "pending_approval",
    `Cannot refine refactor plan from status '${refactorPlan.status}'. Expected pending_approval.`,
    { force },
  );

  const refactorPlanFile = refactorPlan.file;
  if (!refactorPlanFile) {
    throw new Error("Cannot refine refactor plan: refactor.refactor_plan.file is missing.");
  }

  const refactorPlanPath = join(projectRoot, FLOW_REL_DIR, refactorPlanFile);
  if (!(await mergedDeps.existsFn(refactorPlanPath))) {
    throw new Error(`Cannot refine refactor plan: file not found at ${refactorPlanPath}`);
  }

  let skillBody: string;
  try {
    skillBody = await mergedDeps.loadSkillFn(projectRoot, "refine-refactor-plan");
  } catch {
    throw new Error(
      "Required skill missing: expected .agents/skills/refine-refactor-plan/SKILL.md.",
    );
  }

  const refactorPlanContent = await mergedDeps.readFileFn(refactorPlanPath, "utf8");
  const context: Record<string, string> = {
    current_iteration: state.current_iteration,
    refactor_plan_file: refactorPlanFile,
    refactor_plan_content: refactorPlanContent,
  };

  if (challenge) {
    context.mode = "challenger";
  }

  const prompt = buildPrompt(skillBody, context);
  const result = await mergedDeps.invokeAgentFn({
    provider,
    prompt,
    cwd: projectRoot,
    interactive: true,
  });

  if (result.exitCode !== 0) {
    throw new Error(`Agent invocation failed with exit code ${result.exitCode}.`);
  }

  console.log("Refactor plan refined.");
}
