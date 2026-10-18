"""Validate an exported MOC3 with the Cubism Core bundled in PSD2Live 3.5.1."""
import ctypes
import json
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def check(path):
    jar = next((ROOT / ".tools/PSD2Live/lib/app").glob("psd2live-3.5.1-*.jar"))
    library = ROOT / ".local/liblive2d_renderer.so"
    with zipfile.ZipFile(jar) as package:
        data = package.read("cubism/linux-x86_64/liblive2d_renderer.so")
        if not library.is_file() or library.read_bytes() != data:
            library.write_bytes(data)
    core = ctypes.CDLL(str(library))
    # Same official-Core check and 64-byte alignment as upstream CubismCoreCheckTool.
    consistency = core.csmHasMocConsistency
    consistency.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    consistency.restype = ctypes.c_int
    data = Path(path).read_bytes()
    memory = ctypes.create_string_buffer(len(data) + 63)
    address = (ctypes.addressof(memory) + 63) & ~63
    ctypes.memmove(address, data, len(data))
    result = consistency(address, len(data))
    if result != 1:
        raise RuntimeError(f"Cubism Core rejected MOC3: {result}")
    return {"cubism_core_consistency":result, "moc3_bytes":len(data),
            "runtime_render_tested":False}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 scripts/check_moc3.py <exported.moc3>")
    print(json.dumps(check(Path(sys.argv[1])), indent=2))
