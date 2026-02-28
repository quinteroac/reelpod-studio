from __future__ import annotations

import os
import re
from typing import Any

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
    return [
        {
            "role": "system",
            "content": (
                "You are a Strudel pattern generator. Return only a valid Strudel pattern string. "
                "No markdown. No explanation."
            ),
        },
        {
            "role": "user",
            "content": (
                f'Generate one lo-fi Strudel pattern using mood "{body.mood}", '
                f'style "{body.style}", and tempo {body.tempo}. Return only the pattern.'
            ),
        },
    ]


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
                model="gpt-4o-mini",
                temperature=0.8,
                messages=build_messages(body),
            )
        except Exception as exc:
            if attempt == MAX_GENERATION_ATTEMPTS - 1:
                raise HTTPException(status_code=500, detail="Failed to reach OpenAI Chat Completions API") from exc
            continue

        content = flatten_text_content(extract_pattern_candidate(response))
        pattern = validate_pattern(content)
        if pattern:
            return {"pattern": pattern}

    raise HTTPException(status_code=500, detail="OpenAI returned an invalid Strudel pattern")


@app.exception_handler(HTTPException)
async def handle_http_exception(_request: Any, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
    return JSONResponse(status_code=exc.status_code, content={"error": detail})
