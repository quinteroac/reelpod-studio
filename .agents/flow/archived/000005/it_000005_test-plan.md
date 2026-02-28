# Test Plan - Iteration 000005

## Scope

- Validate that `load_skill_body(path)` reads SKILL.md from disk and returns the markdown body after stripping YAML frontmatter, and that `build_messages()` uses it as the system prompt.
- Validate that `load_few_shot_examples(path)` parses valid-patterns.md and returns exactly three `{user, assistant}` pairs with correct structure and content.
- Validate that `build_messages(body, skill_body, few_shot)` produces the correct message list: system + 3 few-shot pairs (6 messages) + 1 user request (8 messages total).
- Validate path resolution uses `Path(__file__).parent` (no hardcoded absolute paths) and that error handling meets FR-5 (FileNotFoundError → 500; few-shot parse failure → log warning, zero examples).
- Ensure every functional requirement (FR-1–FR-6) has automated test coverage and that the backend test suite runs with pytest without new third-party dependencies.

## Environment and data

- Runtime: Python 3.x; backend tests run with `pytest backend/test_llm_skill.py` from the project root (or from `backend/`).
- File system: repository must be checked out; `backend/llm-skills/strudel-pattern-generator/SKILL.md` and `backend/llm-skills/strudel-pattern-generator/examples/valid-patterns.md` must exist (or tests use temp files/mocks where specified).
- Dependencies: standard library only for new code (`pathlib`, `re`); no new Python packages added (per FR-6).
- Test location: `backend/test_llm_skill.py` co-located with backend code (per US-003-AC01).

---

## User Story: US-001 - Load SKILL.md from disk and use as system prompt

| Test Case ID | Description | Type (unit/integration/e2e) | Mode (automated/manual) | Correlated Requirements (US-XXX, FR-X) | Expected Result |
|---|---|---|---|---|---|
| TC-001-01 | Given a file with YAML frontmatter, `load_skill_body` returns the content after the closing `---` and the result does not contain the frontmatter delimiter | unit | automated | US-001, FR-1 | Returned string starts after the second `---` line and does not include `---` from the frontmatter block |
| TC-001-02 | Given a file with no `---` delimiters, `load_skill_body` returns the full file content unchanged | unit | automated | US-001, FR-1 | Full content is returned as-is |
| TC-001-03 | `build_messages` is called with a provided skill body; the first message has `role == "system"` and its content equals the provided skill body | unit | automated | US-001, FR-3 | First element of returned list has `role: "system"` and `content` equal to the skill body string |
| TC-001-04 | Skill file path is resolved relative to the module (e.g. `Path(__file__).parent / "llm-skills/..."`); no hardcoded absolute paths in production code | unit | automated | US-001, FR-4 | Path used for SKILL.md is derived from `__file__` (or equivalent); test may assert path is relative or contains expected segments |
| TC-001-05 | When `load_skill_body` raises `FileNotFoundError`, the `/api/generate` endpoint (or the code path that loads the skill) raises HTTPException with status 500 and a clear message | integration | automated | US-001, FR-5 | Request to generate with missing skill file results in 500 response and error message indicating file not found |
| TC-001-06 | Backend runs and `/api/generate` is callable using only existing dependencies (no new third-party packages required) | integration | automated | US-001, FR-6 | `pytest backend/test_llm_skill.py` passes and backend starts without import errors |

---

## User Story: US-002 - Inject few-shot examples from valid-patterns.md

| Test Case ID | Description | Type (unit/integration/e2e) | Mode (automated/manual) | Correlated Requirements (US-XXX, FR-X) | Expected Result |
|---|---|---|---|---|---|
| TC-002-01 | Given the real `valid-patterns.md`, `load_few_shot_examples` returns exactly 3 items | unit | automated | US-002, FR-2 | `len(load_few_shot_examples(path)) == 3` |
| TC-002-02 | Each item returned by `load_few_shot_examples` has keys `"user"` and `"assistant"` with non-empty string values | unit | automated | US-002, FR-2 | For each dict: `"user" in d`, `"assistant" in d`, and both values are non-empty strings |
| TC-002-03 | Each `"user"` value is built from the `**Parameters:**` line in the format `Generate one lo-fi Strudel pattern using mood "{mood}", style "{style}", and tempo {tempo}. Return only the pattern.` | unit | automated | US-002, FR-2 | Parsed user strings match the expected format and contain the mood, style, and tempo from the file |
| TC-002-04 | Each `"assistant"` value is the raw pattern from the fenced code block with no leading/trailing whitespace or code fence markers | unit | automated | US-002, FR-2 | Assistant strings start with `stack([` (or equivalent) and contain no ``` markers |
| TC-002-05 | `build_messages` with 3 few-shot examples produces a list of 8 messages: 1 system + 3 user + 3 assistant + 1 final user request | unit | automated | US-002, FR-3 | `len(messages) == 8`; order is system, user, assistant, user, assistant, user, assistant, user |
| TC-002-06 | When `valid-patterns.md` cannot be read or parsed, `build_messages` is called with zero few-shot examples and a warning is logged; no crash | unit | automated | US-002, FR-5 | With mocked failing `load_few_shot_examples` or missing file, build_messages receives empty list and completes; test may assert log or fallback behavior |
| TC-002-07 | Last message in `build_messages` output has `role == "user"` and includes the actual mood, style, and tempo from the request body | unit | automated | US-002, FR-3 | Last element has `role: "user"` and content contains the mood, style, and tempo values passed in the body |

---

## User Story: US-003 - Unit tests for skill loading and message building

| Test Case ID | Description | Type (unit/integration/e2e) | Mode (automated/manual) | Correlated Requirements (US-XXX, FR-X) | Expected Result |
|---|---|---|---|---|---|
| TC-003-01 | Test file `backend/test_llm_skill.py` exists and contains `test_load_skill_body_strips_frontmatter` | unit | automated | US-003, FR-1 | Test exists and asserts returned string starts after closing `---` and does not contain `---` |
| TC-003-02 | Test file contains `test_load_skill_body_no_frontmatter` | unit | automated | US-003, FR-1 | Test exists and asserts full content is returned when no `---` delimiters present |
| TC-003-03 | Test file contains `test_load_few_shot_examples_count` using real `valid-patterns.md` | unit | automated | US-003, FR-2 | Test exists and asserts exactly 3 examples are returned |
| TC-003-04 | Test file contains `test_load_few_shot_examples_structure` | unit | automated | US-003, FR-2 | Test exists and asserts each dict has `"user"` and `"assistant"` with non-empty strings |
| TC-003-05 | Test file contains `test_build_messages_structure` with mocked skill body and 3 few-shot examples; asserts 8 messages total | unit | automated | US-003, FR-3 | Test exists and asserts list length is 8 (1 system + 6 few-shot + 1 user) |
| TC-003-06 | Test file contains `test_build_messages_system_content` | unit | automated | US-003, FR-3 | Test exists and asserts first message has `role == "system"` and content equals provided skill body |
| TC-003-07 | Test file contains `test_build_messages_last_message` | unit | automated | US-003, FR-3 | Test exists and asserts last message has `role == "user"` and includes mood, style, and tempo values |
| TC-003-08 | All tests in `backend/test_llm_skill.py` pass when run with `pytest backend/test_llm_skill.py` | unit | automated | US-003, FR-1, FR-2, FR-3 | Exit code 0; all test cases pass |
| TC-003-09 | Typecheck / lint passes for backend (e.g. no mypy/ruff errors in `backend/`) | unit | automated | US-003 | Linter and type checker report no errors for backend code |
