import json

import pytest
from pydantic import ValidationError
from tests.helpers import CONTRACT_FIXTURES
from wisp_backend.api.schemas.causal_expression import CausalExpression
from wisp_backend.api.schemas.causal_memory import CausalMemoryEpisode
from wisp_backend.api.schemas.life_history import LifeSummaryEvent

CORPUS = json.loads((CONTRACT_FIXTURES / "desktop-backend-v1/causal-expression/book.json").read_bytes())


@pytest.mark.parametrize("value", CORPUS["expressions"])
def test_activity_expression(value: dict[str, object]) -> None:
    assert CausalExpression.model_validate(value).model_dump() == value


@pytest.mark.parametrize("value", CORPUS["invalidExpressions"])
def test_invalid_activity_expression(value: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        CausalExpression.model_validate(value)


@pytest.mark.parametrize("value", CORPUS["events"])
def test_book_fact_and_summary(value: dict[str, object]) -> None:
    assert CausalMemoryEpisode.model_validate(value).model_dump() == value
    summary = {key: field for key, field in value.items() if key != "kind"}
    assert LifeSummaryEvent.model_validate(summary).model_dump() == summary


@pytest.mark.parametrize("value", CORPUS["invalidEvents"])
def test_invalid_book_fact_and_summary(value: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        CausalMemoryEpisode.model_validate(value)
    with pytest.raises(ValidationError):
        LifeSummaryEvent.model_validate({key: field for key, field in value.items() if key != "kind"})
