"""Pure admission and settlement decisions; SQL owns their atomic application."""

from dataclasses import dataclass

from wisp_backend.accounting.contracts import Usage

ID_TTL = 86_400


@dataclass(frozen=True)
class Settlement:
    reserved_delta: int
    uncertain_delta: int
    confirmed_delta: int
    prompt_delta: int
    completion_delta: int
    state: str
    corrected: bool
    cacheable: bool


def plan_settlement(state: str, corrected: bool, reservation: int, usage: Usage | None) -> Settlement | None:
    if state == "confirmed" or corrected or (state == "uncertain" and usage is None):
        return None
    return Settlement(
        reserved_delta=-reservation if state == "flight" else 0,
        uncertain_delta=(0 if usage else reservation) - (reservation if state == "uncertain" else 0),
        confirmed_delta=usage.total if usage else 0,
        prompt_delta=usage.prompt if usage else 0,
        completion_delta=usage.completion if usage else 0,
        state="confirmed" if usage else "uncertain",
        corrected=state == "uncertain",
        cacheable=state == "flight" and usage is not None,
    )
