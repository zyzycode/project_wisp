"""Source coverage, precedence and final payload budget equality/overflow."""
import asyncio
import json
from dataclasses import replace
import httpx
import pytest
from tests.helpers import CONTRACT_FIXTURES
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.schemas.summary import SummaryRequest, SummaryChatRequest
from wisp_backend.completion.context import ContextOverflow, render_messages, select_context
from wisp_backend.config.settings import AssistantSettings
from wisp_backend.providers.groq import GroqProvider
from wisp_backend.providers.context_budget import estimate_input
from wisp_backend.accounting.contracts import Usage


def fixture(name, model):
    return model.model_validate(json.loads((CONTRACT_FIXTURES/'desktop-backend-v5'/name).read_bytes()))


def test_summary_all_pairs_atomic_chronological_required_and_exact_budget():
    job = prepare_job(fixture('request.summary.json', SummaryRequest))
    assert job.timeout == 10 and job.inference.max_output_tokens == 512 and job.inference.context_window == 8192
    blocks = job.inference.blocks
    assert all(block.required for block in blocks)
    sources = json.loads(render_messages(blocks)[1]['content'].split('\n', 1)[1])
    assert sources == fixture('request.summary.json', SummaryRequest).model_dump()['pairs']
    cost = lambda selection: estimate_input({'messages': render_messages(selection)}, len(render_messages(selection)))
    assert select_context(blocks, cost(blocks), cost) == blocks
    with pytest.raises(ContextOverflow): select_context(blocks, cost(blocks)-1, cost)


def test_summary_optional_below_current_facts_recent_and_initiative():
    body = fixture('request.chat-summary.json', SummaryChatRequest)
    blocks = prepare_job(body).inference.blocks
    summary = next(block for block in blocks if block.source == 'summary')
    assert (summary.priority, summary.order, summary.required) == (60, 45, False)
    required = tuple(block for block in blocks if block.required)
    cost = lambda selection: estimate_input({'messages': render_messages(selection)}, len(render_messages(selection)))
    selected = select_context(blocks, cost(required), cost)
    assert summary not in selected
    assert render_messages(selected)[-1]['content'] == body.messages[-1].content
    assert {block.key for block in required} <= {block.key for block in selected}
    assert all(block.priority > summary.priority for block in blocks if block.key.startswith('history_') or block.key == 'previous_initiative')


def test_provider_reserves512_and_rejects_whole_8192_overflow_before_http():
    async def run():
        body = fixture('request.summary.json', SummaryRequest).model_dump()
        body['pairs'] = [{'userText': '界'*240, 'assistantText': '界'*1760}] * 4
        job = prepare_job(SummaryRequest.model_validate(body))
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: pytest.fail('overflow reached provider')), base_url='https://mock.invalid') as client:
            provider = GroqProvider(client, AssistantSettings())
            result = await provider.complete(job.inference, 10)
            assert result.error == 'upstream_unavailable' and result.usage == Usage(0, 0, 0)
    asyncio.run(run())
