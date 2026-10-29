"""Compact model-derived reply descriptions; semantic validation remains server-owned."""

import json
from functools import lru_cache
from typing import Any

from pydantic import BaseModel
from wisp_backend.completion.interaction_replies import SUPPRESSED_APPRAISAL


def _shape(node: dict[str, Any], root: dict[str, Any]) -> str:
    if "$ref" in node:
        return _shape(root["$defs"][node["$ref"].rsplit("/", 1)[1]], root)
    if "const" in node:
        return json.dumps(node["const"], ensure_ascii=False, separators=(",", ":"))
    if "enum" in node:
        return "|".join(json.dumps(value, ensure_ascii=False) for value in node["enum"])
    if "anyOf" in node:
        return "|".join(_shape(value, root) for value in node["anyOf"])
    if "x-wisp-values-by-key" in node:
        return (
            "by key{"
            + ",".join(f"{key}:{_shape(value, root)}" for key, value in node["x-wisp-values-by-key"].items())
            + "}"
        )
    if node.get("type") == "object":
        required = node.get("required", ())
        return (
            "{"
            + ",".join(
                f"{key}{'' if key in required else '?'}:{_shape(value, root)}"
                for key, value in node.get("properties", {}).items()
            )
            + "}"
        )
    if node.get("type") == "array":
        cap = f"<={node['maxItems']}" if "maxItems" in node else ""
        return f"[{_shape(node['items'], root)}]{cap}"
    if "x-wisp-utf16-max" in node:
        return f"text<={node['x-wisp-utf16-max']}"
    kind = node.get("type")
    if kind not in ("string", "number", "integer", "boolean", "null"):
        raise ValueError("Unsupported reply schema shape")
    bounds = []
    if "minimum" in node:
        bounds.append(f">={node['minimum']}")
    if "maximum" in node:
        bounds.append(f"<={node['maximum']}")
    return kind + "".join(bounds)


@lru_cache(maxsize=32)
def describe_reply(reply_type: type[BaseModel], *, exclude: tuple[str, ...] = (), suppressed: bool = False) -> str:
    schema = reply_type.model_json_schema()
    schema["properties"] = {key: value for key, value in schema["properties"].items() if key not in exclude}
    if suppressed:
        schema["properties"]["appraisal"] = {"const": SUPPRESSED_APPRAISAL}
    shape = _shape(schema, schema)
    optionality = "? means omittable, not null. " if "?" in shape else ""
    return (
        "Return only JSON "
        + shape
        + ". Only listed fields. "
        + optionality
        + "text means nonblank plain string, cap in UTF-16 units; controls only newline/tab.\n"
    )


@lru_cache(maxsize=16)
def describe_field(reply_type: type[BaseModel], field: str) -> str:
    schema = reply_type.model_json_schema()
    optional = "" if field in schema.get("required", ()) else "?"
    return f"{field}{optional}:{_shape(schema['properties'][field], schema)}"


def compact_provider_schema(reply_type: type[BaseModel]) -> dict[str, Any]:
    """Preserve the existing non-strict schema seam, excluding local UTF-16 annotations."""

    def compact(value: Any) -> Any:
        if isinstance(value, dict):
            return {
                key: compact(item)
                for key, item in value.items()
                if key not in ("title", "description") and not key.startswith("x-wisp-")
            }
        if isinstance(value, list):
            return [compact(item) for item in value]
        return value

    return compact(reply_type.model_json_schema())
