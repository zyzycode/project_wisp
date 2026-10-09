"""Validated OAuth credentials; one lease owner and serialized token rotation."""
import asyncio
import secrets
import time

import httpx
import jwt

from wisp_backend.chatgpt_http import ChatGPTError, ISSUER, PLAN_SCOPE, RESOURCE, TOKEN_URL, read_json
from wisp_backend.chatgpt_store import SessionStore


async def verify_identity(client: httpx.AsyncClient, token: str, client_id: str, nonce: str | None) -> dict:
    try:
        if len(token) > 32 * 1024:
            raise ValueError
        header = jwt.get_unverified_header(token)
        if header.get("alg") != "RS256" or not isinstance(header.get("kid"), str):
            raise ValueError
        jwks = await read_json(client, "GET", ISSUER + "/.well-known/jwks.json")
        keys = [key for key in jwks["keys"] if isinstance(key, dict) and key.get("kid") == header["kid"]
                and key.get("kty") == "RSA" and key.get("use", "sig") == "sig"
                and key.get("alg", "RS256") == "RS256"]
        if len(keys) != 1:
            raise ValueError
        key = jwt.PyJWK.from_dict(keys[0], algorithm="RS256").key
        claims = jwt.decode(token, key, algorithms=["RS256"], audience=client_id, issuer=ISSUER,
                            options={"require": ["exp", "iss", "aud", "sub", "iat"]})
        if not isinstance(claims["sub"], str) or not claims["sub"]:
            raise ValueError
        if nonce is not None and (not isinstance(claims.get("nonce"), str)
                                  or not secrets.compare_digest(claims["nonce"], nonce)):
            raise ValueError
        if claims.get("azp", client_id) != client_id:
            raise ValueError
        return claims
    except (jwt.PyJWTError, ValueError, KeyError, TypeError, RecursionError):
        raise ChatGPTError("ChatGPT identity verification failed.") from None


def token_record(response: dict, previous: dict) -> dict:
    scopes = response.get("scope")
    if not isinstance(scopes, str) or not {PLAN_SCOPE, "resource.invoke"}.issubset(scopes.split()):
        raise ChatGPTError("ChatGPT plan permission was not granted.")
    if str(response.get("token_type", "")).lower() != "bearer":
        raise ChatGPTError("Invalid ChatGPT token type.")
    for field in ("access_token", "refresh_token"):
        if not isinstance(response.get(field), str) or not response[field] or len(response[field]) > 32 * 1024:
            raise ChatGPTError("Incomplete ChatGPT credentials.")
    lifetime = response.get("expires_in")
    if type(lifetime) is not int or not 0 < lifetime <= 86400:
        raise ChatGPTError("Invalid ChatGPT token expiry.")
    return {**previous, "access_token": response["access_token"], "refresh_token": response["refresh_token"],
            "scopes": scopes.split(), "expires_at": time.time() + lifetime,
            "id_token": response.get("id_token", previous.get("id_token"))}


class ChatGPTSession:
    """Caller holds store.lease() for this object's entire lifetime."""

    def __init__(self, store: SessionStore, client: httpx.AsyncClient):
        self.store = store
        self.client = client
        self.record = store.read()
        self.lock = asyncio.Lock()
        self.failed = False

    async def access_token(self) -> str:
        async with self.lock:
            if self.failed or not self.record.get("refresh_token"):
                raise ChatGPTError("Sign in with ChatGPT before starting the backend.")
            if not {PLAN_SCOPE, "resource.invoke"}.issubset(self.record.get("scopes", [])):
                raise ChatGPTError("ChatGPT plan permission is missing.")
            if self.record.get("expires_at", 0) > time.time() + 60:
                return self.record["access_token"]
            # An interrupted/ambiguous rotation must not retry the same refresh token.
            self.failed = True
            self.store.write({key: value for key, value in self.record.items()
                              if key in {"client_id", "subject", "host_id", "model"}})
            response = await read_json(self.client, "POST", TOKEN_URL, data={
                "grant_type": "refresh_token", "client_id": self.record["client_id"],
                "refresh_token": self.record["refresh_token"], "resource": RESOURCE,
            })
            replacement = token_record(response, self.record)
            if response.get("id_token"):
                identity = await verify_identity(self.client, response["id_token"], self.record["client_id"], None)
                if identity["sub"] != self.record["subject"]:
                    raise ChatGPTError("ChatGPT account changed unexpectedly.")
            self.store.write(replacement)
            self.record = replacement
            self.failed = False
            return replacement["access_token"]
