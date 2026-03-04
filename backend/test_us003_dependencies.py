from __future__ import annotations

import tomllib
from pathlib import Path


BACKEND_DIR = Path(__file__).parent


def _read_requirements() -> list[str]:
    requirements_path = BACKEND_DIR.joinpath("requirements.txt")
    lines = requirements_path.read_text(encoding="utf-8").splitlines()
    return [line.strip() for line in lines if line.strip() and not line.strip().startswith("#")]


def test_us003_ac01_dependency_file_includes_diffsynth_library() -> None:
    requirements = _read_requirements()
    assert any(requirement.startswith("diffsynth") for requirement in requirements)


def test_us003_ac02_dependency_files_exclude_diffusers_and_transformers() -> None:
    requirements = _read_requirements()
    assert not any(requirement.startswith("diffusers") for requirement in requirements)
    assert not any(requirement.startswith("transformers") for requirement in requirements)

    pyproject_path = BACKEND_DIR.joinpath("pyproject.toml")
    project = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))
    dependencies: list[str] = project["project"]["dependencies"]

    assert not any(dependency.startswith("diffusers") for dependency in dependencies)
    assert not any(dependency.startswith("transformers") for dependency in dependencies)
    assert any(dependency.startswith("diffsynth") for dependency in dependencies)
