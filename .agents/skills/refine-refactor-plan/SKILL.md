---
name: refine-refactor-plan
description: "Refines an existing refactor plan based on user feedback or adversarial challenge mode. Triggered by: bun nvst refine refactor-plan."
user-invocable: true
---

# Refine Refactor Plan

Update `it_{current_iteration}_refactor-plan.md` in place. The file already exists and is provided in context.

**Do NOT implement code. Only revise the refactor plan document.**

> **Two modes available — determined by the `mode` context variable:**
> - **Editor mode** (default): apply user-requested updates to the plan.
> - **Challenger mode** (`mode = "challenger"`): challenge sequencing, risk handling, and testability before applying edits.

## Inputs

| Source | Used for |
|--------|----------|
| `refactor_plan_file` | Current plan file name |
| `refactor_plan_content` | Existing plan content |
| User responses | Clarifications and approval of proposed edits |

## Checklist

- [ ] Output remains in English
- [ ] Accepted changes are applied to the existing refactor plan file
- [ ] Same output file path is preserved (refine in place, do not write a new file)
- [ ] State files are not modified by this skill
