from __future__ import annotations

from pathlib import Path


PROJECT_CONTEXT_PATH = Path(__file__).parent.parent.joinpath(".agents", "PROJECT_CONTEXT.md")


def _read_project_context() -> str:
    return PROJECT_CONTEXT_PATH.read_text(encoding="utf-8")


def test_us005_ac01_product_architecture_documents_three_layer_backend() -> None:
    source = _read_project_context()
    assert "Backend layering:" in source
    assert "`backend/routes/` handles HTTP transport + exception mapping" in source
    assert "`backend/services/` owns business logic/orchestration" in source
    assert "`backend/repositories/` performs external I/O" in source


def test_us005_ac02_modular_structure_lists_backend_layer_directories() -> None:
    source = _read_project_context()
    assert "- `backend/routes/`:" in source
    assert "- `backend/services/`:" in source
    assert "- `backend/repositories/`:" in source


def test_us005_ac03_main_py_is_documented_as_composition_root_not_monolith() -> None:
    source = _read_project_context()
    assert (
        "- `backend/main.py`: backend composition root — creates FastAPI app, registers routers/handlers, and wires startup/shutdown lifecycle hooks"
        in source
    )
    assert "FastAPI app; `POST /api/generate` handler; communicates with ACEStep via HTTP submit/poll" not in source
