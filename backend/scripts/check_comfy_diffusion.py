#!/usr/bin/env python3
"""Quick check that comfy-diffusion imports and runtime pass.

Run from backend/: uv run python scripts/check_comfy_diffusion.py
"""
from __future__ import annotations

import sys


def main() -> int:
    print("1. Importing comfy_diffusion...")
    try:
        from comfy_diffusion import check_runtime
    except Exception as e:
        print(f"   FAIL: {e}", file=sys.stderr)
        return 1
    print("   OK")

    print("2. Running check_runtime()...")
    try:
        runtime = check_runtime()
    except Exception as e:
        print(f"   FAIL: {e}", file=sys.stderr)
        return 1
    if runtime.get("error"):
        print(f"   FAIL: {runtime['error']}", file=sys.stderr)
        print(
            "\nTo fix: install comfy-diffusion with ComfyUI vendor (submodule):",
            "\n  bash backend/scripts/setup-comfy-diffusion.sh",
            "\nSee backend/scripts/README-comfy-diffusion.md for details.",
            file=sys.stderr,
        )
        return 1
    print("   OK", runtime)

    print("3. Ensuring ComfyUI on path and importing key modules...")
    try:
        from comfy_diffusion._runtime import ensure_comfyui_on_path
        ensure_comfyui_on_path()
        from comfy_diffusion.conditioning import encode_prompt
        from comfy_diffusion.sampling import sample_advanced
        from comfy_diffusion import vae_decode_batch
        from comfy_diffusion.models import ModelManager
    except Exception as e:
        print(f"   FAIL: {e}", file=sys.stderr)
        return 1
    print("   OK (encode_prompt, sample_advanced, vae_decode_batch, ModelManager)")

    print("4. Checking torch CUDA...")
    try:
        import torch
        cuda_ok = torch.cuda.is_available()
        print(f"   torch {torch.__version__}, CUDA available: {cuda_ok}")
        if cuda_ok:
            print(f"   device: {torch.cuda.get_device_name(0)}")
    except Exception as e:
        print(f"   WARN: {e}", file=sys.stderr)

    print("\nAll checks passed. comfy-diffusion should work for Wan I2V.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
