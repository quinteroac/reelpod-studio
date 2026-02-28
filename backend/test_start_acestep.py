from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "start-acestep.sh"


class TestStartAcestepScript:
    def test_script_exists_at_project_root(self) -> None:
        assert SCRIPT_PATH.exists()
        assert SCRIPT_PATH.is_file()

    def test_missing_env_var_exits_with_clear_error(self) -> None:
        env = os.environ.copy()
        env.pop("ACE_STEP_API_HOME", None)

        result = subprocess.run(
            [str(SCRIPT_PATH)],
            capture_output=True,
            text=True,
            env=env,
            cwd=str(REPO_ROOT),
            check=False,
        )

        assert result.returncode == 1
        assert "Error: ACE_STEP_API_HOME is not set." in result.stderr

    def test_nonexistent_directory_exits_with_clear_error(self) -> None:
        env = os.environ.copy()
        env["ACE_STEP_API_HOME"] = str(REPO_ROOT / "does-not-exist")

        result = subprocess.run(
            [str(SCRIPT_PATH)],
            capture_output=True,
            text=True,
            env=env,
            cwd=str(REPO_ROOT),
            check=False,
        )

        assert result.returncode == 1
        assert "Error: ACE_STEP_API_HOME directory does not exist:" in result.stderr

    def test_runs_uv_run_acestep_api_in_target_directory(self, tmp_path: Path) -> None:
        fake_home = tmp_path / "ace-step-api"
        fake_home.mkdir()

        fake_bin = tmp_path / "bin"
        fake_bin.mkdir()
        pwd_file = tmp_path / "pwd.txt"
        args_file = tmp_path / "args.txt"

        fake_uv = fake_bin / "uv"
        fake_uv.write_text(
            "#!/usr/bin/env bash\n"
            "set -euo pipefail\n"
            "pwd > \"${UV_PWD_FILE}\"\n"
            "printf '%s\\n' \"$@\" > \"${UV_ARGS_FILE}\"\n",
            encoding="utf-8",
        )
        fake_uv.chmod(fake_uv.stat().st_mode | stat.S_IXUSR)

        env = os.environ.copy()
        env["ACE_STEP_API_HOME"] = str(fake_home)
        env["PATH"] = f"{fake_bin}:{env.get('PATH', '')}"
        env["UV_PWD_FILE"] = str(pwd_file)
        env["UV_ARGS_FILE"] = str(args_file)

        result = subprocess.run(
            [str(SCRIPT_PATH)],
            capture_output=True,
            text=True,
            env=env,
            cwd=str(REPO_ROOT),
            check=False,
        )

        assert result.returncode == 0
        assert pwd_file.read_text(encoding="utf-8").strip() == str(fake_home)
        assert args_file.read_text(encoding="utf-8").splitlines() == ["run", "acestep-api"]

    def test_script_is_executable(self) -> None:
        mode = SCRIPT_PATH.stat().st_mode
        assert mode & stat.S_IXUSR
