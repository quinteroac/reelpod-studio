from __future__ import annotations

from pathlib import Path

import main


def test_load_skill_body_strips_frontmatter(tmp_path: Path) -> None:
    skill_path = tmp_path / "SKILL.md"
    skill_path.write_text(
        "---\nname: demo\n---\n# Prompt Body\nUse this prompt body.\n",
        encoding="utf-8",
    )

    result = main.load_skill_body(skill_path)

    assert result.startswith("# Prompt Body\nUse this prompt body.\n")
    assert "---" not in result


def test_load_skill_body_no_frontmatter(tmp_path: Path) -> None:
    skill_path = tmp_path / "SKILL.md"
    content = "# Prompt Body\nNo frontmatter here.\n"
    skill_path.write_text(content, encoding="utf-8")

    result = main.load_skill_body(skill_path)

    assert result == content


def test_load_few_shot_examples_count() -> None:
    examples = main.load_few_shot_examples(main.VALID_PATTERNS_MARKDOWN_PATH)

    assert len(examples) == 3


def test_load_few_shot_examples_structure() -> None:
    examples = main.load_few_shot_examples(main.VALID_PATTERNS_MARKDOWN_PATH)

    for example in examples:
        assert set(example.keys()) == {"user", "assistant"}
        assert isinstance(example["user"], str)
        assert isinstance(example["assistant"], str)
        assert example["user"].strip() != ""
        assert example["assistant"].strip() != ""


def test_build_messages_structure(monkeypatch) -> None:
    request = main.GenerateRequestBody(mood="dreamy", tempo=88, style="ambient")
    few_shots = [
        {"user": "example-user-1", "assistant": "example-assistant-1"},
        {"user": "example-user-2", "assistant": "example-assistant-2"},
        {"user": "example-user-3", "assistant": "example-assistant-3"},
    ]
    monkeypatch.setattr(main, "load_skill_body", lambda _path: "system prompt")
    monkeypatch.setattr(main, "load_few_shot_examples", lambda _path: few_shots)

    messages = main.build_messages(request)

    assert len(messages) == 8


def test_build_messages_system_content(monkeypatch) -> None:
    request = main.GenerateRequestBody(mood="calm", tempo=90, style="jazz")
    skill_body = "loaded prompt from skill file"
    monkeypatch.setattr(main, "load_skill_body", lambda _path: skill_body)
    monkeypatch.setattr(main, "load_few_shot_examples", lambda _path: [])

    messages = main.build_messages(request)

    assert messages[0]["role"] == "system"
    assert messages[0]["content"] == skill_body


def test_build_messages_last_message(monkeypatch) -> None:
    request = main.GenerateRequestBody(mood="chill", tempo=78, style="hip-hop")
    monkeypatch.setattr(main, "load_skill_body", lambda _path: "system prompt")
    monkeypatch.setattr(main, "load_few_shot_examples", lambda _path: [])

    messages = main.build_messages(request)
    last_message = messages[-1]

    assert last_message["role"] == "user"
    assert 'mood "chill"' in last_message["content"]
    assert 'style "hip-hop"' in last_message["content"]
    assert "tempo 78" in last_message["content"]
