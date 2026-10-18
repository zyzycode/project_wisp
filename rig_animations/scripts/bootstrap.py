"""Install the pinned portable editor and official MCP client; no system packages."""
import hashlib
import fcntl
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]


def download(spec, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and digest(destination) == spec["sha256"]:
        return
    # Curl resumes release assets. Raw GitHub files are small and downloaded afresh.
    command = ["curl", "-fSL", "--retry", "3", "--connect-timeout", "20"]
    if destination.suffix == ".gz":
        command += ["-C", "-"]
    subprocess.run(command + ["-o", str(destination), spec["url"]], check=True)
    if digest(destination) != spec["sha256"]:
        raise RuntimeError(f"Checksum mismatch: {destination}; do not run this download")


def digest(path):
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


def main():
    editor_lock = ROOT / ".local/workspace/.instance.lock"
    if editor_lock.exists():
        with editor_lock.open("r+b") as stream:
            try:
                fcntl.lockf(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise SystemExit("Close PSD2Live before reinstalling its files")
    lock = json.loads((ROOT / "tools.lock.json").read_text())
    archive = ROOT / ".cache" / f"PSD2Live-{lock['version']}-linux-x64.tar.gz"
    download(lock["editor"], archive)
    target = ROOT / ".tools"
    target.mkdir(exist_ok=True)
    with tarfile.open(archive) as package:
        # Verified publisher archive; prevent names escaping the install directory.
        for member in package.getmembers():
            if not (target / member.name).resolve().is_relative_to(target.resolve()):
                raise RuntimeError(f"Unsafe archive member: {member.name}")
            tarfile.data_filter(member, target)
    # GNU tar replaces read-only JRE license hardlinks correctly on a repeat install.
    subprocess.run(["tar", "-xzf", str(archive), "-C", str(target)], check=True)
    download(lock["client"], target / "client" / "mcp_proxy.py")
    print(f"PSD2Live {lock['version']} installed; both SHA-256 checks passed")


if __name__ == "__main__":
    main()
