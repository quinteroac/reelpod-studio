import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { buildPrompt, invokeAgent, loadSkill, type AgentProvider } from "../agent";
import { assertGuardrail } from "../guardrail";
import { exists, readState, FLOW_REL_DIR } from "../state";

export interface RefineRequirementOptions {
  provider: AgentProvider;
  challenge: boolean;
  force?: boolean;
}

export async function runRefineRequirement(opts: RefineRequirementOptions): Promise<void> {
  const { provider, challenge, force = false } = opts;
  const projectRoot = process.cwd();
  const state = await readState(projectRoot);

  const requirementDefinition = state.phases.define.requirement_definition;
  await assertGuardrail(
    state,
    requirementDefinition.status !== "in_progress",
    `Cannot refine requirement from status '${requirementDefinition.status}'. Expected in_progress.`,
    { force },
  );

  const requirementFile = requirementDefinition.file;
  if (!requirementFile) {
    throw new Error("Cannot refine requirement: define.requirement_definition.file is missing.");
  }

  const requirementPath = join(projectRoot, FLOW_REL_DIR, requirementFile);
  if (!(await exists(requirementPath))) {
    throw new Error(`Cannot refine requirement: file not found at ${requirementPath}`);
  }

  const skillBody = await loadSkill(projectRoot, "refine-pr-document");
  const requirementContent = await readFile(requirementPath, "utf8");

  const context: Record<string, string> = {
    current_iteration: state.current_iteration,
    requirement_file: requirementFile,
    requirement_content: requirementContent,
  };

  if (challenge) {
    context.mode = "challenger";
  }

  const prompt = buildPrompt(skillBody, context);
  const result = await invokeAgent({
    provider,
    prompt,
    cwd: projectRoot,
    interactive: true,
  });

  if (result.exitCode !== 0) {
    throw new Error(`Agent invocation failed with exit code ${result.exitCode}.`);
  }

  console.log("Requirement refined.");
}
