"""Start the portable GUI with private preferences and a loopback-only MCP."""
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def main():
    pref = ROOT / ".local/home/.java/.userPrefs/io/github/psd2live/agent/prefs.xml"
    if pref.is_file():
        from mcp import client
        try:
            with client() as existing:
                existing.tools()
            print("PSD2Live MCP is already running; keeping the existing editor")
            return
        except (OSError, RuntimeError):
            pass
    executable = ROOT / ".tools/PSD2Live/bin/PSD2Live"
    if not executable.is_file():
        raise SystemExit("Run python3 scripts/bootstrap.py first")
    local = ROOT / ".local"
    local.mkdir(exist_ok=True, mode=0o700)
    local.chmod(0o700)
    home = local / "home"
    home.mkdir(exist_ok=True, mode=0o700)
    # Java properties apply only to this editor process; do not change shell HOME.
    options = [f"-Duser.home={home}", f"-Dpsd2live.agent.store={local / 'workspace'}",
               "-Djava.util.prefs.syncInterval=1"]
    env = dict(os.environ)
    env["JAVA_TOOL_OPTIONS"] = " ".join('"' + value + '"' for value in options)
    previous_umask = os.umask(0o077)
    try:
        with (local / "editor.log").open("a") as log:
            process = subprocess.Popen([str(executable), "--lang", "en"], cwd=ROOT,
                                       env=env, stdout=log, stderr=log, start_new_session=True)
        (local / "editor-process.json").write_text(json.dumps({"pid": process.pid}))
    finally:
        os.umask(previous_umask)
    print(f"PSD2Live PID {process.pid}; log: {local / 'editor.log'}")


if __name__ == "__main__":
    main()
