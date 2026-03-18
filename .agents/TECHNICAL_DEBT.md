# Technical Debt

## Iteration 000034

- Title: LTX2 video prompt bypass in video_service.py
  Description: `_resolve_pipeline_prompts` sets `video_prompt` to `validated.image_prompt` instead of the actual LTX2-formatted prompt; the `_generate_video_prompt_ltx2` call is commented out. Restore when LTX2 video prompt quality is satisfactory.

## Iteration 000024

- Title: Restore repo-wide lint compliance
  Description: Iteration 000024 meets the backend functional requirements for separate ACEStep model loading, but `npm run lint` fails with 116 errors across the repository, so the PRD quality gate is not fully green.

- Title: Migrate FastAPI lifecycle hooks
  Description: `backend/main.py` still uses deprecated FastAPI `on_event` startup and shutdown handlers, which emit warnings during backend tests.

- Title: Resolve backend Pydantic alias warnings
  Description: Backend tests emit `UnsupportedFieldAttributeWarning` warnings for aliased fields; these should be reviewed and corrected to keep the validation layer clean.
