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

export interface RefineTestPlanOptions {
  provider: AgentProvider;
  challenge: boolean;
  force?: boolean;
}

interface RefineTestPlanDeps {
  existsFn: (path: string) => Promise<boolean>;
  invokeAgentFn: (options: AgentInvokeOptions) => Promise<AgentResult>;
  loadSkillFn: (projectRoot: string, skillName: string) => Promise<string>;
  readFileFn: typeof readFile;
}

const defaultDeps: RefineTestPlanDeps = {
  existsFn: exists,
  invokeAgentFn: invokeAgent,
  loadSkillFn: loadSkill,
  readFileFn: readFile,
};

export async function runRefineTestPlan(
  opts: RefineTestPlanOptions,
  deps: Partial<RefineTestPlanDeps> = {},
): Promise<void> {
  const { provider, challenge, force = false } = opts;
  const projectRoot = process.cwd();
  const state = await readState(projectRoot);
  const mergedDeps: RefineTestPlanDeps = { ...defaultDeps, ...deps };

  const testPlan = state.phases.prototype.test_plan;
  await assertGuardrail(
    state,
    testPlan.status !== "pending_approval",
    `Cannot refine test plan from status '${testPlan.status}'. Expected pending_approval.`,
    { force },
  );

  const testPlanFile = testPlan.file;
  if (!testPlanFile) {
    throw new Error("Cannot refine test plan: prototype.test_plan.file is missing.");
  }

  const testPlanPath = join(projectRoot, FLOW_REL_DIR, testPlanFile);
  if (!(await mergedDeps.existsFn(testPlanPath))) {
    throw new Error(`Cannot refine test plan: file not found at ${testPlanPath}`);
  }

  let skillBody: string;
  try {
    skillBody = await mergedDeps.loadSkillFn(projectRoot, "refine-test-plan");
  } catch {
    throw new Error(
      "Required skill missing: expected .agents/skills/refine-test-plan/SKILL.md.",
    );
  }

  const testPlanContent = await mergedDeps.readFileFn(testPlanPath, "utf8");
  const context: Record<string, string> = {
    current_iteration: state.current_iteration,
    test_plan_file: testPlanFile,
    test_plan_content: testPlanContent,
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

  console.log("Test plan refined.");
}
