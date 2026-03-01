from __future__ import annotations

from typing import Literal
from typing import Optional

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    StrictStr,
    field_validator,
    model_validator,
)

from models.constants import (
    DEFAULT_DURATION_SECONDS,
    IMAGE_SIZE,
    MAX_DURATION_SECONDS,
    MAX_TEMPO,
    MIN_DURATION_SECONDS,
    MIN_TEMPO,
)


class GenerateRequestBody(BaseModel):
    mode: Literal["text", "text+params", "text-and-parameters", "params", "parameters"] = "params"
    prompt: Optional[StrictStr] = None
    mood: StrictStr = "chill"
    tempo: StrictInt = Field(default=80, ge=MIN_TEMPO, le=MAX_TEMPO)
    duration: StrictInt = Field(
        default=DEFAULT_DURATION_SECONDS,
        ge=MIN_DURATION_SECONDS,
        le=MAX_DURATION_SECONDS,
    )
    style: StrictStr = "jazz"

    @field_validator("prompt")
    @classmethod
    def validate_prompt_if_provided(cls, value: str | None) -> str | None:
        if value is None:
            return None

        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Value must be a non-empty string.")
        return trimmed

    @field_validator("mood", "style")
    @classmethod
    def validate_non_empty_text(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Value must be a non-empty string.")
        return trimmed

    @model_validator(mode="after")
    def validate_prompt_for_mode(self) -> "GenerateRequestBody":
        if self.mode in ("text", "text+params", "text-and-parameters") and self.prompt is None:
            raise ValueError("prompt is required in text modes.")
        return self


class GenerateImageRequestBody(BaseModel):
    prompt: StrictStr
    target_width: StrictInt = Field(default=IMAGE_SIZE, ge=1, alias="targetWidth")
    target_height: StrictInt = Field(default=IMAGE_SIZE, ge=1, alias="targetHeight")

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("prompt")
    @classmethod
    def validate_non_empty_prompt(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Value must be a non-empty string.")
        return trimmed
