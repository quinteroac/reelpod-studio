import { join } from "node:path";

import { assertGuardrail } from "../guardrail";
import { exists, readState, writeState } from "../state";

export interface ApproveProjectContextOptions {
    force?: boolean;
}

export async function runApproveProjectContext(opts: ApproveProjectContextOptions = {}): Promise<void> {
    const { force = false } = opts;
    const projectRoot = process.cwd();
    const state = await readState(projectRoot);

    // US-002-AC01: Validate status is pending_approval
    const projectContext = state.phases.prototype.project_context;
    await assertGuardrail(
        state,
        projectContext.status !== "pending_approval",
        `Cannot approve project context from status '${projectContext.status}'. Expected pending_approval.`,
        { force },
    );

    // US-002-AC01: Validate project context file exists
    const contextFile = projectContext.file;
    if (!contextFile) {
        throw new Error("Cannot approve project context: project_context.file is missing.");
    }

    const contextPath = join(projectRoot, contextFile);
    if (!(await exists(contextPath))) {
        throw new Error(`Cannot approve project context: file not found at ${contextPath}`);
    }

    // US-002-AC02: Transition status to created
    projectContext.status = "created";
    state.last_updated = new Date().toISOString();
    state.updated_by = "nvst:approve-project-context";

    await writeState(projectRoot, state);

    // US-002-AC03: Clear feedback
    console.log("Project context approved.");
}
