from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from openai import OpenAI
from pydantic import BaseModel, Field, StrictInt, StrictStr, field_validator

MIN_TEMPO = 60
MAX_TEMPO = 120
MAX_PATTERN_LENGTH = 500
MAX_GENERATION_ATTEMPTS = 2

INVALID_PAYLOAD_ERROR = (
    f"Invalid payload. Expected {{ mood: string, tempo: number ({MIN_TEMPO}-{MAX_TEMPO}), style: string }}"
)
SKILL_MARKDOWN_PATH = Path(__file__).resolve().parent / "llm-skills" / "strudel-pattern-generator" / "SKILL.md"
VALID_PATTERNS_MARKDOWN_PATH = (
    Path(__file__).resolve().parent
    / "llm-skills"
    / "strudel-pattern-generator"
    / "examples"
    / "valid-patterns.md"
)

load_dotenv()

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


class GenerateRequestBody(BaseModel):
    mood: StrictStr
    tempo: StrictInt = Field(ge=MIN_TEMPO, le=MAX_TEMPO)
    style: StrictStr

    @field_validator("mood", "style")
    @classmethod
    def validate_non_empty_text(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Value must be a non-empty string.")
        return trimmed


@app.exception_handler(RequestValidationError)
async def handle_validation_error(_request: Any, _exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": INVALID_PAYLOAD_ERROR})


def build_messages(body: GenerateRequestBody) -> list[dict[str, str]]:
    system_prompt = load_skill_body(SKILL_MARKDOWN_PATH)
    user_request = (
        f'Generate one lo-fi Strudel pattern using mood "{body.mood}", '
        f'style "{body.style}", and tempo {body.tempo}. Return only the pattern.'
    )
    messages: list[dict[str, str]] = [
        {
            "role": "system",
            "content": system_prompt,
        },
    ]
    try:
        for example in load_few_shot_examples(VALID_PATTERNS_MARKDOWN_PATH):
            messages.append({"role": "user", "content": example["user"]})
            messages.append({"role": "assistant", "content": example["assistant"]})
    except Exception as exc:
        logger.warning("Failed to load few-shot examples from %s: %s", VALID_PATTERNS_MARKDOWN_PATH, exc)

    messages.append({"role": "user", "content": user_request})
    return messages


def load_few_shot_examples(path: Path) -> list[dict[str, str]]:
    content = path.read_text(encoding="utf-8")
    examples: list[dict[str, str]] = []
    sections = re.findall(r"^##\s+(.+?)\n(.*?)(?=^##\s+|\Z)", content, flags=re.MULTILINE | re.DOTALL)
    for raw_style, section_body in sections:
        style = raw_style.strip().lower()
        parameters_match = re.search(r"\*\*Parameters:\*\*\s*(.+)", section_body)
        code_match = re.search(r"```(?:[^\n]*)\n(.*?)```", section_body, flags=re.DOTALL)
        if parameters_match is None and code_match is None:
            continue
        if parameters_match is None:
            raise ValueError(f'Missing "**Parameters:**" line for style "{style}"')
        parameters: dict[str, str] = {}
        for segment in parameters_match.group(1).split(","):
            key, separator, value = segment.partition(":")
            if separator != ":":
                continue
            parameters[key.strip().lower()] = value.strip()

        mood = parameters.get("mood")
        tempo_text = parameters.get("tempo")
        if mood is None or tempo_text is None:
            raise ValueError(f'Missing mood/tempo parameters for style "{style}"')
        if not tempo_text.isdigit():
            raise ValueError(f'Invalid tempo parameter "{tempo_text}" for style "{style}"')

        if code_match is None:
            raise ValueError(f'Missing fenced code block for style "{style}"')
        assistant = code_match.group(1).strip()
        if not assistant:
            raise ValueError(f'Empty pattern for style "{style}"')

        examples.append(
            {
                "user": (
                    f'Generate one lo-fi Strudel pattern using mood "{mood}", '
                    f'style "{style}", and tempo {int(tempo_text)}. Return only the pattern.'
                ),
                "assistant": assistant,
            }
        )

    if len(examples) != 3:
        raise ValueError(f"Expected 3 examples, found {len(examples)}")

    return examples


def load_skill_body(path: Path) -> str:
    content = path.read_text(encoding="utf-8")
    lines = content.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return content

    for index, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            return "".join(lines[index + 1 :])

    return content


def is_malformed_pattern(pattern: str) -> bool:
    if "```" in pattern:
        return True
    if re.search(r"^pattern\s*:", pattern, flags=re.IGNORECASE):
        return True
    if re.search(r"^(here is|here's|this is)", pattern, flags=re.IGNORECASE):
        return True
    return False


def validate_pattern(value: Any) -> str | None:
    if not isinstance(value, str):
        return None

    trimmed = value.strip()
    if not trimmed:
        return None
    if len(trimmed) > MAX_PATTERN_LENGTH:
        return None
    if is_malformed_pattern(trimmed):
        return None

    return trimmed


def extract_pattern_candidate(response: Any) -> Any:
    choices: Any = None
    if isinstance(response, dict):
        choices = response.get("choices")
    else:
        choices = getattr(response, "choices", None)

    if not isinstance(choices, list) or not choices:
        return None

    first_choice = choices[0]
    if isinstance(first_choice, dict):
        message = first_choice.get("message")
    else:
        message = getattr(first_choice, "message", None)

    if message is None:
        return None
    if isinstance(message, dict):
        return message.get("content")
    return getattr(message, "content", None)


def flatten_text_content(value: Any) -> str | None:
    if isinstance(value, str):
        return value

    if not isinstance(value, list):
        return None

    fragments: list[str] = []
    for item in value:
        part_type: Any = None
        text: Any = None
        if isinstance(item, dict):
            part_type = item.get("type")
            text = item.get("text")
        else:
            part_type = getattr(item, "type", None)
            text = getattr(item, "text", None)

        if part_type == "text" and isinstance(text, str):
            fragments.append(text)

    if not fragments:
        return None

    return "".join(fragments)


@app.post("/api/generate")
def generate_pattern(body: GenerateRequestBody) -> dict[str, str]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured")

    client = OpenAI(api_key=api_key)

    for attempt in range(MAX_GENERATION_ATTEMPTS):
        try:
            response = client.chat.completions.create(
                model="gpt-5.1",
                messages=build_messages(body),
            )
            logger.debug("OpenAI response: %s", response)
        except Exception as exc:
            logger.error("OpenAI API error (attempt %d): %s: %s", attempt + 1, type(exc).__name__, exc)
            if attempt == MAX_GENERATION_ATTEMPTS - 1:
                raise HTTPException(status_code=500, detail="Failed to reach OpenAI Chat Completions API") from exc
            continue

        content = flatten_text_content(extract_pattern_candidate(response))
        logger.debug("Extracted content: %r", content)
        pattern = validate_pattern(content)
        if pattern:
            return {"pattern": pattern}

    raise HTTPException(status_code=500, detail="OpenAI returned an invalid Strudel pattern")


@app.exception_handler(HTTPException)
async def handle_http_exception(_request: Any, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
    return JSONResponse(status_code=exc.status_code, content={"error": detail})
