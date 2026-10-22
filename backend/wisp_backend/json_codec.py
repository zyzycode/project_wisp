"""Strict JSON: reject duplicate keys and non-JSON numeric constants."""

import json
from typing import NoReturn, TypeAlias, cast

JSONValue: TypeAlias = str | int | float | bool | None | list["JSONValue"] | dict[str, "JSONValue"]


def unique_object(pairs: list[tuple[str, JSONValue]]) -> dict[str, JSONValue]:
    result: dict[str, JSONValue] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def reject_constant(value: str) -> NoReturn:
    raise ValueError("Invalid JSON constant")


def decode_json(value: str) -> JSONValue:
    return cast(JSONValue, json.loads(value, object_pairs_hook=unique_object, parse_constant=reject_constant))
