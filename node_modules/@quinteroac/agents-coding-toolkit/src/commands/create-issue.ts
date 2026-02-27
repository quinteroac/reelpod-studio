import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import {
  buildPrompt,
  invokeAgent,
  loadSkill,
  type AgentProvider,
} from "../agent";
import { CLI_PATH } from "../cli-path";
import { readState, exists, FLOW_REL_DIR } from "../state";
import { IssuesSchema, type Issue } from "../../scaffold/schemas/tmpl_issues";

// ---------------------------------------------------------------------------
// Agent output schema — agent produces title+description only
// ---------------------------------------------------------------------------

const AgentIssueSchema = z.object({
  title: z.string(),
  description: z.string(),
});

const AgentOutputSchema = z.array(AgentIssueSchema);

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CreateIssueOptions {
  provider: AgentProvider;
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export async function runCreateIssue(opts: CreateIssueOptions): Promise<void> {
  const { provider } = opts;
  const projectRoot = process.cwd();
  const state = await readState(projectRoot);

  const iteration = state.current_iteration;

  // Load skill and build prompt
  const skillBody = await loadSkill(projectRoot, "create-issue");
  const prompt = buildPrompt(skillBody, {
    current_iteration: iteration,
  });

  // Invoke agent interactively
  const result = await invokeAgent({
    provider,
    prompt,
    cwd: projectRoot,
    interactive: true,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Agent invocation failed with exit code ${result.exitCode}.`,
    );
  }

  // Agent writes the file via write-json (see create-issue skill). Check if file exists first.
  const outputFileName = `it_${iteration}_ISSUES.json`;
  const outputRelPath = join(FLOW_REL_DIR, outputFileName);
  const outputAbsPath = join(projectRoot, outputRelPath);

  if (await exists(outputAbsPath)) {
    // Agent ran write-json; validate the file
    const content = await readFile(outputAbsPath, "utf8");
    const parsed = JSON.parse(content) as unknown;
    const validationResult = IssuesSchema.safeParse(parsed);
    if (!validationResult.success) {
      const formatted = validationResult.error.format();
      throw new Error(
        `Agent wrote invalid issues file:\n${JSON.stringify(formatted, null, 2)}`,
      );
    }
    console.log(`Issues file created: ${outputRelPath}`);
    return;
  }

  // Fallback: parse stdout and call write-json (for agents that output JSON instead of running write-json)
  const agentOutput = result.stdout.trim();
  if (!agentOutput) {
    throw new Error(
      "Agent did not produce output. Expected the agent to run write-json to create the issues file, or output a JSON array to stdout.",
    );
  }

  const jsonStr = extractJson(agentOutput);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    const looksLikeConversation =
      /describe|issue|please|what|how|tell me|help you/i.test(agentOutput) &&
      !agentOutput.trimStart().startsWith("[");
    if (looksLikeConversation) {
      throw new Error(
        "The agent started the interactive session but exited before completing. " +
          "The output was a question, not the final issues. This can happen if the agent " +
          "encountered an error (e.g. IDE companion connection failed) or exited unexpectedly. " +
          "Try running again or use a different provider (claude, codex, cursor). " +
          "The agent must run write-json when done; see .agents/skills/create-issue/SKILL.md.",
      );
    }
    throw new Error(
      `Failed to parse agent output as JSON. Raw output:\n${agentOutput}`,
    );
  }

  const agentResult = AgentOutputSchema.safeParse(parsed);
  if (!agentResult.success) {
    const formatted = agentResult.error.format();
    throw new Error(
      `Agent output does not match expected format:\n${JSON.stringify(formatted, null, 2)}`,
    );
  }

  const issues: Issue[] = agentResult.data.map((item, index) => ({
    id: `ISSUE-${iteration}-${String(index + 1).padStart(3, "0")}`,
    title: item.title,
    description: item.description,
    status: "open" as const,
  }));

  const validationResult = IssuesSchema.safeParse(issues);
  if (!validationResult.success) {
    const formatted = validationResult.error.format();
    throw new Error(
      `Generated issues failed schema validation:\n${JSON.stringify(formatted, null, 2)}`,
    );
  }

  const dataStr = JSON.stringify(validationResult.data);
  const proc = Bun.spawn(
    [
      "bun",
      CLI_PATH,
      "write-json",
      "--schema",
      "issues",
      "--out",
      outputRelPath,
      "--data",
      dataStr,
    ],
    { cwd: projectRoot, stdout: "pipe", stderr: "pipe" },
  );

  const writeExitCode = await proc.exited;
  if (writeExitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Failed to write issues file: ${stderr}`);
  }

  console.log(`Issues file created: ${outputRelPath}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Test-execution-report → issues (US-002)
// ---------------------------------------------------------------------------

const TestResultPayloadSchema = z.object({
  status: z.string(),
  evidence: z.string().optional(),
  notes: z.string().optional(),
});

const TestResultSchema = z.object({
  testCaseId: z.string(),
  description: z.string(),
  correlatedRequirements: z.array(z.string()).optional(),
  payload: TestResultPayloadSchema,
});

const TestExecutionResultsSchema = z.object({
  iteration: z.string(),
  results: z.array(TestResultSchema),
});

export type TestExecutionResults = z.infer<typeof TestExecutionResultsSchema>;

const ACTIONABLE_STATUSES = ["failed", "skipped", "invocation_failed"] as const;

export function isActionableStatus(status: string): boolean {
  return (ACTIONABLE_STATUSES as readonly string[]).includes(status);
}

export function buildIssuesFromTestResults(
  results: TestExecutionResults,
  iteration: string,
): Issue[] {
  const actionable = results.results.filter((r) =>
    isActionableStatus(r.payload.status),
  );

  return actionable.map((r, index) => ({
    id: `ISSUE-${iteration}-${String(index + 1).padStart(3, "0")}`,
    title: `[${r.payload.status}] ${r.testCaseId}: ${r.description}`,
    description: [
      `Test case ${r.testCaseId} resulted in status: ${r.payload.status}.`,
      r.payload.notes ? `Notes: ${r.payload.notes}` : "",
      r.payload.evidence ? `Evidence: ${r.payload.evidence}` : "",
      r.correlatedRequirements?.length
        ? `Correlated requirements: ${r.correlatedRequirements.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    status: "open" as const,
  }));
}

export async function runCreateIssueFromTestReport(): Promise<void> {
  const projectRoot = process.cwd();
  const state = await readState(projectRoot);
  const iteration = state.current_iteration;

  // AC01: Try reading from .agents/flow/ first, then archived path
  const fileName = `it_${iteration}_test-execution-results.json`;
  const flowPath = join(projectRoot, FLOW_REL_DIR, fileName);

  let resultsPath: string | null = null;

  if (await exists(flowPath)) {
    resultsPath = flowPath;
  } else {
    // Check archived path from state.json history for current iteration
    const historyEntry = state.history?.find(
      (h) => h.iteration === iteration,
    );
    if (historyEntry) {
      const archivedPath = join(
        projectRoot,
        historyEntry.archived_path,
        fileName,
      );
      if (await exists(archivedPath)) {
        resultsPath = archivedPath;
      }
    }
  }

  // AC05: Fail with clear error if not found in either location
  if (!resultsPath) {
    throw new Error(
      `Test execution results file not found: looked for ${fileName} in ${FLOW_REL_DIR}/ and archived path for iteration ${iteration}.`,
    );
  }

  // Read and validate the test execution results
  const raw = await readFile(resultsPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Failed to parse test execution results as JSON: ${resultsPath}`,
    );
  }

  const validationResult = TestExecutionResultsSchema.safeParse(parsed);
  if (!validationResult.success) {
    const formatted = validationResult.error.format();
    throw new Error(
      `Test execution results failed schema validation:\n${JSON.stringify(formatted, null, 2)}`,
    );
  }

  // AC02: Convert actionable test results into issues
  const issues = buildIssuesFromTestResults(validationResult.data, iteration);

  // AC04: If all tests are passing, write empty array and exit with code 0
  // (buildIssuesFromTestResults returns [] when no actionable results)

  // AC06: Validate against ISSUES schema
  const issuesValidation = IssuesSchema.safeParse(issues);
  if (!issuesValidation.success) {
    const formatted = issuesValidation.error.format();
    throw new Error(
      `Generated issues failed ISSUES schema validation:\n${JSON.stringify(formatted, null, 2)}`,
    );
  }

  // AC03: Write output file via write-json
  const outputFileName = `it_${iteration}_ISSUES.json`;
  const outputRelPath = join(FLOW_REL_DIR, outputFileName);
  const dataStr = JSON.stringify(issuesValidation.data);

  const proc = Bun.spawn(
    [
      "bun",
      CLI_PATH,
      "write-json",
      "--schema",
      "issues",
      "--out",
      outputRelPath,
      "--data",
      dataStr,
    ],
    { cwd: projectRoot, stdout: "pipe", stderr: "pipe" },
  );

  const writeExitCode = await proc.exited;
  if (writeExitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Failed to write issues file: ${stderr}`);
  }

  if (issues.length === 0) {
    console.log(
      `All tests passing. Empty issues file created: ${outputRelPath}`,
    );
  } else {
    console.log(
      `${issues.length} issue(s) created from test execution results: ${outputRelPath}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract JSON array from text that may contain markdown fences or surrounding text. */
export function extractJson(text: string): string {
  // 1. Prefer ```json block when multiple fences exist (REQ-FIX-01, REQ-FIX-02).
  //    Use lazy *? to stop at the FIRST closing ```, avoiding capture of later blocks (e.g. ```bash).
  const jsonFenceMatch = text.match(/```json\s*\n([\s\S]*?)\n```\s*/);
  if (jsonFenceMatch) {
    return jsonFenceMatch[1].trim();
  }

  // 2. Try single-block case: ``` or ```json at line start, content until closing ``` at line end
  const fenceMatch = text.match(/^```(?:json)?\s*\n([\s\S]*)\n```\s*$/m);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // 3. Fallback: plain ``` fence (no json label) - find first ``` and match to its closing fence
  //    Only use when there is a single block (first and last ``` span the same block)
  const openIdx = text.indexOf("```");
  if (openIdx !== -1) {
    const afterOpen = text.indexOf("\n", openIdx);
    if (afterOpen !== -1) {
      const rest = text.slice(afterOpen + 1);
      const closeMatch = rest.match(/\n```\s*/);
      if (closeMatch) {
        return rest.slice(0, closeMatch.index).trim();
      }
    }
  }

  // 4. Try to find a JSON array directly (REQ-FIX-03)
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    return arrayMatch[0];
  }

  // Return as-is and let JSON.parse handle it
  return text;
}
