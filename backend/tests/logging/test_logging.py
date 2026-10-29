import asyncio
import io
import json
import logging

import pytest
from wisp_backend.logging import get_logger, log_context
from wisp_backend.logging.config import LoggingSettings
from wisp_backend.logging.output import configure_logging


def test_private_messages_fields_and_exceptions_are_never_rendered():
    output = io.StringIO()
    configure_logging(LoggingSettings(format="json", level="DEBUG"), output)
    logger = get_logger("wisp_backend.test_logging")
    logger.info("operation_complete", fields={"duration_ms": 12, "prompt": "PRIVATE_MARKER"})
    try:
        raise ValueError("PRIVATE_MARKER")
    except ValueError:
        logger.exception("operation_failed")
    logging.getLogger("httpx").error(
        "PRIVATE_MARKER %s", "PRIVATE_MARKER", extra={"wisp_event": {"secret": "PRIVATE_MARKER"}}
    )
    records = [json.loads(line) for line in output.getvalue().splitlines()]
    assert "PRIVATE_MARKER" not in output.getvalue()
    assert records[0]["fields"] == {"duration_ms": 12}
    assert records[1]["error"]["chain"][0]["type"] == "ValueError"
    assert records[2]["event"] == "external_log"


def test_context_isolation_cleanup_and_lazy_disabled_fields():
    output = io.StringIO()
    configure_logging(LoggingSettings(format="json"), output)
    logger = get_logger("wisp_backend.test_logging")

    async def worker():
        with log_context(operation="maintenance"):
            logger.info("operation_started")
            await asyncio.sleep(0)
            logger.info("operation_finished")

    async def scenario():
        await asyncio.gather(worker(), worker())
        with pytest.raises(asyncio.CancelledError):
            with log_context(operation="cancel"):
                raise asyncio.CancelledError
        logger.info("outside")
        logger.debug("disabled", fields=lambda: pytest.fail("evaluated disabled fields"))

    asyncio.run(scenario())
    records = [json.loads(line) for line in output.getvalue().splitlines()]
    assert records[0]["context"]["correlation_id"] != records[1]["context"]["correlation_id"]
    assert records[0]["context"] == records[2]["context"]
    assert records[-1]["context"] == {}


def test_broken_output_does_not_expose_error_or_record(capsys):
    class Broken(io.StringIO):
        def write(self, text):
            raise OSError("PRIVATE_MARKER")

    configure_logging(LoggingSettings(), Broken())
    get_logger("wisp_backend.test_logging").error("operation_failed")
    assert "PRIVATE_MARKER" not in capsys.readouterr().err


def test_levels_overrides_console_and_reinitialization():
    output = io.StringIO()
    settings = LoggingSettings(level="ERROR", overrides={"wisp_backend.example": "DEBUG"})
    first = configure_logging(settings, output)
    configure_logging(settings, output)
    assert first not in logging.getLogger().handlers
    logger = get_logger("wisp_backend.example")
    for level in (10, 20, 30, 40, 50):
        logger.log(level, "sample_event", fields={"count": 10**1000, "duration_ms": float("inf")})
    get_logger("wisp_backend.other").info("filtered_event")
    assert len(output.getvalue().splitlines()) == 5
    assert "filtered_event" not in output.getvalue()
    assert "\x1b" not in output.getvalue()
    assert len(logging.getLogger().handlers) == 1


def test_config_rejects_invalid_values_without_echoing_them():
    from wisp_backend.logging.config import logging_settings

    for values in (
        {"WISP_LOG_LEVEL": "PRIVATE_MARKER"},
        {"WISP_LOG_OVERRIDES": "PRIVATE_MARKER"},
        {"WISP_LOG_FORMAT": "PRIVATE_MARKER"},
    ):
        with pytest.raises(ValueError) as caught:
            logging_settings(values)
        assert "PRIVATE_MARKER" not in str(caught.value)


def test_http_correlation_safe_route_and_cancellation():
    from wisp_backend.api.logging import RequestLogging

    output = io.StringIO()
    configure_logging(LoggingSettings(format="json", level="DEBUG"), output)

    async def app(scope, receive, send):
        get_logger("wisp_backend.example").info("nested_operation")
        if scope["path"] == "/PRIVATE_MARKER":
            raise asyncio.CancelledError
        await send({"type": "http.response.start", "status": 200})

    async def send(message):
        pass

    async def receive():
        return {"type": "http.request"}

    async def run():
        middleware = RequestLogging(app)
        await middleware({"type": "http", "path": "/health", "method": "GET"}, receive, send)
        with pytest.raises(asyncio.CancelledError):
            await middleware({"type": "http", "path": "/PRIVATE_MARKER", "method": "GET"}, receive, send)

    asyncio.run(run())
    records = [json.loads(line) for line in output.getvalue().splitlines()]
    records = [record for record in records if record["event"] != "external_log"]
    assert len({record["context"]["correlation_id"] for record in records[:3]}) == 1
    assert records[-1]["fields"]["outcome"] == "cancelled"
    assert "PRIVATE_MARKER" not in output.getvalue()


def test_startup_failure_is_safe_before_runtime_configuration(monkeypatch):
    import wisp_backend.application as application
    from fastapi.testclient import TestClient

    output = io.StringIO()
    original = configure_logging
    monkeypatch.setattr(application, "configure_logging", lambda settings: original(settings, output))

    def failed_settings():
        raise ValueError("PRIVATE_MARKER")

    monkeypatch.setattr(application, "load_settings", failed_settings)
    with pytest.raises(ValueError):
        with TestClient(application.create_app()):
            pass
    assert "PRIVATE_MARKER" not in output.getvalue()
    records = [json.loads(line) for line in output.getvalue().splitlines() if line.startswith("{")]
    assert not records  # Default bootstrap is readable console.
    assert "application_failed" in output.getvalue()


def test_exception_chain_and_injection_are_bounded():
    output = io.StringIO()
    configure_logging(LoggingSettings(format="json"), output)
    first = RuntimeError("PRIVATE_MARKER")
    second = ValueError("PRIVATE_MARKER")
    first.__cause__ = second
    second.__cause__ = first
    logger = get_logger("wisp_backend.example")
    logger.error("safe_event", error=first)
    logger.error("bad\nPRIVATE_MARKER", fields={"operation": "PRIVATE_MARKER", "nested": {"secret": "PRIVATE_MARKER"}})
    records = [json.loads(line) for line in output.getvalue().splitlines()]
    assert len(records[0]["error"]["chain"]) == 2
    assert records[1]["event"] == "invalid_event"
    assert "PRIVATE_MARKER" not in output.getvalue()


@pytest.mark.parametrize("level", ["INFO", "OFF"])
def test_application_obeys_json_and_off_from_first_event(monkeypatch, tmp_path, level):
    import wisp_backend.application as application
    from fastapi.testclient import TestClient
    from pydantic import SecretStr
    from wisp_backend.config.settings import Settings

    output = io.StringIO()
    monkeypatch.setattr(application, "configure_logging", lambda settings: configure_logging(settings, output))
    settings = Settings(
        api_key=SecretStr("test"),
        ledger_path=tmp_path / "logs.sqlite",
        logging=LoggingSettings(format="json", level=level),
    )
    with TestClient(application.create_app(settings=settings)) as client:
        assert client.get("/health").status_code == 200
    records = [json.loads(line) for line in output.getvalue().splitlines()]
    if level == "OFF":
        assert records == []
    else:
        assert records[0]["event"] == "application_starting"
        assert records[-1]["event"] == "application_stopped"


@pytest.mark.parametrize("disconnect", [True, False])
def test_http_no_response_does_not_invent_status(disconnect):
    from wisp_backend.api.logging import RequestLogging

    output = io.StringIO()
    configure_logging(LoggingSettings(format="json"), output)

    async def app(scope, receive, send):
        await receive()

    async def receive():
        return {"type": "http.disconnect" if disconnect else "http.request"}

    async def send(message):
        pytest.fail("No response expected")

    asyncio.run(RequestLogging(app)({"type": "http", "path": "/health", "method": "GET"}, receive, send))
    record = json.loads(output.getvalue())
    assert "status_code" not in record["fields"]
    assert record["fields"]["outcome"] == ("cancelled" if disconnect else "no_response")


def test_external_levels_obey_global_off_and_parent_override():
    child = logging.getLogger("httpcore.connection")
    for level in ("OFF", "ERROR"):
        output = io.StringIO()
        configure_logging(LoggingSettings(format="json", level=level), output)
        child.warning("PRIVATE_MARKER")
        assert output.getvalue() == ""
    output = io.StringIO()
    configure_logging(LoggingSettings(format="json", level="OFF", overrides={"httpcore": "DEBUG"}), output)
    child.debug("PRIVATE_MARKER")
    assert json.loads(output.getvalue())["event"] == "external_log"
    assert "PRIVATE_MARKER" not in output.getvalue()


@pytest.mark.parametrize("level", ["INFO", "OFF"])
def test_settings_failure_obeys_early_logging_policy(monkeypatch, level):
    import wisp_backend.application as application
    from fastapi.testclient import TestClient

    output = io.StringIO()
    monkeypatch.setattr(application, "configure_logging", lambda settings: configure_logging(settings, output))
    monkeypatch.setattr(application, "load_logging_settings", lambda: LoggingSettings(format="json", level=level))

    def broken_resource():
        raise ValueError("PRIVATE_RESOURCE_MARKER")

    monkeypatch.setattr(application, "load_settings", broken_resource)
    with pytest.raises(ValueError):
        with TestClient(application.create_app()):
            pass
    records = [json.loads(line) for line in output.getvalue().splitlines()]
    assert "PRIVATE_RESOURCE_MARKER" not in output.getvalue()
    if level == "OFF":
        assert records == []
    else:
        assert records[0]["event"] == "application_failed"
