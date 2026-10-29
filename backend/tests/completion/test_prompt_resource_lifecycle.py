"""Retired style resources are neither a startup dependency nor a runtime fallback."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.mark.parametrize("retired_file", ["absent", "invalid"])
def test_startup_and_generation_do_not_load_retired_style_resources(
    app_factory, completion, monkeypatch: pytest.MonkeyPatch, retired_file: str
) -> None:
    original = Path.open

    def guarded_open(path: Path, *args, **kwargs):
        if path.name == "prompt_resources.json":
            raise AssertionError(f"Retired {retired_file} style resource must never be opened")
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", guarded_open)
    app = app_factory(lambda _: pytest.fail("Startup must not call a provider"))
    with TestClient(app):
        assert app.state.lore_catalogue is not None
        assert app.state.completion_service is not None
    prompt_dir = Path(__file__).resolve().parents[2] / "wisp_backend/completion/prompts"
    assert all(
        not (prompt_dir / name).exists()
        for name in (
            "prompt_resources.json",
            "resources.py",
            "resource_schema.py",
            "selection.py",
            "character_guidance.py",
        )
    )
