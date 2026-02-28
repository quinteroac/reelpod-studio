#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${ACE_STEP_API_HOME:-}" ]]; then
  echo "Error: ACE_STEP_API_HOME is not set." >&2
  exit 1
fi

if [[ ! -d "${ACE_STEP_API_HOME}" ]]; then
  echo "Error: ACE_STEP_API_HOME directory does not exist: ${ACE_STEP_API_HOME}" >&2
  exit 1
fi

cd "${ACE_STEP_API_HOME}"
exec uv run acestep-api
