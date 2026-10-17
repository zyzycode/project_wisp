"""Shared v6 corpus and strict metadata boundary, without provider calls."""

from copy import deepcopy
import json
from typing import Any

from pydantic import ValidationError
import pytest

from tests.helpers import CONTRACT_FIXTURES
from wisp_backend.api.schemas.observation import ObservationRequest, ObservationResponse, ObservationErrorResponse
from wisp_backend.outcomes import MAX_RESPONSE_BYTES


FIXTURES = CONTRACT_FIXTURES / "desktop-backend-v6"


def fixture(name: str) -> Any:
    return json.loads((FIXTURES / name).read_bytes())


@pytest.mark.parametrize("name", ["request.valid.json", "request.empty-title.json", "request.hostile-title.json"])
def test_shared_valid_request(name: str) -> None:
    value = fixture(name)
    assert ObservationRequest.model_validate(value).model_dump(exclude_unset=True) == value


def test_shared_success_and_error() -> None:
    assert ObservationResponse.model_validate(fixture("response.success.json")).model_dump() == fixture("response.success.json")
    assert ObservationErrorResponse.model_validate(fixture("response.error.json")).model_dump(exclude_unset=True) == fixture("response.error.json")


@pytest.mark.parametrize("case", fixture("invalid.json"), ids=lambda case: case["name"])
def test_shared_invalid(case: dict[str, Any]) -> None:
    if "raw" in case:
        cap = 32768 if case["kind"] == "request" else MAX_RESPONSE_BYTES
        assert len(case["raw"].encode("utf-8")) > cap
        assert json.loads(case["raw"]) == case["value"]
        return
    if case["name"] == "response-wrong-id":
        # Schema accepts UUIDv4; the transport additionally binds it to this request.
        assert ObservationResponse.model_validate(case["value"]).requestId != fixture("request.valid.json")["requestId"]
        return
    schema = ObservationRequest if case["kind"] == "request" else ObservationResponse
    with pytest.raises(ValidationError):
        schema.model_validate(case["value"])


@pytest.mark.parametrize("app_name,title", [("😀" * 40, "😀" * 80), ("é", ""), ("编辑器", "合成文档"), ("a\u200db", "a\u0301")])
def test_valid_unicode_exact_caps_are_preserved(app_name: str, title: str) -> None:
    request = fixture("request.valid.json")
    request["observation"] = {"appName": app_name, "windowTitle": title}
    parsed = ObservationRequest.model_validate(request)
    assert parsed.observation.model_dump() == request["observation"]


def test_metadata_invalid_control_at_trim_edge_cannot_be_repaired() -> None:
    request = fixture("request.valid.json")
    for field in ("appName", "windowTitle"):
        for value in ("\tvalid", "valid\n", "valid\u200f", "\ufeffvalid"):
            candidate = deepcopy(request)
            candidate["observation"][field] = value
            with pytest.raises(ValidationError):
                ObservationRequest.model_validate(candidate)


def test_response_common_text_rules_trim_after_validating_original_utf16_length() -> None:
    value = fixture("response.success.json")
    assert ObservationResponse.model_validate({**value, "text": " line\nnext\tword "}).text == "line\nnext\tword"
    assert len(ObservationResponse.model_validate({**value, "text": "😀" * 120}).text) == 120
    with pytest.raises(ValidationError):
        ObservationResponse.model_validate({**value, "text": " " + "a" * 240})
