"""Protected local credentials and an exclusive process lease for rotating tokens."""
import ctypes
import json
import os
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from wisp_backend.chatgpt_http import ChatGPTError

DEFAULT_STORE = Path(__file__).resolve().parents[1] / "data" / "chatgpt-session.local"


def protect(data: bytes, *, decrypt: bool = False) -> bytes:
    if os.name != "nt":
        return data
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("length", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]

    buffer = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = Blob()
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    operation = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    operation.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p,
                          ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    operation.restype = wintypes.BOOL
    if not operation(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise ChatGPTError("Cannot access protected ChatGPT credentials for this OS user.")
    try:
        return ctypes.string_at(target.data, target.length)
    finally:
        kernel.LocalFree(target.data)


class SessionStore:
    def __init__(self, path: Path = DEFAULT_STORE):
        self.path = path

    @contextmanager
    def lease(self) -> Iterator[None]:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        lock_path = self.path.with_suffix(".lock")
        fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
        with os.fdopen(fd, "r+b") as lock:
            if os.fstat(lock.fileno()).st_size == 0:
                lock.write(b"0")
                lock.flush()
            lock.seek(0)
            try:
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                raise ChatGPTError("ChatGPT session is in use. Stop the backend before login/logout.") from None
            try:
                yield
            finally:
                lock.seek(0)
                if os.name == "nt":
                    msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(lock.fileno(), fcntl.LOCK_UN)

    def read(self) -> dict:
        if not self.path.exists():
            return {}
        if os.name != "nt" and self.path.stat().st_mode & 0o077:
            raise ChatGPTError("ChatGPT credentials must have owner-only permissions (0600).")
        if self.path.stat().st_size > 128 * 1024:
            raise ChatGPTError("Invalid ChatGPT credential file.")
        try:
            value = json.loads(protect(self.path.read_bytes(), decrypt=True))
            if not isinstance(value, dict):
                raise ValueError
            return value
        except (ValueError, UnicodeError, RecursionError):
            raise ChatGPTError("Invalid ChatGPT credential file.") from None

    def write(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        payload = protect(json.dumps(data).encode("utf-8"))
        fd, name = tempfile.mkstemp(dir=self.path.parent, suffix=".local")
        try:
            with os.fdopen(fd, "wb") as file:
                file.write(payload)
                file.flush()
                os.fsync(file.fileno())
            os.replace(name, self.path)
        finally:
            Path(name).unlink(missing_ok=True)
