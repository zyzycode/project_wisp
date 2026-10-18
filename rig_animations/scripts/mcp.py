"""Local CLI/stdio entry point for the verified upstream MCP client."""
import hashlib
import json
import os
from pathlib import Path
import runpy
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
CLIENT = ROOT / ".tools/client/mcp_proxy.py"


def configure():
    expected = json.loads((ROOT / "tools.lock.json").read_text())["client"]["sha256"]
    if hashlib.sha256(CLIENT.read_bytes()).hexdigest() != expected:
        raise RuntimeError("MCP client checksum mismatch; run scripts/bootstrap.py")
    pref = ROOT / ".local/home/.java/.userPrefs/io/github/psd2live/agent/prefs.xml"
    if not pref.is_file():
        raise SystemExit("Start scripts/editor.py and wait for its MCP preferences to be written")
    values = {e.attrib["key"]: e.attrib["value"] for e in ET.parse(pref).getroot()}
    token = values["agent_mcp_bearer_token"]
    port = int(values.get("agent_mcp_port", "23871"))
    os.environ["PSD2LIVE_MCP_TOKEN"] = token
    os.environ["PSD2LIVE_MCP_ENDPOINT"] = f"http://127.0.0.1:{port}/mcp"
    sys.path.insert(0, str(CLIENT.parent))


def client():
    configure()
    from mcp_proxy import Client
    return Client()


if __name__ == "__main__":
    configure()
    runpy.run_path(str(CLIENT), run_name="__main__")
