---
name: automated-fix
description: "Fixes one issue from the iteration issues list by reproducing, diagnosing, and resolving it. Invoked by: bun nvst fix issue."
user-invocable: false
---

# Automated Fix

Attempt to resolve the provided issue safely and deterministically by following a structured debugging workflow.

---

## Inputs

| Source | Used for |
|--------|----------|
| `issue` (context variable) | The issue to fix, including id, title, description, and reproduction steps |
| `project_context` (context variable) | Project conventions, tech stack, code standards, testing strategy, and architecture |
| `iteration` (context variable) | Current iteration number for file naming and context |

---

## The Job

Follow this debugging workflow in order:

1. Understand the issue — read the description and any reproduction steps carefully.
2. Reproduce the issue — confirm it is observable before making any changes.
3. Form hypotheses — identify possible root causes based on the observed behaviour.
4. Identify affected code — locate the files and functions involved.
5. Add instrumentation if needed — add temporary logging or assertions to narrow down the cause.
6. Collect logs — run the code and capture output if instrumentation was added.
7. Confirm or discard hypotheses — use evidence to settle on the root cause.
8. Fix the issue — apply the minimal change that resolves the root cause.
9. Verify the fix — attempt to reproduce the original issue and confirm it no longer occurs.
10. Remove instrumentation — clean up any temporary logging or assertions added in step 5.

---

## Rules

- **Minimal scope.** Keep changes scoped to the provided issue — do not refactor unrelated code.
- **Add or update tests.** Write or update tests to cover the fix when appropriate.
- **Do not commit.** The calling command handles git commits.
- **Stop on uncertainty.** If no hypothesis can be confirmed after reasonable effort, stop and report failure rather than guessing.
- **Follow conventions exactly.** Use the naming, formatting, error handling, and module organisation patterns from the project context.

---

## Output

The output is the set of file changes (modified or new files) in the working tree. There is no document to produce — the corrected code and any updated tests are the deliverable.

---

## Checklist

Before finishing:

- [ ] Issue was reproduced before any changes were made
- [ ] Root cause was identified and confirmed
- [ ] Fix is minimal and scoped to the provided issue
- [ ] Issue can no longer be reproduced after the fix
- [ ] Instrumentation has been removed
- [ ] Tests were added or updated where appropriate
- [ ] Code follows project conventions (naming, style, error handling)
- [ ] No git commits were made
