"""Free, immutable Corresponding Source offer for the running backend snapshot."""

from dataclasses import dataclass
import gzip
import hashlib
from html import escape
import io
from pathlib import Path
import tarfile

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send


router = APIRouter(tags=["source"])
ROOT = Path(__file__).resolve().parents[4]


@dataclass(frozen=True)
class SourceArchive:
    revision: str
    content: bytes


def build_source_archive(root: Path = ROOT) -> SourceArchive:
    """Allow only source paths: never recursively archive a deployment directory.

    Source-only distributions contain these paths; missing required material is
    a deployment error, so startup fails before serving a misleading source offer.
    No Git installation, network access or new runtime dependency is required.
    """
    paths = {root / name for name in (
        "backend/main.py", "backend/LICENSE", "backend/COPYING", "backend/NOTICE",
        "backend/requirements.txt", "backend/requirements-dev.txt", "backend/.env.example",
        "backend/tests/fixtures/request.local.json", "docs/PRODUCT_VISION_AND_ROADMAP.md",
        "scripts/wisp.mjs", "scripts/commands.mjs", "scripts/processes.mjs",
    )}
    for directory, pattern in (("backend/wisp_backend", "*.py"), ("backend/tests", "*.py"),
                               ("backend/docs", "*.md"), ("docs/contracts", "*.md"),
                               ("docs/contracts/fixtures", "*.json")):
        base = root / directory
        if not base.is_dir():
            raise RuntimeError("Corresponding Source unavailable")
        paths.update(base.rglob(pattern))
    lore = root / "backend/wisp_backend/completion/prompts/lore.json"
    if lore.exists():
        paths.add(lore)
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w", format=tarfile.PAX_FORMAT) as archive:
        for path in sorted(paths):
            relative = path.relative_to(root)
            if any(part.startswith(".") or part == "__pycache__" for part in relative.parts[:-1]):
                continue
            if any(parent.is_symlink() for parent in (path, *path.parents) if parent != root.parent):
                raise RuntimeError("Corresponding Source must not contain symlinks")
            try:
                data = path.read_bytes()
            except OSError:
                if path == lore:
                    continue  # Unavailable optional lore is not a source dependency.
                raise
            info = tarfile.TarInfo(relative.as_posix())
            info.size = len(data)
            info.mode = 0o644
            archive.addfile(info, io.BytesIO(data))
    content = gzip.compress(buffer.getvalue(), mtime=0)
    return SourceArchive(hashlib.sha256(content).hexdigest(), content)


class SourceOffer:
    """An outer ASGI wrapper also adds the offer to boundary errors."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        async def offer(message: Message) -> None:
            if message["type"] == "http.response.start":
                root = scope.get("root_path", "").rstrip("/")
                message = {**message, "headers": [*message.get("headers", []),
                           (b"link", f'<{root}/source>; rel="copyright"'.encode("utf-8"))]}
            await send(message)
        await self.app(scope, receive, offer)


@router.get("/source", response_class=HTMLResponse)
async def source(request: Request) -> HTMLResponse:
    snapshot: SourceArchive = request.app.state.source_archive
    archive_url = escape(str(request.url_for("source_archive", revision=snapshot.revision)), quote=True)
    return HTMLResponse(f'''<!doctype html><html lang="en"><head><title>Wisp Corresponding Source</title></head>
<body><h1>Исходный код / AGPL — Wisp backend</h1>
<p>This backend is a combined derivative program under AGPL-3.0-only.
The original MIT notice and SillyTavern attribution are preserved in LICENSE and NOTICE.</p>
<p>Free Corresponding Source of this running version:
<a href="{archive_url}">Download complete source archive</a></p>
<p>Source revision / archive SHA-256: <code>{snapshot.revision}</code>.</p>
<p>The archive includes COPYING (full AGPL), source, requirements, API contracts and install/run scripts.
From backend/: python -m pip install -r requirements.txt; set provider credentials in your environment;
python -m uvicorn main:app --host 127.0.0.1 --port 8000. See backend/docs/README.md.</p>
</body></html>''')


@router.get("/source/archive/{revision}.tar.gz", name="source_archive", include_in_schema=False)
async def source_archive(revision: str, request: Request) -> Response:
    snapshot: SourceArchive = request.app.state.source_archive
    if revision != snapshot.revision:
        raise HTTPException(status_code=404)
    return Response(snapshot.content, media_type="application/gzip", headers={
        "Content-Disposition": f'attachment; filename="wisp-backend-{revision}.tar.gz"',
        "ETag": f'"{revision}"', "Cache-Control": "public, max-age=31536000, immutable",
    })
