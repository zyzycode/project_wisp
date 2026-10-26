"""Local model ceilings and byte estimates; Gemini uses its countTokens API."""

import json
import re
from typing import Any

# A local safety ceiling below supported context windows, not the vendor maximum.
# Kept separate from usage reservations, wire caps, and operator configuration.
CONTEXT_WINDOWS = {
    ("openai", "gpt-4.1-mini"): 16_384,
    ("openai", "gpt-6-astra"): 16_384,
    ("openai", "gpt-6-sol"): 16_384,
    ("gemini", "gemini-3.5-flash-lite"): 16_384,
    ("gemini", "gemini-3.8-flash"): 16_384,
}


def estimate_input(payload: dict[str, Any], message_count: int) -> int:
    """One unit per encoded JSON byte, plus per-message/template safety margins.

    Counts UTF-8, escaping, roles, JSON output instructions and model settings in
    the final adapter payload. This overestimates ordinary text; it is not a
    provider tokenizer proof. Hidden framing has a 256 + 64/message allowance.
    """
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return len(encoded) + 256 + 64 * message_count


BYTE_ESTIMATE_METHOD = "UTF-8 payload JSON bytes + 256 + 64 * message count"
SOL_ESTIMATE_METHOD = (
    "sol-none empirical: ASCII letter runs <=32 ceil(n/3), Cyrillic letters n, "
    "other UTF-8 bytes; ceil(1.2 * units) + 256 + 64 * messages, capped at legacy byte estimate"
)
_WORD_RUNS = re.compile(r"[A-Za-z]+|[А-Яа-яЁё]+|[^A-Za-zА-Яа-яЁё]+")


def openai_estimate_method(model: str, reasoning_effort: object) -> str:
    return SOL_ESTIMATE_METHOD if model == "gpt-6-sol" and reasoning_effort == "none" else BYTE_ESTIMATE_METHOD


def estimate_openai_input(payload: dict[str, Any], message_count: int) -> int:
    """Empirical sol/none estimate, not an exact tokenizer or proven upper bound.

    Only the archived sol/none family was measured. Unknown models/modes retain
    the byte fallback. Unsupported scripts, digits, punctuation and ASCII letter
    runs over 32 use UTF-8 bytes. Short random ASCII words can still be undercounted;
    the 20% margin and framing are local caution, not a universal token guarantee.
    Estimate the complete final payload, never sum independently rounded blocks.
    """
    legacy = estimate_input(payload, message_count)
    if openai_estimate_method(str(payload.get("model")), payload.get("reasoning_effort")) == BYTE_ESTIMATE_METHOD:
        return legacy
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    units = 0
    for part in _WORD_RUNS.findall(text):
        if part.isascii() and part.isalpha() and len(part) <= 32:
            units += (len(part) + 2) // 3
        elif all("А" <= char <= "я" or char in "Ёё" for char in part):
            units += len(part)
        else:
            units += len(part.encode("utf-8"))
    return min(legacy, (6 * units + 4) // 5 + 256 + 64 * message_count)
