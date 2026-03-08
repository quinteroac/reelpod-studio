from __future__ import annotations

import os

MIN_TEMPO = 60
MAX_TEMPO = 120
MIN_DURATION_SECONDS = 40
MAX_DURATION_SECONDS = 300
DEFAULT_DURATION_SECONDS = 40

INVALID_PAYLOAD_ERROR = (
    "Invalid payload. Expected { mode?: 'text'|'text+params'|'text-and-parameters'|'params'|'parameters', "
    f"prompt?: string, mood?: string, tempo?: number ({MIN_TEMPO}-{MAX_TEMPO}), "
    f"duration?: number ({MIN_DURATION_SECONDS}-{MAX_DURATION_SECONDS}), style?: string }}"
)

DEFAULT_ACESTEP_API_URL = "http://localhost:8001"
RELEASE_TASK_PATH = "/release_task"
QUERY_RESULT_PATH = "/query_result"
POLL_INTERVAL_SECONDS = 0.5
MAX_POLL_ATTEMPTS = 1200

# Anima image generation via comfy-diffusion (separate UNet/CLIP/VAE)
# https://github.com/quinteroac/comfy-diffusion/blob/master/examples/separate_components_example.py
# Set ANIMA_COMFY_MODELS_DIR or PYCOMFY_MODELS_DIR; ANIMA_COMFY_UNET, ANIMA_COMFY_CLIP, ANIMA_COMFY_VAE to filenames.
ANIMA_COMFY_MODELS_DIR = os.environ.get("ANIMA_COMFY_MODELS_DIR", "") or os.environ.get("PYCOMFY_MODELS_DIR", "")
ANIMA_COMFY_UNET = os.environ.get("ANIMA_COMFY_UNET", "") or os.environ.get("PYCOMFY_ANIMA_UNET", "")
ANIMA_COMFY_CLIP = os.environ.get("ANIMA_COMFY_CLIP", "") or os.environ.get("PYCOMFY_ANIMA_CLIP", "")
ANIMA_COMFY_VAE = os.environ.get("ANIMA_COMFY_VAE", "") or os.environ.get("PYCOMFY_ANIMA_VAE", "")
ANIMA_COMFY_CLIP_TYPE = os.environ.get("ANIMA_COMFY_CLIP_TYPE", "stable_diffusion")
ANIMA_COMFY_STEPS = int(os.environ.get("ANIMA_COMFY_STEPS", "25"))
ANIMA_COMFY_CFG = float(os.environ.get("ANIMA_COMFY_CFG", "7.0"))
ANIMA_COMFY_SAMPLER = os.environ.get("ANIMA_COMFY_SAMPLER", "euler")
ANIMA_COMFY_SCHEDULER = os.environ.get("ANIMA_COMFY_SCHEDULER", "normal")

IMAGE_SIZE = 1024
# Anima ~1MP native resolutions (inference then pad to target)
ANIMA_PREVIEW_SIZES = ((1280, 720), (720, 1280), (1024, 1024))
IMAGE_NUM_INFERENCE_STEPS = ANIMA_COMFY_STEPS  # alias for backward compatibility
IMAGE_ASPECT_TOLERANCE = 1e-6
# Real-ESRGAN Anime 4× upscaler (PyTorch; weights auto-downloaded to backend/.realesrgan/)
REAL_ESRGAN_MODEL_NAME = "realesrgan-x4plus-anime"
REAL_ESRGAN_ANIME_WEIGHTS_FILENAME = "RealESRGAN_x4plus_anime_6B.pth"
REAL_ESRGAN_ANIME_WEIGHTS_URL = (
    "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth"
)
REAL_ESRGAN_SCALE = 4

QUEUE_WAIT_TIMEOUT_SECONDS = 300.0
VIDEO_GENERATION_TIMEOUT_SECONDS = 1800.0  # 30 min — Wan I2V with 8 steps can take 10+ minutes
MP4_DURATION_TOLERANCE_SECONDS = 0.2

# Wan 2.2 Image-to-Video via comfy-diffusion (ComfyUI inference engine)
# https://github.com/quinteroac/comfy-diffusion
# Example: https://github.com/quinteroac/comfy-diffusion/blob/master/examples/wan_video_example.py
WAN_VIDEO_CLIP_DURATION_SECONDS = 3
WAN_VIDEO_FPS = 16.0
# Supported resolutions for Wan I2V (multiples of 8; length must be (4*n)+1 frames)
WAN_VIDEO_RESOLUTIONS: dict[str, tuple[int, int]] = {
    "16:9": (832, 480),
    "9:16": (480, 832),
    "1:1": (720, 720),
}

# Comfy-diffusion ModelManager root dir (must contain diffusion_models/, text_encoders/, vae/).
# Set WAN_COMFY_MODELS_DIR or PYCOMFY_MODELS_DIR to your models path.
WAN_COMFY_MODELS_DIR = os.environ.get("WAN_COMFY_MODELS_DIR", "") or os.environ.get("PYCOMFY_MODELS_DIR", "")
WAN_COMFY_UNET_HIGH = os.environ.get("WAN_COMFY_UNET_HIGH", "") or os.environ.get("PYCOMFY_WAN_UNET_HIGH", "")
WAN_COMFY_UNET_LOW = os.environ.get("WAN_COMFY_UNET_LOW", "") or os.environ.get("PYCOMFY_WAN_UNET_LOW", "")
WAN_COMFY_CLIP = os.environ.get("WAN_COMFY_CLIP", "") or os.environ.get("PYCOMFY_WAN_CLIP", "")
WAN_COMFY_VAE = os.environ.get("WAN_COMFY_VAE", "") or os.environ.get("PYCOMFY_WAN_VAE", "")

# Two-stage sampling: high-noise steps then low-noise (Wan 2.2)
WAN_COMFY_HIGH_STEPS = 2
WAN_COMFY_STEPS = 4
WAN_COMFY_CFG = 1.0
WAN_COMFY_SAMPLER = "euler"
WAN_COMFY_SCHEDULER = "normal"
WAN_COMFY_SAMPLING_SHIFT = 5.0
WAN_COMFY_NEGATIVE_PROMPT = (
    "blurry, low quality, distorted, static"
)
