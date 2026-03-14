from __future__ import annotations

import subprocess
import sys
from pathlib import Path


VENDOR_DIR = Path(__file__).parent / "vendor" / "comfy-diffusion"
EXPECTED_COMMIT = "1386a33"


def test_us001_ac01_vendor_comfy_diffusion_at_v1_1_0() -> None:
    """AC01: git log shows commit 1386a33 (v1.1.0)."""
    result = subprocess.run(
        ["git", "-C", str(VENDOR_DIR), "log", "--oneline", "-1"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.strip().startswith(EXPECTED_COMMIT), (
        f"Expected HEAD to be {EXPECTED_COMMIT} but got: {result.stdout.strip()}"
    )


def test_us001_ac02_check_runtime_exits_without_error() -> None:
    """AC02: import comfy_diffusion; check_runtime() does not raise."""
    vendor_path = str(VENDOR_DIR)
    if vendor_path not in sys.path:
        sys.path.insert(0, vendor_path)

    import comfy_diffusion  # noqa: PLC0415

    result = comfy_diffusion.check_runtime()
    assert isinstance(result, dict)
