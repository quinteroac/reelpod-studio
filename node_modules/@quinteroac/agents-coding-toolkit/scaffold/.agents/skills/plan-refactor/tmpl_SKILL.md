---
name: plan-refactor
description: "Evaluates the prototype and produces an ordered refactor plan. Triggered by: bun nvst define refactor-plan."
user-invocable: true
---

# Evaluate and Plan Refactor

This skill runs in two parts within a single session. **Do NOT implement code.** Only produce documents.

## Part 1: Evaluate the Prototype

Evaluate the current prototype before planning refactorings.

### Evaluation Inputs

| Source | Used for |
|--------|----------|
| `.agents/PROJECT_CONTEXT.md` | Documented conventions, architecture, and standards to validate against |
| `.agents/TECHNICAL_DEBT.md` | Existing technical debt (if present) |
| `.agents/flow/it_{current_iteration}_PRD.json` | Implemented scope for this iteration |
| Prototype codebase | Actual structure, patterns, and quality |

### Evaluation Output

Write `it_{current_iteration}_evaluation-report.md` to `.agents/flow/` with this structure:

```markdown
# Evaluation Report — Iteration {current_iteration}

## Strengths
- What works well in the current prototype

## Technical Debt
- Known debt items, with brief impact/effort notes

## Violations of PROJECT_CONTEXT.md
- Conventions, architecture, or standards not followed

## Recommendations
Each item: description, impact, urgency, effort, scope. Optional numeric score for ordering.
```

Complete Part 1 before starting Part 2. The evaluation report is the input for the refactor plan.

---

## Part 2: Define the Refactor Plan

From the evaluation report you just produced, define an ordered refactor plan.

### Plan Inputs

| Source | Used for |
|--------|----------|
| `it_{current_iteration}_evaluation-report.md` | Issues, technical debt, and recommendations to prioritise |
| User (interactive) | Decisions on trade-offs or approaches that need clarification |

### Plan Output

Write `it_{current_iteration}_refactor-plan.md` to `.agents/flow/` with this structure:

```markdown
# Refactor Plan — Iteration {current_iteration}

## Refactor Items

### RI-001: <Title>

**Description:** One or two sentences describing what needs to change and why it is a problem.

**Rationale:** Why this item is prioritised at this position — impact, urgency, or risk reduction.

### RI-002: <Title>

**Description:** ...

**Rationale:** ...
```

### Plan Instructions

1. Read the evaluation report in full before writing the refactor plan.
2. Identify quick wins (low effort, high impact) and critical refactorings (high urgency or high risk).
3. For items that require a user decision (e.g. trade-offs between approaches), ask the user before committing to an entry.
4. Order items by priority: critical blockers first, quick wins second, long-term improvements last.
5. Assign each item a unique id in `RI-NNN` format (e.g. `RI-001`, `RI-002`).
6. Write the refactor plan file.

---

## Checklist

- [ ] Output is in English
- [ ] Part 1: `it_{current_iteration}_evaluation-report.md` written to `.agents/flow/`
- [ ] Part 2: `it_{current_iteration}_refactor-plan.md` written to `.agents/flow/`
- [ ] Each refactor item has a unique `RI-NNN` id, `**Description:**`, and `**Rationale:**`
- [ ] Refactor items are ordered by priority
- [ ] State files are not modified by this skill
