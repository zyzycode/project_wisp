"""Keep the refactored execution/storage/provider boundaries independently usable."""

import ast
from pathlib import Path


def test_dependencies_point_toward_ports_and_values() -> None:
    package = Path(__file__).resolve().parents[1] / "wisp_backend"
    forbidden = {
        "accounting": ("wisp_backend.api", "wisp_backend.completion", "wisp_backend.providers", "wisp_backend.config",
                       "fastapi", "starlette", "httpx"),
        "completion": ("wisp_backend.api", "wisp_backend.providers", "wisp_backend.config",
                        "wisp_backend.accounting.sqlite_ledger", "fastapi", "starlette", "httpx", "sqlalchemy"),
        "providers": ("wisp_backend.api", "wisp_backend.completion.policies", "wisp_backend.completion.prompts",
                       "wisp_backend.completion.replies", "wisp_backend.completion.service", "sqlalchemy"),
    }
    violations = []
    for area, prefixes in forbidden.items():
        for file in (package / area).rglob("*.py"):
            for node in ast.walk(ast.parse(file.read_text(encoding="utf-8-sig"))):
                modules = ([node.module or ""] if isinstance(node, ast.ImportFrom) else
                           [name.name for name in node.names] if isinstance(node, ast.Import) else [])
                for module in modules:
                    if any(module == prefix or module.startswith(prefix + ".") for prefix in prefixes):
                        violations.append(f"{file.relative_to(package)}:{node.lineno}: {module}")
    assert not violations, "\n".join(violations)
