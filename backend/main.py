from __future__ import annotations

import io
import logging
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

from acestep.pipeline_ace_step import ACEStepPipeline
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, StrictInt, StrictStr, field_validator

MIN_TEMPO = 60
MAX_TEMPO = 120

INVALID_PAYLOAD_ERROR = (
    f"Invalid payload. Expected {{ mood: string, tempo: number ({MIN_TEMPO}-{MAX_TEMPO}), style: string }}"
)

# ACEStep model instance, loaded once at startup (US-001-AC02)
ace_model: ACEStepPipeline | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global ace_model
    logger.info("Loading ACEStep model...")
    ace_model = ACEStepPipeline()
    logger.info("ACEStep model loaded.")
    yield
    ace_model = None


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


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


def build_prompt(body: GenerateRequestBody) -> str:
    # Prompt template: "{mood} lofi {style}, {tempo} BPM"
    return f"{body.mood} lofi {body.style}, {body.tempo} BPM"


@app.post("/api/generate")
def generate_audio(body: GenerateRequestBody) -> StreamingResponse:
    if ace_model is None:
        raise HTTPException(status_code=500, detail="Audio generation failed")

    prompt = build_prompt(body)
    logger.debug("ACEStep prompt: %s", prompt)

    try:
        with tempfile.TemporaryDirectory() as tmp_dir:
            # ACEStep inference: instrumental (lyrics=""), 30s duration, 20 steps (US-001-AC05, AC06)
            results = ace_model(
                prompt=prompt,
                lyrics="",
                audio_duration=30,
                infer_step=20,
                format="wav",
                save_path=tmp_dir,
            )

            # results is a list of file paths + a trailing params dict; pick the first WAV file
            wav_paths = [r for r in results if isinstance(r, str) and r.endswith(".wav")]
            if not wav_paths:
                raise RuntimeError("ACEStep produced no WAV output")

            wav_bytes = Path(wav_paths[0]).read_bytes()
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("ACEStep inference error: %s: %s", type(exc).__name__, exc)
        raise HTTPException(status_code=500, detail="Audio generation failed") from exc

    return StreamingResponse(io.BytesIO(wav_bytes), media_type="audio/wav")


@app.exception_handler(HTTPException)
async def handle_http_exception(_request: Any, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
    return JSONResponse(status_code=exc.status_code, content={"error": detail})
