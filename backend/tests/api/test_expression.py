"""Required desktop expression is strict wire data, validated before admission."""

import json
import sqlite3
from collections.abc import Callable

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from tests.helpers import CONTRACT_FIXTURES
from wisp_backend.api.endpoints import ENDPOINTS

CASES = json.loads((CONTRACT_FIXTURES / "desktop-backend-v1/expression/invalid.json").read_text(encoding="utf-8"))[
    "requests"
]


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_expression_shared_invalid_values_are_rejected(case: dict) -> None:
    with pytest.raises(ValidationError) as error:
        ENDPOINTS[case["endpoint"]].request_type.model_validate(case["value"])
    assert all(
        item["loc"][:2] in (("character", "expression"), ("character", "synthesizedTone"))
        for item in error.value.errors()
    )


def test_missing_or_invalid_projection_never_reaches_admission_or_provider(app_factory: Callable[..., FastAPI]) -> None:
    app = app_factory(lambda _: pytest.fail("Invalid projection reached provider"))
    with TestClient(app) as client:
        for case in CASES:
            response = client.post(case["endpoint"], json=case["value"])
            assert response.status_code == 400, case["name"]
            assert response.json()["error"]["code"] == "invalid_request"
        with sqlite3.connect(app.state.completion_service.ledger.path) as db:
            assert db.execute("SELECT count(*) FROM entries").fetchone() == (0,)
