from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import main


class LoadSkillBodyTests(unittest.TestCase):
    def test_load_skill_body_returns_content_after_frontmatter(self) -> None:
        with TemporaryDirectory() as temp_dir:
            skill_path = Path(temp_dir) / "SKILL.md"
            skill_path.write_text("---\nname: demo\n---\n# Prompt Body\nUse this.\n", encoding="utf-8")

            result = main.load_skill_body(skill_path)

        self.assertEqual(result, "# Prompt Body\nUse this.\n")

    def test_load_skill_body_returns_full_content_without_frontmatter(self) -> None:
        with TemporaryDirectory() as temp_dir:
            skill_path = Path(temp_dir) / "SKILL.md"
            content = "# Prompt Body\nNo frontmatter here.\n"
            skill_path.write_text(content, encoding="utf-8")

            result = main.load_skill_body(skill_path)

        self.assertEqual(result, content)


class BuildMessagesTests(unittest.TestCase):
    def test_build_messages_uses_loaded_skill_body_for_system_prompt(self) -> None:
        request = main.GenerateRequestBody(mood="calm", tempo=90, style="jazz")

        with patch("main.load_skill_body", return_value="loaded prompt from file") as load_skill:
            messages = main.build_messages(request)

        self.assertEqual(messages[0]["role"], "system")
        self.assertEqual(messages[0]["content"], "loaded prompt from file")
        load_skill.assert_called_once_with(main.SKILL_MARKDOWN_PATH)

    def test_skill_path_is_resolved_relative_to_main_module(self) -> None:
        expected = (
            Path(main.__file__).resolve().parent
            / "llm-skills"
            / "strudel-pattern-generator"
            / "SKILL.md"
        )
        self.assertEqual(main.SKILL_MARKDOWN_PATH, expected)


if __name__ == "__main__":
    unittest.main()
