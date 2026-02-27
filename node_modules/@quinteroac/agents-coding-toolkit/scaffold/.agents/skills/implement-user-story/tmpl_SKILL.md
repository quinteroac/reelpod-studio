---
name: implement-user-story
description: "Implements a single user story from the PRD: writes code and tests, follows project conventions. Invoked by: bun nvst create prototype."
user-invocable: false
---

# Implement User Story

Implement the provided user story by writing production code and tests that satisfy all acceptance criteria, following the project's conventions and architecture.

---

## The Job

1. Read the **user story** and its **acceptance criteria** carefully.
2. Review the **project context** to understand conventions, tech stack, testing strategy, and module structure.
3. Plan the implementation: identify which files to create or modify, what tests to write, and how the change fits into the existing architecture.
4. Implement the user story:
   - Write production code that satisfies every acceptance criterion.
   - Write tests that verify each acceptance criterion (follow the testing strategy from the project context).
   - Follow all naming conventions, code standards, and forbidden patterns from the project context.
5. Verify your work:
   - Ensure the code compiles / type-checks without errors.
   - Run any quality checks defined in the project context.
   - Fix any issues before finishing.
6. Do **not** commit — the calling command handles git commits.

---

## Inputs

| Source | Used for |
|--------|----------|
| `user_story` (context variable) | The user story JSON with id, title, description, and acceptanceCriteria |
| `project_context` (context variable) | Project conventions, tech stack, code standards, testing strategy, and architecture |
| `iteration` (context variable) | Current iteration number for file naming and context |

---

## Rules

- **One story at a time.** Implement only the user story provided — do not implement other stories or make unrelated changes.
- **Follow conventions exactly.** Use the naming, formatting, error handling, and module organisation patterns from the project context.
- **Test every acceptance criterion.** Each AC should have at least one corresponding test assertion.
- **No new dependencies** unless the acceptance criteria explicitly require them.
- **Do not modify state files.** Do not touch `.agents/state.json` or progress files — the calling command manages those.
- **Do not commit.** The calling command will commit after verifying quality checks pass.
- **Keep changes minimal.** Only modify files necessary to implement the user story. Do not refactor unrelated code.

---

## Output

The output is the set of file changes (new files created, existing files modified) in the working tree. There is no document to produce — the code and tests are the deliverable.

---

## Checklist

Before finishing:

- [ ] All acceptance criteria from the user story are implemented
- [ ] Tests cover each acceptance criterion
- [ ] Code follows project conventions (naming, style, error handling)
- [ ] Code compiles / type-checks without errors
- [ ] No unrelated changes were made
- [ ] No state files were modified
- [ ] No git commits were made
