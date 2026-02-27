---
name: execute-refactor-item
description: "Applies a single approved refactor item (RI-NNN) to the codebase. Invoked by: bun nvst execute refactor."
user-invocable: false
---

# Execute Refactor Item

Apply the provided refactor item to the codebase, following the project's conventions and architecture.

---

## The Job

1. Read the **refactor item** (`id`, `title`, `description`, `rationale`) carefully.
2. Review the **project context** to understand conventions, tech stack, and module structure.
3. Plan the change: identify which files to create or modify and how the change fits into the existing architecture.
4. Apply the refactor:
   - Make the changes described in the item's `description`.
   - Ensure the code compiles / type-checks without errors after the change.
   - Run any quality checks defined in the project context and fix failures before finishing.
5. Do **not** commit — the calling command manages git operations.

---

## Inputs

| Source | Used for |
|--------|----------|
| `current_iteration` (context variable) | Current iteration number for context |
| `item_id` (context variable) | The refactor item identifier (e.g. `RI-001`) |
| `item_title` (context variable) | Short title of the refactor item |
| `item_description` (context variable) | Detailed description of the change to apply |
| `item_rationale` (context variable) | Why this refactor is needed |
| `.agents/PROJECT_CONTEXT.md` | Documented conventions, architecture, and standards to follow |

---

## Rules

- **One item at a time.** Apply only the refactor item provided — do not make unrelated changes.
- **Follow conventions exactly.** Use the naming, formatting, error handling, and module organisation patterns from the project context.
- **No new dependencies** unless the refactor item explicitly requires them.
- **Do not modify state files.** Do not touch `.agents/state.json` or progress files — the calling command manages those.
- **Do not commit.** The calling command handles git operations.
- **Keep changes minimal.** Only modify files necessary to apply the refactor item.

---

## Checklist

Before finishing:

- [ ] Refactor item changes are applied as described
- [ ] Code compiles / type-checks without errors
- [ ] Quality checks pass
- [ ] No unrelated changes were made
- [ ] No state files were modified
- [ ] No git commits were made
