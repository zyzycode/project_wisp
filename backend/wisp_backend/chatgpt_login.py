"""Interactive local OAuth login. Run: python -m wisp_backend.chatgpt_login login."""
import argparse
import asyncio
import base64
import hashlib
import secrets
import uuid
import webbrowser
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
from dotenv import dotenv_values

from wisp_backend.chatgpt_http import ChatGPTError, ISSUER, RESOURCE, TOKEN_URL, list_models, read_json
from wisp_backend.chatgpt_session import ChatGPTSession, token_record, verify_identity
from wisp_backend.chatgpt_store import SessionStore
from wisp_backend.config import ENV_FILE


def callback_values(target: str, state: str, existing_client: str | None) -> tuple[str, str]:
    url = urlsplit(target)
    if url.path != "/auth/callback" or url.scheme or url.netloc:
        raise ChatGPTError("Invalid sign-in callback.")
    params = parse_qs(url.query, max_num_fields=12)
    if any(len(values) != 1 for values in params.values()):
        raise ChatGPTError("Invalid sign-in callback.")
    if not secrets.compare_digest(params.get("state", [""])[0], state):
        raise ChatGPTError("Invalid sign-in state.")
    if "error" in params:
        raise ChatGPTError("ChatGPT sign-in was not approved.")
    client_id = params.get("client_id", [existing_client])[0]
    code = params.get("code", [""])[0]
    if not client_id or client_id == "dynamic_agent_client" or not code:
        raise ChatGPTError("ChatGPT registration is incomplete.")
    if existing_client and client_id != existing_client:
        raise ChatGPTError("Unexpected ChatGPT registration.")
    return code, client_id


async def authorize(client: httpx.AsyncClient, store: SessionStore) -> dict:
    previous = store.read()
    if not previous.get("host_id"):
        previous["host_id"] = "urn:uuid:" + str(uuid.uuid4())
        store.write(previous)
    state, nonce, verifier = (secrets.token_urlsafe(32) for _ in range(3))
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    callback: asyncio.Future[tuple[str, str]] = asyncio.get_running_loop().create_future()
    tasks: set[asyncio.Task] = set()

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        task = asyncio.current_task()
        tasks.add(task)
        try:
            header = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 5)
            first = header.decode("ascii").split("\r\n", 1)[0].split(" ")
            if len(first) != 3 or first[0] != "GET" or callback.done():
                raise ChatGPTError("Invalid sign-in callback.")
            result = callback_values(first[1], state, previous.get("client_id"))
            callback.set_result(result)
            status, message = "200 OK", "Wisp received the callback. Check the terminal to finish sign-in."
        except asyncio.CancelledError:
            writer.close()
            tasks.discard(task)
            raise
        except ChatGPTError as error:
            if str(error) == "ChatGPT sign-in was not approved." and not callback.done():
                callback.set_exception(error)
            status, message = "400 Bad Request", "Sign-in callback rejected. Check the terminal."
        except (ValueError, UnicodeError, asyncio.IncompleteReadError, asyncio.LimitOverrunError,
                asyncio.TimeoutError):
            status, message = "400 Bad Request", "Sign-in callback rejected. You may retry or cancel in the terminal."
        try:
            body = message.encode()
            writer.write((f"HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\n"
                          f"Content-Length: {len(body)}\r\nCache-Control: no-store\r\n"
                          "Referrer-Policy: no-referrer\r\nConnection: close\r\n\r\n").encode() + body)
            await writer.drain()
        except (OSError, ConnectionError):
            pass
        finally:
            writer.close()
            tasks.discard(task)

    server = await asyncio.start_server(handle, "127.0.0.1", 0, limit=8192)
    port = server.sockets[0].getsockname()[1]
    redirect = f"http://127.0.0.1:{port}/auth/callback"
    params = {"client_id": previous.get("client_id", "dynamic_agent_client"),
              "ext_agent_host_id": previous["host_id"], "response_type": "code", "redirect_uri": redirect,
              "scope": "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
              "resource": RESOURCE, "state": state, "nonce": nonce,
              "code_challenge_method": "S256", "code_challenge": challenge}
    if not previous.get("client_id"):
        params["agent_name_hint"] = "Project Wisp"
    # No ID-token hint in browser URLs or terminal output.
    try:
        if not webbrowser.open(ISSUER + "/api/accounts/authorize?" + urlencode(params)):
            raise ChatGPTError("Could not open the system browser.")
        print("Continue with ChatGPT in your browser. Waiting up to 5 minutes.", flush=True)
        code, client_id = await asyncio.wait_for(callback, 300)
    finally:
        server.close()
        await server.wait_closed()
        for task in tuple(tasks):
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    response = await read_json(client, "POST", TOKEN_URL, data={
        "grant_type": "authorization_code", "client_id": client_id, "code": code,
        "code_verifier": verifier, "redirect_uri": redirect, "resource": RESOURCE,
    })
    identity = await verify_identity(client, response.get("id_token", ""), client_id, nonce)
    if previous.get("subject") and previous["subject"] != identity["sub"]:
        raise ChatGPTError("Sign in with the previously registered ChatGPT account.")
    record = token_record(response, {**previous, "client_id": client_id, "subject": identity["sub"]})
    store.write(record)
    return record


async def run(command: str, model: str | None) -> None:
    import os
    values = {**dotenv_values(ENV_FILE), **os.environ}
    trust = str(values.get("WISP_UPSTREAM_TRUST_ENV", "false")).strip().lower()
    if trust not in {"true", "false"}:
        raise ChatGPTError("WISP_UPSTREAM_TRUST_ENV must be true or false.")
    store = SessionStore()
    with store.lease():
        async with httpx.AsyncClient(timeout=httpx.Timeout(15, connect=3), trust_env=trust == "true",
                                     follow_redirects=False) as client:
            if command == "logout":
                record = store.read()
                confirmed = False
                try:
                    if record.get("refresh_token"):
                        discovery = await read_json(client, "GET", ISSUER + "/.well-known/openid-configuration")
                        endpoint = discovery.get("revocation_endpoint")
                        if endpoint != ISSUER + "/api/accounts/oauth/revoke":
                            raise ChatGPTError("Unexpected revocation endpoint.")
                        async with client.stream("POST", endpoint, data={"token": record["refresh_token"],
                                                 "token_type_hint": "refresh_token", "client_id": record["client_id"]}) as response:
                            confirmed = response.status_code == 200
                except (httpx.HTTPError, ChatGPTError):
                    pass
                finally:
                    store.write({key: value for key, value in record.items() if key in {"client_id", "subject", "host_id", "model"}})
                print("Signed out locally. " + ("Remote revocation confirmed." if confirmed else
                      "Remote revocation not confirmed; disconnect Project Wisp in ChatGPT Settings."))
                return
            if command == "login":
                await authorize(client, store)
            session = ChatGPTSession(store, client)
            token = await session.access_token()
            models = await list_models(client, token)
            for row in models:
                print(f"{row['slug']}: {row['display_name']}")
            if model:
                if model not in {row["slug"] for row in models}:
                    raise ChatGPTError("Requested model is not available. Choose one from the catalog above.")
                session.record["model"] = model
                store.write(session.record)
                print("Saved model. ChatGPT plan connection is ready.")
            elif session.record.get("model"):
                print("Saved model:", session.record["model"])
            else:
                print("Sign-in saved. Select a model with: python -m wisp_backend.chatgpt_login models --model SLUG")


def main() -> None:
    parser = argparse.ArgumentParser(description="Connect local Wisp to your ChatGPT plan.")
    parser.add_argument("command", choices=["login", "models", "logout"])
    parser.add_argument("--model", help="Exact slug from your account's model catalog")
    args = parser.parse_args()
    try:
        asyncio.run(asyncio.wait_for(run(args.command, args.model), 360))
    except ChatGPTError as error:
        raise SystemExit(str(error)) from None
    except (httpx.HTTPError, OSError, ValueError, asyncio.TimeoutError):
        raise SystemExit("ChatGPT connection did not complete. Check network/plan access and retry; no paid fallback was used.") from None
    except KeyboardInterrupt:
        raise SystemExit("ChatGPT sign-in cancelled.") from None


if __name__ == "__main__":
    main()
