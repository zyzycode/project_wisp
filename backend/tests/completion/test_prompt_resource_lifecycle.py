"""Fresh processes verify startup and restart, without clearing production caches."""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

PACKAGE = Path(__file__).resolve().parents[2] / "wisp_backend"


def installed_copy(tmp_path: Path) -> Path:
    target = tmp_path / "wisp_backend"
    shutil.copytree(PACKAGE, target, ignore=shutil.ignore_patterns("__pycache__"))
    return target / "completion/prompts/prompt_resources.json"


def run_copy(tmp_path: Path, source: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-c", source],
        cwd=tmp_path,
        env={**os.environ, "PYTHONPATH": str(tmp_path)},
        capture_output=True,
        text=True,
        timeout=15,
        check=True,
    )


@pytest.mark.parametrize("failure", ["missing", "malformed", "invalid_utf8", "oversize", "schema"])
def test_invalid_resource_stops_startup_before_runtime_with_safe_error(tmp_path: Path, failure: str) -> None:
    path = installed_copy(tmp_path)
    if failure == "missing":
        path.unlink()
    else:
        path.write_bytes(
            {
                "malformed": b"{private-resource-text",
                "invalid_utf8": b"\xff",
                "oversize": b" " * 65537,
                "schema": b"{}",
            }[failure]
        )
    result = run_copy(
        tmp_path,
        """
import asyncio
import wisp_backend.application as application
from wisp_backend.completion.prompts.resources import PromptResourceError
def forbidden(*args, **kwargs):
    raise AssertionError('startup continued after invalid resources')
application.open_runtime = forbidden
application.load_settings = forbidden
application.load_catalogue = forbidden
async def run():
    app = application.create_app()
    try:
        async with app.router.lifespan_context(app):
            raise AssertionError('startup accepted invalid resources')
    except PromptResourceError as error:
        assert str(error) == 'prompt_resources_unavailable'
        assert error.__cause__ is None and error.__suppress_context__
        print(str(error))
asyncio.run(run())
""",
    )
    assert result.stdout == "prompt_resources_unavailable\n"
    assert result.stderr == ""


def test_snapshot_survives_file_edits_and_multiple_apps_until_process_restart(tmp_path: Path) -> None:
    path = installed_copy(tmp_path)
    result = run_copy(
        tmp_path,
        """
import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path
import wisp_backend.application as application
from wisp_backend.completion.prompts.resources import RESOURCE_PATH, get_prompt_resources
assert get_prompt_resources.cache_info().currsize == 0
@asynccontextmanager
async def runtime(*args):
    assert get_prompt_resources.cache_info().currsize == 1
    yield object()
application.open_runtime = runtime
application.load_settings = lambda: object()
async def run():
    app = application.create_app()
    async with app.router.lifespan_context(app):
        initial = get_prompt_resources()
    raw = json.loads(RESOURCE_PATH.read_text())
    raw['revision'] = 'edited-for-restart'
    raw['texts']['chat_intro'] = 'Synthetic updated intro.\\n'
    RESOURCE_PATH.write_text(json.dumps(raw))
    original_open = Path.open
    def guarded_open(self, mode='r', *args, **kwargs):
        if self == RESOURCE_PATH and 'r' in mode:
            raise AssertionError('request reread resource')
        return original_open(self, mode, *args, **kwargs)
    Path.open = guarded_open
    # source_digests deliberately reads tracked files for explicit diagnostics;
    # test runtime builders directly while guarding every resource file read.
    from wisp_backend.api.dispatch import prepare_job
    from wisp_backend.api.endpoints import ENDPOINTS
    from wisp_backend.prompt_inspection.scenes import load_scene
    route, body, lore, _ = load_scene('tired', 'en')
    for _ in range(2):
        app = application.create_app()
        async with app.router.lifespan_context(app):
            assert get_prompt_resources() is initial
            job = prepare_job(ENDPOINTS[route].request_type.model_validate(body), lore)
            assert initial.texts.chat_intro in job.inference.blocks[0].messages[0].content
            assert 'Synthetic updated intro' not in job.inference.blocks[0].messages[0].content
    print(initial.revision)
asyncio.run(run())
""",
    )
    assert result.stdout == "wisp-prompts-2\n" and result.stderr == ""
    restarted = run_copy(
        tmp_path,
        """
import asyncio
import json
from wisp_backend.prompt_inspection.report import inspect_scene
report = asyncio.run(inspect_scene('tired'))
assert report['messages'][0]['content'].startswith('Synthetic updated intro.\\n')
print(json.dumps(report['resources']))
""",
    )
    assert json.loads(restarted.stdout)["revision"] == "edited-for-restart"
    assert restarted.stderr == ""
    assert path.is_file()
