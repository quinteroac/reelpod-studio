---
name: execute-test-batch
description: "Executes a batch of approved automated test cases and returns a strict JSON array of result payloads. Invoked by: bun nvst execute test-plan."
user-invocable: false
---

# Execute Test Batch

Execute all provided automated test cases from the approved test plan in a single session.

All generated content must be in English.

## Inputs

Use the provided context sections:
- `project_context`: project conventions, runtime, quality checks, and constraints
- `test_cases`: JSON array of test case objects, each with id, description, mode, and correlated requirements

## Execution Rules

1. Read all test cases in `test_cases` before running any commands.
2. Follow constraints from `project_context` when selecting commands, environment setup, and verification steps.
3. Execute each test case in order. Share session context (e.g. environment setup, installed dependencies) across test cases to avoid redundant work.
4. Capture concise evidence from command outputs or observed results for each test case.
5. Determine outcome per test case:
   - `passed`: acceptance for this test case was satisfied
   - `failed`: acceptance for this test case was not satisfied
   - `skipped`: test case cannot be executed due to a justified blocker

## Output Contract (Mandatory)

Output MUST be raw JSON only. No markdown fences, no introductory text, no trailing instructions. Do not output markdown or additional text outside the JSON array.

Return only a JSON array with one result object per test case, in the same order as the input. Each object must have this exact shape:

```json
[
  {
    "testCaseId": "the test case id",
    "status": "passed|failed|skipped",
    "evidence": "string",
    "notes": "string"
  }
]
```

Every test case in the input must have a corresponding result in the output array.

Correct: output the array directly (or inside a single ```json block if necessary). Incorrect: adding text like "Here are the results:" or "Run this command:" before or after the JSON.
