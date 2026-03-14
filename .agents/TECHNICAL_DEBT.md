# Technical Debt

## Iteration 000024

- Title: Restore repo-wide lint compliance
  Description: Iteration 000024 meets the backend functional requirements for separate ACEStep model loading, but `npm run lint` fails with 116 errors across the repository, so the PRD quality gate is not fully green.

- Title: Migrate FastAPI lifecycle hooks
  Description: `backend/main.py` still uses deprecated FastAPI `on_event` startup and shutdown handlers, which emit warnings during backend tests.

- Title: Resolve backend Pydantic alias warnings
  Description: Backend tests emit `UnsupportedFieldAttributeWarning` warnings for aliased fields; these should be reviewed and corrected to keep the validation layer clean.
