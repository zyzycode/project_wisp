"""Reviewed server-only inference profiles; no arbitrary model/URL from clients."""

from dataclasses import dataclass


@dataclass(frozen=True)
class ProviderProfile:
    base_url: str
    key_env: str
    default_model: str
    models: tuple[str, ...]
    reservation: int


PROFILES = {
    "groq": ProviderProfile(
        "https://api.groq.com/openai/v1/", "GROQ_API_KEY", "openai/gpt-oss-20b",
        ("openai/gpt-oss-20b",), 131_072,
    ),
    "gemini": ProviderProfile(
        "https://generativelanguage.googleapis.com/v1beta/", "GEMINI_API_KEY", "gemini-3.5-flash-lite",
        ("gemini-3.5-flash-lite", "gemini-3.8-flash"), 1_114_112,
    ),
}


def get_profile(provider: str) -> ProviderProfile:
    if not isinstance(provider, str) or provider not in PROFILES:
        raise ValueError("Unsupported AI provider")
    return PROFILES[provider]
