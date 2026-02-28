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

        few_shots = [{"user": "few-shot-user", "assistant": "few-shot-assistant"}]
        with (
            patch("main.load_skill_body", return_value="loaded prompt from file") as load_skill,
            patch("main.load_few_shot_examples", return_value=few_shots) as load_few_shots,
        ):
            messages = main.build_messages(request)

        self.assertEqual(messages[0]["role"], "system")
        self.assertEqual(messages[0]["content"], "loaded prompt from file")
        self.assertEqual(messages[1], {"role": "user", "content": "few-shot-user"})
        self.assertEqual(messages[2], {"role": "assistant", "content": "few-shot-assistant"})
        self.assertEqual(
            messages[3],
            {
                "role": "user",
                "content": 'Generate one lo-fi Strudel pattern using mood "calm", style "jazz", and tempo 90. Return only the pattern.',
            },
        )
        load_skill.assert_called_once_with(main.SKILL_MARKDOWN_PATH)
        load_few_shots.assert_called_once_with(main.VALID_PATTERNS_MARKDOWN_PATH)

    def test_build_messages_inserts_three_few_shot_pairs_before_user_request(self) -> None:
        request = main.GenerateRequestBody(mood="warm", tempo=75, style="ambient")
        few_shots = [
            {"user": "example-user-1", "assistant": "example-assistant-1"},
            {"user": "example-user-2", "assistant": "example-assistant-2"},
            {"user": "example-user-3", "assistant": "example-assistant-3"},
        ]

        with (
            patch("main.load_skill_body", return_value="system prompt"),
            patch("main.load_few_shot_examples", return_value=few_shots),
        ):
            messages = main.build_messages(request)

        self.assertEqual(messages[0], {"role": "system", "content": "system prompt"})
        self.assertEqual(messages[1], {"role": "user", "content": "example-user-1"})
        self.assertEqual(messages[2], {"role": "assistant", "content": "example-assistant-1"})
        self.assertEqual(messages[3], {"role": "user", "content": "example-user-2"})
        self.assertEqual(messages[4], {"role": "assistant", "content": "example-assistant-2"})
        self.assertEqual(messages[5], {"role": "user", "content": "example-user-3"})
        self.assertEqual(messages[6], {"role": "assistant", "content": "example-assistant-3"})
        self.assertEqual(
            messages[7],
            {
                "role": "user",
                "content": 'Generate one lo-fi Strudel pattern using mood "warm", style "ambient", and tempo 75. Return only the pattern.',
            },
        )
        self.assertEqual(len(messages), 8)

    def test_build_messages_falls_back_to_no_few_shot_when_loading_fails(self) -> None:
        request = main.GenerateRequestBody(mood="calm", tempo=90, style="jazz")

        with (
            patch("main.load_skill_body", return_value="system prompt"),
            patch("main.load_few_shot_examples", side_effect=ValueError("invalid markdown")),
            patch("main.logger.warning") as warn,
        ):
            messages = main.build_messages(request)

        self.assertEqual(messages[0], {"role": "system", "content": "system prompt"})
        self.assertEqual(
            messages[1],
            {
                "role": "user",
                "content": 'Generate one lo-fi Strudel pattern using mood "calm", style "jazz", and tempo 90. Return only the pattern.',
            },
        )
        self.assertEqual(len(messages), 2)
        warn.assert_called_once()

    def test_skill_path_is_resolved_relative_to_main_module(self) -> None:
        expected = (
            Path(main.__file__).resolve().parent
            / "llm-skills"
            / "strudel-pattern-generator"
            / "SKILL.md"
        )
        self.assertEqual(main.SKILL_MARKDOWN_PATH, expected)

    def test_valid_patterns_path_is_resolved_relative_to_main_module(self) -> None:
        expected = (
            Path(main.__file__).resolve().parent
            / "llm-skills"
            / "strudel-pattern-generator"
            / "examples"
            / "valid-patterns.md"
        )
        self.assertEqual(main.VALID_PATTERNS_MARKDOWN_PATH, expected)


class LoadFewShotExamplesTests(unittest.TestCase):
    def test_load_few_shot_examples_returns_three_user_assistant_dicts(self) -> None:
        examples = main.load_few_shot_examples(main.VALID_PATTERNS_MARKDOWN_PATH)

        self.assertEqual(len(examples), 3)
        for example in examples:
            self.assertEqual(set(example.keys()), {"user", "assistant"})
            self.assertIsInstance(example["user"], str)
            self.assertIsInstance(example["assistant"], str)

    def test_load_few_shot_examples_builds_expected_user_prompts(self) -> None:
        examples = main.load_few_shot_examples(main.VALID_PATTERNS_MARKDOWN_PATH)

        self.assertEqual(
            [example["user"] for example in examples],
            [
                'Generate one lo-fi Strudel pattern using mood "melancholic", style "jazz", and tempo 90. Return only the pattern.',
                'Generate one lo-fi Strudel pattern using mood "energetic", style "hip-hop", and tempo 85. Return only the pattern.',
                'Generate one lo-fi Strudel pattern using mood "calm", style "ambient", and tempo 70. Return only the pattern.',
            ],
        )

    def test_load_few_shot_examples_extracts_raw_patterns_without_fences(self) -> None:
        examples = main.load_few_shot_examples(main.VALID_PATTERNS_MARKDOWN_PATH)

        self.assertEqual(
            examples[0]["assistant"],
            'stack([s("bd ~ [~ bd] ~"), s("~ ~ sd ~"), s("hh*2"), note("c3 eb3 f3 ~ g3 ~ bb3 ~").sound("piano")]).slow(2).gain(0.7).cpm(90)',
        )
        self.assertEqual(
            examples[1]["assistant"],
            'stack([s("bd ~ bd ~"), s("~ sd ~ sd"), s("hh ~ hh ~"), note("c3 ~ eb3 ~ g3 ~ bb3 ~").sound("piano")]).slow(2).gain(0.85).cpm(85)',
        )
        self.assertEqual(
            examples[2]["assistant"],
            'stack([s("bd ~ ~ ~"), s("~ ~ sd ~"), s("~ hh ~ hh"), note("c3 ~ ~ e3 ~ ~ g3 ~").sound("piano")]).slow(4).gain(0.5).cpm(70)',
        )
        for example in examples:
            self.assertFalse(example["assistant"].startswith("```"))
            self.assertFalse(example["assistant"].endswith("```"))


if __name__ == "__main__":
    unittest.main()
