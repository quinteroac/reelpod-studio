---
name: ideate
description: "Leads a structured ideation interview to surface feature/project ideas and update ROADMAP.md with new candidates."
user-invocable: true
---

# Ideate

Lead a focused ideation session with the developer. Read context, conduct a one-question-at-a-time interview, propose concrete ideas, and update `ROADMAP.md` with new candidates.

---

## The Job

1. Read `ROADMAP.md` and `PROJECT_CONTEXT.md` from the project root (if they exist) before starting the interview. Use them to understand existing direction, tech stack, and audience.
2. Conduct the interview — one question at a time, waiting for the developer's answer before asking the next.
3. Propose 2–4 concrete ideas based on the answers.
4. Write or update `ROADMAP.md` with the proposed items.
5. Optionally flag if `PROJECT_CONTEXT.md` needs updating.

---

## Step 1 — Load Context

Before asking any question:
- Read `ROADMAP.md` (if present). Note existing items so you do not propose duplicates.
- Read `PROJECT_CONTEXT.md` (if present). Note the tech stack, audience, and constraints.

---

## Step 2 — Interview (one question at a time)

Ask the following questions in order. Wait for the developer's answer before proceeding to the next question. Do not present multiple questions at once.

```
Q1. What problem or opportunity do you want to explore in this ideation session?
    (e.g. a pain point you or your users experience, a capability gap, or a market opportunity)

Q2. Who is the primary user or beneficiary of this idea?
    A. Yourself (developer tooling / DX)
    B. End users of the product
    C. A specific team or role: [specify]
    D. Other: [specify]

Q3. What is the rough scope you have in mind?
    A. Small addition to an existing feature
    B. New standalone feature
    C. New module or integration
    D. Significant product pivot or new product line

Q4. Are there any hard constraints for this idea?
    (e.g. must stay in existing tech stack, must ship in current iteration, no new dependencies)
    [Open answer — or "none"]

Q5. Do you have any early hypotheses, inspirations, or reference examples you want to share?
    [Open answer — or "none"]
```

---

## Step 3 — Propose 2–4 Ideas

Based on the developer's answers, propose between 2 and 4 concrete, actionable ideas. For each idea, provide:

- **Title**: short name for the idea
- **Description**: one or two sentences explaining what it is and what problem it solves
- **Rationale**: why this idea fits the project and the developer's answers
- **Effort estimate**: `S` (< 1 iteration), `M` (1 iteration), or `L` (2+ iterations)
- **Differentiation**: what makes this idea distinct or better than the status quo / alternatives

Format each proposal as a numbered section, for example:

```
### 1. [Title]
**Description:** …
**Rationale:** …
**Effort:** M
**Differentiation:** …
```

Ask the developer to confirm which idea(s) they want to carry forward before proceeding.

---

## Step 4 — Update `ROADMAP.md`

After the developer selects one or more ideas:

1. Open `ROADMAP.md` (create it if it does not exist).
2. Add a new section `## Candidates` (or append to it if it already exists).
3. Write each selected idea as a checklist item tagged `[candidate]`:

```markdown
## Candidates

- [ ] [candidate] **[Title]** — [one-line description]. Effort: S/M/L.
```

4. Do not remove or modify any existing items in `ROADMAP.md`.
5. Save the file.

---

## Step 5 — Optional: Flag `PROJECT_CONTEXT.md` Updates

After writing `ROADMAP.md`, check whether the ideation session revealed information that would make `PROJECT_CONTEXT.md` stale or incomplete. Flag if any of the following changed:

- Tech stack (new language, framework, or library being considered)
- Target audience (different user type or use case)
- Key constraints (new hard limits or relaxed ones)

If any of these changed, tell the developer:

> "The ideation session revealed [what changed]. You may want to run `nvst create project-context` to update `PROJECT_CONTEXT.md`."

If nothing changed, no action is needed.

---

## Checklist

Before finishing:

- [ ] `ROADMAP.md` and `PROJECT_CONTEXT.md` were read (or noted as absent) before the interview
- [ ] All 5 interview questions were asked one at a time
- [ ] 2–4 concrete ideas proposed with title, description, rationale, effort (S/M/L), and differentiation
- [ ] Developer confirmed which idea(s) to carry forward
- [ ] `ROADMAP.md` updated with selected ideas marked `[candidate]`
- [ ] Checked whether `PROJECT_CONTEXT.md` needs updating and flagged if so
