# Comfy-Diffusion (Wan I2V) Setup

Video generation uses [comfy-diffusion](https://github.com/quinteroac/comfy-diffusion). The project depends on it **from PyPI** (`comfy-diffusion[comfyui]>=0.1.1`), but the PyPI package does **not** include the **vendored ComfyUI** (git submodule). So after `uv sync` the runtime is missing and `check_runtime()` fails with "No module named 'comfyui_version'". You must run the setup script once (and again after any `uv sync`) to get the ComfyUI runtime.

## Quick fix

From the **repository root**:

```bash
bash backend/scripts/setup-comfy-diffusion.sh
```

This will:

1. Clone `comfy-diffusion` with `--recurse-submodules` into `backend/vendor/comfy-diffusion`
2. Install it in **editable** mode with the `[comfyui]` extra so `vendor/ComfyUI` is present
3. Run `scripts/check_comfy_diffusion.py` to verify

## Verify

From `backend/`:

```bash
.venv/bin/python scripts/check_comfy_diffusion.py
```

Using the venv Python directly avoids `uv run` re-syncing and overwriting the editable comfy-diffusion install.

If all steps pass, the backend can load the Wan I2V pipeline when `WAN_COMFY_MODELS_DIR` (and model filenames) are set.

## After `uv sync`

If you run `uv sync` later, uv may reinstall comfy-diffusion from PyPI (no vendor). The runtime check will fail again. Run the setup script again to restore the editable install with ComfyUI:

```bash
bash backend/scripts/setup-comfy-diffusion.sh
```

## Optional: add vendor to .gitignore

To avoid committing the cloned repo:

```bash
echo "backend/vendor/" >> .gitignore
```
