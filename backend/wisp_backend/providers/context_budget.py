"""Conservative model-profile allowance; not exact tokenization or a quota."""

import json
from typing import Any


# A local safety ceiling below supported context windows, not the vendor maximum.
# Kept separate from usage reservations, wire caps, and operator configuration.
CONTEXT_WINDOWS = {
    ("groq", "openai/gpt-oss-20b"): 16_384,
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
