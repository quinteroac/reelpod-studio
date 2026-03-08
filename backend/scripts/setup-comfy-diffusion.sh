#!/usr/bin/env bash
# Install comfy-diffusion with ComfyUI vendor (submodule) so Wan I2V works.
# Run from repo root: bash backend/scripts/setup-comfy-diffusion.sh
# Or from backend/: bash scripts/setup-comfy-diffusion.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VENDOR_DIR="$BACKEND_DIR/vendor"
COMFY_DIFFUSION_DIR="$VENDOR_DIR/comfy-diffusion"
COMFYUI_DIR="$COMFY_DIFFUSION_DIR/vendor/ComfyUI"

echo "Backend dir: $BACKEND_DIR"
mkdir -p "$VENDOR_DIR"
if [[ ! -d "$COMFY_DIFFUSION_DIR/.git" ]]; then
  echo "Cloning comfy-diffusion with submodules..."
  git clone --recurse-submodules https://github.com/quinteroac/comfy-diffusion.git "$COMFY_DIFFUSION_DIR"
else
  echo "Updating comfy-diffusion and submodules..."
  (cd "$COMFY_DIFFUSION_DIR" && git pull && git submodule update --init --recursive)
fi

if [[ ! -d "$COMFYUI_DIR" ]] || [[ ! -f "$COMFYUI_DIR/comfyui_version.py" ]] 2>/dev/null; then
  echo "ComfyUI not found at $COMFYUI_DIR. Checking submodule..."
  (cd "$COMFY_DIFFUSION_DIR" && git submodule update --init --recursive)
fi

echo "Installing comfy-diffusion in editable mode (with comfyui extra)..."
cd "$BACKEND_DIR"
uv pip install -e "$COMFY_DIFFUSION_DIR[comfyui]"

echo "Running check (use venv python so uv run does not re-sync and overwrite editable install)..."
"$BACKEND_DIR/.venv/bin/python" scripts/check_comfy_diffusion.py
