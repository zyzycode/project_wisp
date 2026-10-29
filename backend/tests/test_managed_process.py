"""Real owned child and loopback socket; synthetic key, health-only traffic."""

import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from queue import Empty, Queue
from threading import Thread

import httpx
import pytest
from tests.test_managed_auth import AUTH
from tests.test_managed_bootstrap import record

BACKEND = Path(__file__).resolve().parents[1]


def child() -> subprocess.Popen[bytes]:
    return subprocess.Popen(
        [sys.executable, "-m", "wisp_backend.managed"],
        cwd=BACKEND,
        env={"PATH": os.environ.get("PATH", ""), "SYSTEMROOT": os.environ.get("SYSTEMROOT", "")},
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def ready_line(process: subprocess.Popen[bytes]) -> bytes:
    assert process.stdout is not None
    output: Queue[bytes] = Queue(maxsize=1)
    Thread(target=lambda: output.put(process.stdout.readline(257)), daemon=True).start()
    try:
        line = output.get(timeout=8)
    except Empty:
        pytest.fail("managed child did not become ready")
    assert len(line) <= 256 and line.endswith(b"\n")
    return line


@pytest.mark.parametrize("extra_record", [False, True])
def test_ready_auth_and_bounded_eof_shutdown(tmp_path: Path, extra_record: bool) -> None:
    process = child()
    try:
        assert process.stdin is not None
        assert process.stdout is not None
        assert process.stderr is not None
        process.stdin.write(record(tmp_path))
        process.stdin.flush()
        ready = json.loads(ready_line(process))
        assert set(ready) == {"kind", "port"}
        assert ready["kind"] == "ready" and 1 <= ready["port"] <= 65535
        port = ready["port"]
        assert (tmp_path / "ledger.sqlite").is_file(), "ready must follow lifespan startup"
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", trust_env=False, timeout=1) as client:
            assert client.get("/health").status_code == 401
            assert client.get("/health", headers=AUTH).json() == {"status": "ok"}
        started = time.monotonic()
        if extra_record:
            process.stdin.write(b"{}\n")
            process.stdin.flush()
        else:
            process.stdin.close()
        assert process.wait(timeout=3) == 0
        assert time.monotonic() - started < 3
        assert process.stdout.read() == b""
        error_output = process.stderr.read()
        assert b"synthetic-openai-key" not in error_output and (b"a1" * 32) not in error_output
        with socket.socket() as probe:
            probe.settimeout(0.5)
            assert probe.connect_ex(("127.0.0.1", port)) != 0
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=3)
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream is not None:
                stream.close()


def test_rejected_bootstrap_produces_no_ready_or_secret_dump() -> None:
    process = child()
    stdout, stderr = process.communicate(
        b'{"apiKey":"private-synthetic-rejected-key","apiKey":"duplicate"}\n', timeout=5
    )
    assert process.returncode == 1
    assert stdout == b""
    assert stderr == b"Invalid managed bootstrap\n"


def test_startup_failure_exits_with_parent_pipe_still_open(tmp_path: Path) -> None:
    process = child()
    try:
        assert process.stdin is not None
        assert process.stdout is not None
        assert process.stderr is not None
        # A directory is not a SQLite file; lifespan must fail before ready.
        process.stdin.write(record(tmp_path, ledgerPath=str(tmp_path)))
        process.stdin.flush()
        assert process.wait(timeout=3) == 1
        assert process.stdout.read() == b""
        errors = process.stderr.read()
        assert b"synthetic-openai-key" not in errors and (b"a1" * 32) not in errors
        assert b"Fatal Python error" not in errors and b"Traceback" not in errors
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=3)
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream is not None:
                stream.close()
