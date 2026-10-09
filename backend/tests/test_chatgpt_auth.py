import asyncio
import json
import os
import time
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from wisp_backend.chatgpt_http import ChatGPTError, ISSUER, PLAN_SCOPE, TOKEN_URL
from wisp_backend.chatgpt_login import authorize, callback_values
from wisp_backend.chatgpt_session import ChatGPTSession, token_record, verify_identity
from wisp_backend.chatgpt_store import SessionStore
from tests.test_chatgpt import credentials


@pytest.mark.parametrize("query", ["code=c&state=wrong&client_id=oaiapp_x", "code=c&state=s",
    "code=c&state=s&client_id=dynamic_agent_client", "code=c&state=s&state=s&client_id=x",
    "error=access_denied&state=s", "code=c&state=s&client_id=other"])
def test_callback_rejects_invalid_state_registration_and_denial(query):
    with pytest.raises(ChatGPTError):
        callback_values("/auth/callback?" + query, "s", "oaiapp_expected" if "other" in query else None)


def test_callback_supports_dynamic_and_returning_registration():
    assert callback_values("/auth/callback?code=c&state=s&client_id=oaiapp_x", "s", None) == ("c", "oaiapp_x")
    assert callback_values("/auth/callback?code=c&state=s", "s", "oaiapp_x") == ("c", "oaiapp_x")


@pytest.fixture(scope="module")
def signing_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.mark.parametrize("change", [{}, {"nonce": "wrong"}, {"iss": "https://other.test"},
    {"aud": "wrong"}, {"exp": 1}, {"sub": ""}, {"azp": "wrong"}])
def test_identity_signature_and_claims(signing_key, change):
    key = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(signing_key.public_key()))
    key.update(kid="test", use="sig", alg="RS256")
    claims = {"sub": "user", "iss": ISSUER, "aud": "oaiapp_x", "exp": int(time.time()) + 300,
              "iat": int(time.time()), "nonce": "nonce", **change}
    token = jwt.encode(claims, signing_key, algorithm="RS256", headers={"kid": "test"})
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"keys": [key]}))) as client:
            return await verify_identity(client, token, "oaiapp_x", "nonce")
    if change:
        with pytest.raises(ChatGPTError):
            asyncio.run(scenario())
    else:
        assert asyncio.run(scenario())["sub"] == "user"


def test_hmac_token_is_rejected_before_jwks():
    token = jwt.encode({"sub": "attacker"}, "x" * 32, algorithm="HS256")
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: pytest.fail("Must not fetch"))) as client:
            await verify_identity(client, token, "oaiapp_x", "nonce")
    with pytest.raises(ChatGPTError):
        asyncio.run(scenario())


def test_credential_storage_and_exclusive_lease(tmp_path):
    store = SessionStore(tmp_path / "session.local")
    with store.lease():
        store.write(credentials())
        assert store.read()["access_token"] == "oauth-secret"
        with pytest.raises(ChatGPTError, match="in use"):
            with SessionStore(store.path).lease():
                pass
    if os.name == "nt":
        assert b"oauth-secret" not in store.path.read_bytes()
    else:
        assert store.path.stat().st_mode & 0o077 == 0
    with store.lease():
        pass


def test_refresh_is_serialized_and_replacement_saved(tmp_path):
    store = SessionStore(tmp_path / "session.local")
    store.write({**credentials(), "expires_at": 0})
    calls = []
    async def handler(request):
        calls.append(request)
        assert str(request.url) == TOKEN_URL
        assert b"grant_type=refresh_token" in request.content
        await asyncio.sleep(.01)
        return httpx.Response(200, json={"access_token": "new-access", "refresh_token": "new-refresh",
            "expires_in": 3600, "token_type": "Bearer", "scope": PLAN_SCOPE + " resource.invoke"})
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            session = ChatGPTSession(store, client)
            return await asyncio.gather(session.access_token(), session.access_token())
    with store.lease():
        assert asyncio.run(scenario()) == ["new-access", "new-access"]
    assert len(calls) == 1
    assert store.read()["refresh_token"] == "new-refresh"


def test_refresh_failure_does_not_retry(tmp_path):
    store = SessionStore(tmp_path / "session.local")
    store.write({**credentials(), "expires_at": 0})
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(401, text="private")
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            session = ChatGPTSession(store, client)
            for _ in range(2):
                with pytest.raises(ChatGPTError):
                    await session.access_token()
    asyncio.run(scenario())
    assert len(calls) == 1
    assert "refresh_token" not in store.read()


def test_missing_plan_scope_rejected():
    with pytest.raises(ChatGPTError, match="permission"):
        token_record({"scope": "openid"}, {})


def test_full_loopback_login_with_pkce_and_verified_identity(tmp_path, monkeypatch, signing_key):
    store = SessionStore(tmp_path / "session.local")
    params = {}
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(signing_key.public_key()))
    jwk.update(kid="test", alg="RS256", use="sig")
    callback_tasks = []

    def browser(url):
        parsed = urlsplit(url)
        assert parsed.netloc == "auth.openai.com"
        params.update({key: value[0] for key, value in parse_qs(parsed.query).items()})
        assert params["client_id"] == "dynamic_agent_client"
        assert params["agent_name_hint"] == "Project Wisp"
        assert params["code_challenge_method"] == "S256"
        async def visit():
            async with httpx.AsyncClient(trust_env=False) as browser_client:
                result = await browser_client.get(params["redirect_uri"] + "?" + urlencode({
                    "state": params["state"], "code": "test-code", "client_id": "oaiapp_test"}))
                assert result.status_code == 200
        callback_tasks.append(asyncio.create_task(visit()))
        return True

    def upstream(request):
        if request.url.path.endswith("jwks.json"):
            return httpx.Response(200, json={"keys": [jwk]})
        import base64
        import hashlib
        values = parse_qs(request.content.decode())
        verifier = values["code_verifier"][0]
        assert base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=") == params["code_challenge"]
        assert values["redirect_uri"] == [params["redirect_uri"]]
        assert values["client_id"] == ["oaiapp_test"]
        claims = {"iss": ISSUER, "sub": "user", "aud": "oaiapp_test", "nonce": params["nonce"],
                  "iat": int(time.time()), "exp": int(time.time()) + 300}
        token = jwt.encode(claims, signing_key, algorithm="RS256", headers={"kid": "test"})
        return httpx.Response(200, json={"access_token": "access", "refresh_token": "refresh",
            "id_token": token, "expires_in": 3600, "token_type": "Bearer",
            "scope": PLAN_SCOPE + " resource.invoke"})
    monkeypatch.setattr("wisp_backend.chatgpt_login.webbrowser.open", browser)
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            result = await authorize(client, store)
            await asyncio.gather(*callback_tasks)
            return result
    with store.lease():
        assert asyncio.run(scenario())["subject"] == "user"
    assert store.read()["client_id"] == "oaiapp_test"
