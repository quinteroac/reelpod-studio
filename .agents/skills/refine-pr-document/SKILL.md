---
name: refine-pr-document
description: "Updates an existing product requirement document based on user feedback. Triggered by: bun nvst refine requirement."
user-invocable: true
---

# Refine Product Requirement Document

Update `it_{current_iteration}_product-requirement-document.md` in place based on user feedback. The file must already exist; this skill does not create it from scratch.

**Do NOT start implementing. Only update the document.**

> **Two modes available — the agent asks at the start:**
> - **Editor mode** — apply specific changes requested by the user.
> - **Challenger mode** — act as an independent critical reviewer: challenge assumptions, question scope, find gaps, and propose improvements. The user accepts or rejects each suggestion before anything is written.

---

## The Job

1. Read `state.json` → get `requirement_definition.file` (e.g. `it_000001_product-requirement-document.md`).
2. Read the current document from `.agents/flow/{file}`.
3. **Open by asking:** _"Would you like me to challenge the existing document as an independent reviewer, or would you prefer to tell me what to change?"_
   - Answer → **challenge**: run Challenger Mode (see below).
   - Answer → **edit**: run Editor Mode (see Questions Flow).
4. Apply changes to the document following the same Output Structure as `create-pr-document`.
5. Re-enforce MVP constraint: remove any user stories not explicitly listed by the user; do not add new ones without confirmation.
6. Write the updated file back to the same path.
7. Do **not** update `state.json` — `requirement_definition.status` stays `"in_progress"`.

---

## Challenger Mode

Act as a second agent reviewing the document with fresh eyes. Do not apply any change without explicit user approval.

**Challenge areas — examine each (in order):**

1. **Assumptions** — List implicit assumptions in the goals or stories. Ask: are these validated? what if they are wrong?
2. **Scope creep** — Flag any user story that is not strictly MVP-necessary. Propose removal and ask for confirmation.
3. **Vague acceptance criteria** — Highlight criteria that are not concretely verifiable. Suggest a specific rewrite.
4. **Missing non-goals** — Identify things the document is silent on that could be misread as in-scope. Propose additions to Non-Goals.
5. **Missing edge cases** — Point out failure paths or user states not covered by any acceptance criterion.
6. **Conflicting requirements** — Flag any `FR-N` that contradicts another or contradicts an acceptance criterion.

**Challenger output format — one observation at a time:**

> CRITICAL: Present findings **one at a time**. After delivering one finding, stop and wait for the user to respond before moving on. Do not queue or batch findings.

For each finding, format it as:

```
Challenge [N/total]: <area name>

Finding: <what the issue is>
Suggestion: <proposed change>

Accept / Reject / Discuss?
```

- After the user responds, acknowledge their decision and immediately present the **next** finding.
- If the user types **Discuss**, engage in a short back-and-forth until they give a final Accept or Reject, then move on.
- Once all findings have been reviewed, summarise the accepted changes and apply them to the file in a single write.
- Do **not** write anything to the file until all findings have received a response.

---

## Editor Mode (Questions Flow)

Ask only what is needed to understand the requested change.

```
1. What would you like to change or add?
   A. Replace or rewrite a user story
   B. Add a new user story (must be MVP-justified)
   C. Remove a user story
   D. Tighten acceptance criteria
   E. Update goals or non-goals
   F. Other: [describe]

2. If adding a user story — is it strictly necessary for the MVP?
   [Open answer — skip if not adding stories]

3. Anything else to update in this pass?
   [Open answer — skip if none]
```

---

## Refinement Rules

- **MVP constraint holds:** do not add user stories unless the user explicitly requests them and confirms they are MVP-necessary.
- **Preserve numbering:** renumber `US-NNN` and `FR-N` entries only if a story is removed; otherwise keep existing IDs stable.
- **Verifiable criteria:** any new or edited acceptance criterion must be concrete and testable (same standard as `create-pr-document`).
- **UI stories:** if a new or edited story touches the UI, "visually verified in browser" must be an acceptance criterion.

---

## Checklist

Before saving:

- [ ] User's requested changes applied
- [ ] No new user stories added without explicit MVP justification
- [ ] All acceptance criteria remain verifiable
- [ ] `US-NNN` and `FR-N` numbering is consistent
- [ ] File written back to `.agents/flow/it_{current_iteration}_product-requirement-document.md`
- [ ] `state.json` **not** modified (status stays `"in_progress"`)
