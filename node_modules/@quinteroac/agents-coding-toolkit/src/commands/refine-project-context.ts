import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { buildPrompt, invokeAgent, loadSkill, type AgentProvider } from "../agent";
import { assertGuardrail } from "../guardrail";
import { exists, readState, writeState } from "../state";

export interface RefineProjectContextOptions {
    provider: AgentProvider;
    challenge: boolean;
    force?: boolean;
}

export async function runRefineProjectContext(opts: RefineProjectContextOptions): Promise<void> {
    const { provider, challenge, force = false } = opts;
    const projectRoot = process.cwd();
    const state = await readState(projectRoot);

    // US-003-AC01: Validate status is pending_approval or created
    const projectContext = state.phases.prototype.project_context;
    await assertGuardrail(
        state,
        projectContext.status !== "pending_approval" && projectContext.status !== "created",
        `Cannot refine project context from status '${projectContext.status}'. Expected pending_approval or created.`,
        { force },
    );

    // Validate file reference exists in state
    const contextFile = projectContext.file;
    if (!contextFile) {
        throw new Error("Cannot refine project context: project_context.file is missing.");
    }

    const contextPath = join(projectRoot, contextFile);
    if (!(await exists(contextPath))) {
        throw new Error(`Cannot refine project context: file not found at ${contextPath}`);
    }

    // US-003-AC03: Challenge mode uses a dedicated skill section
    const skillName = challenge ? "refine-project-context" : "refine-project-context";
    const skillBody = await loadSkill(projectRoot, skillName);
    const contextContent = await readFile(contextPath, "utf8");

    const context: Record<string, string> = {
        current_iteration: state.current_iteration,
        project_context_file: contextFile,
        project_context_content: contextContent,
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

    // US-003-AC04: After refinement, set status back to pending_approval
    projectContext.status = "pending_approval";
    state.last_updated = new Date().toISOString();
    state.updated_by = challenge
        ? "nvst:refine-project-context:challenge"
        : "nvst:refine-project-context";

    await writeState(projectRoot, state);

    console.log("Project context refined and marked as pending approval.");
}
