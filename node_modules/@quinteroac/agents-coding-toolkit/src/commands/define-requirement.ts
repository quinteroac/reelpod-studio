import { buildPrompt, invokeAgent, loadSkill, type AgentProvider } from "../agent";
import { assertGuardrail } from "../guardrail";
import { readState, writeState } from "../state";

export interface DefineRequirementOptions {
  provider: AgentProvider;
  force?: boolean;
}

export async function runDefineRequirement(opts: DefineRequirementOptions): Promise<void> {
  const { provider, force = false } = opts;
  const projectRoot = process.cwd();
  const state = await readState(projectRoot);

  await assertGuardrail(
    state,
    state.current_phase !== "define",
    "Cannot define requirement: current_phase must be 'define'.",
    { force },
  );

  const requirementDefinition = state.phases.define.requirement_definition;
  await assertGuardrail(
    state,
    requirementDefinition.status !== "pending",
    `Cannot define requirement from status '${requirementDefinition.status}'. Expected pending.`,
    { force },
  );

  const skillBody = await loadSkill(projectRoot, "create-pr-document");
  const prompt = buildPrompt(skillBody, {
    current_iteration: state.current_iteration,
  });
  const result = await invokeAgent({
    provider,
    prompt,
    cwd: projectRoot,
    interactive: true,
  });

  if (result.exitCode !== 0) {
    throw new Error(`Agent invocation failed with exit code ${result.exitCode}.`);
  }

  requirementDefinition.status = "in_progress";
  requirementDefinition.file = `it_${state.current_iteration}_product-requirement-document.md`;
  state.last_updated = new Date().toISOString();
  state.updated_by = "nvst:define-requirement";

  await writeState(projectRoot, state);

  console.log("Requirement definition started and marked as in progress.");
}
