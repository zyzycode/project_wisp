from fastapi import Request
from wisp_backend.completion.service import CompletionService


def get_completion_service(request: Request) -> CompletionService:
    return request.app.state.completion_service
