"""The network source offer delivers a complete immutable source snapshot."""

from collections.abc import Callable
import hashlib
import io
from pathlib import Path
import re
import tarfile

from fastapi.testclient import TestClient
import pytest

from wisp_backend.api.routes.source import ROOT, build_source_archive


def test_source_offer_archive_docs_errors_and_notices(client_factory: Callable[..., TestClient]) -> None:
    with client_factory(lambda _: pytest.fail("source offer must not call provider")) as client:
        page = client.get("/source")
        assert page.status_code == 200 and "AGPL-3.0-only" in page.text
        assert page.headers["link"] == '</source>; rel="copyright"'
        match = re.search(r'href="([^"]+/source/archive/([a-f0-9]{64})\.tar\.gz)"', page.text)
        assert match is not None
        archive = client.get(match[1])
        assert archive.status_code == 200
        assert hashlib.sha256(archive.content).hexdigest() == match[2]
        assert "immutable" in archive.headers["cache-control"]
        assert client.get(match[1]).content == archive.content
        with tarfile.open(fileobj=io.BytesIO(archive.content), mode="r:gz") as source:
            names = set(source.getnames())
            required = {"backend/main.py", "backend/wisp_backend/completion/prompts/lore.py",
                        "backend/wisp_backend/completion/prompts/lore.json", "backend/COPYING", "backend/LICENSE",
                        "backend/NOTICE", "backend/requirements.txt", "backend/requirements-dev.txt",
                        "backend/docs/README.md", "scripts/wisp.mjs", "scripts/commands.mjs", "scripts/processes.mjs",
                        "docs/contracts/BACKEND_API_CONTRACT.md",
                        "docs/contracts/fixtures/desktop-backend-v1/request.valid.json"}
            assert required <= names
            assert not any("/.venv/" in name or "__pycache__" in name or name.endswith((".env", ".sqlite", ".db"))
                           for name in names)
            for name in required:
                file = source.extractfile(name)
                assert file is not None and file.read() == (ROOT / name).read_bytes()
            notice = source.extractfile("backend/NOTICE")
            assert notice is not None
            text = notice.read().decode()
            assert all(part in text for part in ["06bde939", "337–369", "4900–4935", "4993–5007", "5056–5079"])
        assert client.get("/source/archive/unknown.tar.gz").status_code == 404
        assert client.get("/docs").status_code == 200
        assert "Исходный код / AGPL" in client.get("/openapi.json").json()["info"]["description"]
        assert client.get("/health").headers["link"] == '</source>; rel="copyright"'
        assert client.post("/v1/chat", content=b"invalid").headers["link"] == '</source>; rel="copyright"'


def test_snapshot_is_deterministic_and_ignores_runtime_files(tmp_path: Path) -> None:
    # Materialize only the already allowlisted source snapshot, not a repository copy.
    original = build_source_archive()
    with tarfile.open(fileobj=io.BytesIO(original.content), mode="r:gz") as archive:
        archive.extractall(tmp_path, filter="data")
    assert build_source_archive(tmp_path) == original
    for name in ["backend/.env", "backend/secret.sqlite", "backend/wisp_backend/runtime-data.json",
                 "backend/wisp_backend/__pycache__/private.py", "backend/.venv/private.py"]:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("PRIVATE_SECRET", encoding="utf-8")
    assert build_source_archive(tmp_path) == original
    notice = tmp_path / "backend/NOTICE"
    notice.write_text(notice.read_text() + "\nReviewed revision.\n", encoding="utf-8")
    assert build_source_archive(tmp_path).revision != original.revision
    assert b"PRIVATE_SECRET" not in original.content
    notice.unlink()
    with pytest.raises(OSError):
        build_source_archive(tmp_path)


def test_catalogue_missing_is_optional_but_symlink_source_is_rejected(tmp_path: Path) -> None:
    original = build_source_archive()
    with tarfile.open(fileobj=io.BytesIO(original.content), mode="r:gz") as archive:
        archive.extractall(tmp_path, filter="data")
    (tmp_path / "backend/wisp_backend/completion/prompts/lore.json").unlink()
    assert build_source_archive(tmp_path).content
    entry = tmp_path / "backend/main.py"
    entry.unlink()
    entry.symlink_to(ROOT / "backend/main.py")
    with pytest.raises(RuntimeError, match="symlinks"):
        build_source_archive(tmp_path)
