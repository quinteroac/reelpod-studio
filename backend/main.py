from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError

from routes.api import handle_http_exception, handle_validation_error, router
from services import audio_service, image_service

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(router)
app.add_exception_handler(HTTPException, handle_http_exception)
app.add_exception_handler(RequestValidationError, handle_validation_error)


@app.on_event("startup")
def on_startup() -> None:
    audio_service.startup()
    image_service.startup()


@app.on_event("shutdown")
def on_shutdown() -> None:
    audio_service.shutdown()
