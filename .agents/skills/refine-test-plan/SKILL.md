---
name: refine-test-plan
description: "Refines an existing test plan based on user feedback or adversarial challenge mode. Triggered by: bun nvst refine test-plan."
user-invocable: true
---

# Refine Test Plan

Update `it_{current_iteration}_test-plan.md` in place. The file already exists and is provided in context.

**Do NOT implement code. Only revise the test plan document.**

> **Two modes available — determined by the `mode` context variable:**
> - **Editor mode** (default): apply user-requested updates to the plan.
> - **Challenger mode** (`mode = "challenger"`): run an adversarial review of the plan and challenge weak coverage, assertions, and missing cases before applying any edits.

---

## Inputs

| Source | Used for |
|--------|----------|
| `test_plan_file` | Current plan file name |
| `test_plan_content` | Existing test plan content |
| User responses | Clarifications and approval of proposed edits |

---

## Editor Mode

Ask only what is needed, then update the document directly.

Focus on:
- Preserve the existing section structure, headings, and overall organization unless the user explicitly requests structural changes
- Test scope completeness
- Acceptance criteria traceability
- Execution order and environment assumptions
- Clarity and actionability of assertions

---

## Challenger Mode

Act as an independent reviewer trying to break the plan.

Evaluate at minimum:
1. Coverage gaps for each acceptance criterion
2. Missing negative/error-path scenarios
3. Weak or non-verifiable assertions
4. Ambiguous setup/fixtures/test data
5. Over-reliance on manual testing where automation should be used
6. Missing quality checks (typecheck, lint, CI gates) where applicable

Present findings one at a time:

```text
Challenge [N/total]: <area>

Finding: <specific weakness>
Risk: <why this can fail in practice>
Suggestion: <concrete improvement>

Accept / Reject / Discuss?
```

Only apply accepted suggestions to the document after all findings are triaged.

---

## Checklist

- [ ] Output remains in English
- [ ] Accepted changes applied to the existing test plan file
- [ ] Each acceptance criterion has explicit test intent
- [ ] Same output file path is preserved (refine in place, do not write to a new file)
- [ ] State files are not modified by this skill
