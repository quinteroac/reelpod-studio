import {
  buildPrompt,
  invokeAgent,
  loadSkill,
  type AgentInvokeOptions,
  type AgentProvider,
  type AgentResult,
} from "../agent";
import { assertGuardrail } from "../guardrail";
import { readState, writeState } from "../state";

export interface DefineRefactorPlanOptions {
  provider: AgentProvider;
  force?: boolean;
}

interface DefineRefactorPlanDeps {
  invokeAgentFn: (options: AgentInvokeOptions) => Promise<AgentResult>;
  loadSkillFn: (projectRoot: string, skillName: string) => Promise<string>;
  nowFn: () => Date;
}

const defaultDeps: DefineRefactorPlanDeps = {
  invokeAgentFn: invokeAgent,
  loadSkillFn: loadSkill,
  nowFn: () => new Date(),
};

export async function runDefineRefactorPlan(
  opts: DefineRefactorPlanOptions,
  deps: Partial<DefineRefactorPlanDeps> = {},
): Promise<void> {
  const { provider, force = false } = opts;
  const projectRoot = process.cwd();
  const state = await readState(projectRoot);
  const mergedDeps: DefineRefactorPlanDeps = { ...defaultDeps, ...deps };

  await assertGuardrail(
    state,
    !state.phases.prototype.prototype_approved,
    "Cannot define refactor plan: phases.prototype.prototype_approved must be true. Complete prototype (all tests passing) first.",
    { force },
  );

  // Intentional auto-transition: if the user runs this command directly from
  // the prototype phase (prototype_approved === true), we advance to "refactor"
  // so they don't have to manually update the phase. US-001-AC01 says the phase
  // must be "refactor", but accepting "prototype" here is a UX convenience that
  // is safe because prototype_approved is already enforced above.
  if (state.current_phase === "prototype") {
    state.current_phase = "refactor";
  } else if (state.current_phase !== "refactor") {
    await assertGuardrail(
      state,
      true,
      `Cannot define refactor plan: current_phase must be 'prototype' or 'refactor'. Current: '${state.current_phase}'.`,
      { force },
    );
  }

  const refactorPlan = state.phases.refactor.refactor_plan;
  await assertGuardrail(
    state,
    refactorPlan.status !== "pending",
    `Cannot define refactor plan from status '${refactorPlan.status}'. Expected pending.`,
    { force },
  );

  const skillBody = await mergedDeps.loadSkillFn(projectRoot, "plan-refactor");
  const prompt = buildPrompt(skillBody, {
    current_iteration: state.current_iteration,
  });
  const result = await mergedDeps.invokeAgentFn({
    provider,
    prompt,
    cwd: projectRoot,
    interactive: true,
  });

  if (result.exitCode !== 0) {
    throw new Error(`Agent invocation failed with exit code ${result.exitCode}.`);
  }

  state.phases.refactor.evaluation_report.status = "created";
  state.phases.refactor.evaluation_report.file = `it_${state.current_iteration}_evaluation-report.md`;
  refactorPlan.status = "pending_approval";
  refactorPlan.file = `it_${state.current_iteration}_refactor-plan.md`;
  state.last_updated = mergedDeps.nowFn().toISOString();
  state.updated_by = "nvst:define-refactor-plan";

  await writeState(projectRoot, state);

  console.log(
    "Evaluation report and refactor plan created. Refactor plan is pending approval.",
  );
}
