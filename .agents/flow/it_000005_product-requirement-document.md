# Requirement: Wire LLM Skill into OpenAI Backend Call

## Context

Iteration 4 created `backend/llm-skills/strudel-pattern-generator/SKILL.md` — a rich prompt guide covering valid Strudel mini-notation syntax, parameter-to-pattern mappings, and output format rules. It also created `examples/valid-patterns.md` with three verified example patterns (one per style). However, `backend/main.py`'s `build_messages()` still uses a generic 2-line system prompt and sends no few-shot examples. This iteration wires the skill into the actual OpenAI call so the LLM is fully guided, producing more reliable and less malformed patterns.

## Goals

- Replace the hardcoded system prompt in `build_messages()` with the markdown body of `SKILL.md`, read from disk at runtime.
- Inject the three verified example patterns from `valid-patterns.md` as few-shot user/assistant message pairs.
- Ensure the wiring is covered by unit tests (frontmatter stripping, example extraction, full message structure).

## User Stories

### US-001: Load SKILL.md from disk and use as system prompt

**As the** `/api/generate` endpoint, **I want** to read `backend/llm-skills/strudel-pattern-generator/SKILL.md` from disk and strip its YAML frontmatter, **so that** the markdown body becomes the system prompt sent to the OpenAI API instead of the current 2-line hardcoded string.

**Acceptance Criteria:**
- [ ] A pure function `load_skill_body(path: Path) -> str` exists in `backend/main.py` (or a new `backend/llm_skill.py` module)
- [ ] `load_skill_body` reads the file at the given path and returns everything after the closing `---` of the YAML frontmatter block
- [ ] If the file has no frontmatter (no `---` delimiters), the full file content is returned as-is
- [ ] `build_messages()` uses the return value of `load_skill_body` as the `system` message content
- [ ] The path to `SKILL.md` is resolved relative to `main.py`'s directory (no hardcoded absolute paths)
- [ ] No new Python packages are added to install
- [ ] Typecheck / lint passes

### US-002: Inject few-shot examples from valid-patterns.md

**As the** `/api/generate` endpoint, **I want** to parse `backend/llm-skills/strudel-pattern-generator/examples/valid-patterns.md` and include the three verified patterns as few-shot user/assistant message pairs, **so that** the LLM receives concrete correct examples before seeing the real user request.

**Acceptance Criteria:**
- [ ] A pure function `load_few_shot_examples(path: Path) -> list[dict[str, str]]` exists
- [ ] The function parses `valid-patterns.md` and returns exactly 3 dicts, each with keys `"user"` and `"assistant"`
- [ ] Each `"user"` value is constructed from the `**Parameters:**` line of each section, formatted as: `Generate one lo-fi Strudel pattern using mood "{mood}", style "{style}", and tempo {tempo}. Return only the pattern.`
- [ ] Each `"assistant"` value is the raw pattern string extracted from the fenced code block (` ``` `) in that section — no surrounding whitespace, no code fence markers
- [ ] `build_messages()` inserts these pairs between the system message and the final user request, in the order: system → few-shot pairs (user/assistant × 3) → user request
- [ ] If `valid-patterns.md` cannot be read or parsed, `build_messages()` falls back to zero few-shot examples (logs a warning) without crashing
- [ ] No new Python packages are added to install
- [ ] Typecheck / lint passes

### US-003: Unit tests for skill loading and message building

**As a** developer, **I want** unit tests covering the new loading and message-building logic, **so that** regressions in prompt construction are caught automatically.

**Acceptance Criteria:**
- [ ] Test file exists at `backend/test_llm_skill.py` (co-located with `main.py`)
- [ ] `test_load_skill_body_strips_frontmatter`: given a file with YAML frontmatter, asserts the returned string starts after the closing `---` and does not contain `---`
- [ ] `test_load_skill_body_no_frontmatter`: given a file with no `---` delimiters, asserts full content is returned unchanged
- [ ] `test_load_few_shot_examples_count`: given the real `valid-patterns.md`, asserts exactly 3 examples are returned
- [ ] `test_load_few_shot_examples_structure`: asserts each returned dict has keys `"user"` and `"assistant"` with non-empty string values
- [ ] `test_build_messages_structure`: given mocked skill body and 3 few-shot examples, asserts the returned list has length 6 (1 system + 3×2 few-shot + 1 user) — wait, few-shot pairs are 3 user + 3 assistant = 6, plus 1 system + 1 user = 8 total messages
- [ ] `test_build_messages_system_content`: asserts the first message has `role == "system"` and its content equals the provided skill body string
- [ ] `test_build_messages_last_message`: asserts the last message has `role == "user"` and includes the actual mood, style, and tempo values
- [ ] All tests pass with `pytest backend/test_llm_skill.py`
- [ ] Typecheck / lint passes

## Functional Requirements

- **FR-1:** `load_skill_body(path: Path) -> str` reads `SKILL.md` from disk and returns the content after stripping the YAML frontmatter block (content between the first and second `---` line, inclusive).
- **FR-2:** `load_few_shot_examples(path: Path) -> list[dict[str, str]]` reads `valid-patterns.md` and extracts one `{user, assistant}` pair per style section by parsing the `**Parameters:**` line and the fenced code block within each `---`-delimited section.
- **FR-3:** `build_messages(body: GenerateRequestBody, skill_body: str, few_shot: list[dict[str, str]]) -> list[dict[str, str]]` constructs the full message list: system (skill_body) + interleaved few-shot user/assistant pairs + final user request.
- **FR-4:** The skill file paths are resolved at module level or inside the route handler using `Path(__file__).parent / "llm-skills/strudel-pattern-generator/SKILL.md"` (and analogously for `valid-patterns.md`). No hardcoded absolute paths.
- **FR-5:** If `load_skill_body` raises `FileNotFoundError`, the endpoint raises `HTTPException(500)` with a clear message. If `load_few_shot_examples` fails, the endpoint logs a warning and proceeds with zero few-shot examples.
- **FR-6:** No new third-party Python packages are introduced. Standard library only (`pathlib`, `re`) for parsing.

## Non-Goals (Out of Scope)

- Modifying the frontend (`src/`) in any way.
- Caching the skill file content across requests (each request may re-read from disk; caching is a future concern).
- Supporting dynamic or user-supplied skill files.
- Changing the OpenAI model, retry logic, or `validate_pattern` / `is_malformed_pattern` functions.
- Adding authentication or rate limiting.

## Open Questions

- Should `load_skill_body` and `load_few_shot_examples` live in `main.py` or be extracted to a dedicated `llm_skill.py` module? Either is acceptable for MVP; prefer co-location in `main.py` unless the file grows too large.
