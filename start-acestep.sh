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

# GPU sharing with image generation: offload models to CPU when idle so the
# diffusion pipeline can use the GPU. Override via backend/.env or environment.
# See https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/API.md
export ACESTEP_OFFLOAD_TO_CPU="${ACESTEP_OFFLOAD_TO_CPU:-true}"
export ACESTEP_OFFLOAD_DIT_TO_CPU="${ACESTEP_OFFLOAD_DIT_TO_CPU:-true}"
export ACESTEP_LM_OFFLOAD_TO_CPU="${ACESTEP_LM_OFFLOAD_TO_CPU:-true}"

cd "${ACE_STEP_API_HOME}"
exec uv run acestep-api
