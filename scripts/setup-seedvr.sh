#!/usr/bin/env bash
# Clone SeedVR repo and download weights so the backend can use SeedVR upscaling.
# Idempotent: skips clone/download if already present. Run from project root or via bun run setup:seedvr.
set -euo pipefail

REPO_URL="https://github.com/ByteDance-Seed/SeedVR.git"
HF_REPO_ID="ByteDance-Seed/SeedVR2-3B"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
# Fixed location: backend/.seedvr (same path the backend uses; do not use SEEDVR_DIR env)
SEEDVR_DIR="$BACKEND_DIR/.seedvr"

need_clone=false
if [[ ! -d "$SEEDVR_DIR" ]]; then
  need_clone=true
elif [[ ! -f "$SEEDVR_DIR/projects/inference_seedvr2_3b.py" ]]; then
  need_clone=true
fi

if [[ "$need_clone" == true ]]; then
  echo "SeedVR: cloning $REPO_URL into $SEEDVR_DIR ..."
  if [[ -d "$SEEDVR_DIR" ]]; then
    rm -rf "$SEEDVR_DIR"
  fi
  git clone --depth 1 "$REPO_URL" "$SEEDVR_DIR"
fi

# uv venv and deps (no conda)
if [[ ! -f "$SEEDVR_DIR/.venv/bin/torchrun" ]]; then
  echo "SeedVR: creating uv venv and installing dependencies in $SEEDVR_DIR ..."
  uv venv "$SEEDVR_DIR/.venv"
  uv pip install --python "$SEEDVR_DIR/.venv/bin/python" -r "$SEEDVR_DIR/requirements.txt"
fi

CKPTS_DIR="$SEEDVR_DIR/ckpts"
need_weights=false
if [[ ! -d "$CKPTS_DIR" ]]; then
  need_weights=true
elif [[ -z "$(ls -A "$CKPTS_DIR" 2>/dev/null)" ]]; then
  need_weights=true
fi

if [[ "$need_weights" == true ]]; then
  echo "SeedVR: downloading weights $HF_REPO_ID into $CKPTS_DIR ..."
  (
    export SEEDVR_DIR="$SEEDVR_DIR"
    cd "$BACKEND_DIR"
    uv run python -c "
from pathlib import Path
from huggingface_hub import snapshot_download
import os
d = Path(os.environ['SEEDVR_DIR'])
ckpts = d / 'ckpts'
ckpts.mkdir(parents=True, exist_ok=True)
snapshot_download(repo_id='$HF_REPO_ID', local_dir=str(ckpts))
print('SeedVR weights ready at', ckpts)
"
  )
fi

echo "SeedVR ready at $SEEDVR_DIR."
