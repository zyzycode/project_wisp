# ARCHITECT RESULT — P17-A04

**TASK:** [#58](https://github.com/zyzycode/project_wisp/issues/58), 2026-09-18. Prerequisites #52/#55 приняты; code implementation #59. Независимое review временно исключено пользователем; Windows-приёмку пользователь выполняет самостоятельно.

## Decision

Добавить ровно два optional сетевых события: комментарий к реальному сохранённому завершению курсорной игры и короткую речь при уже начавшемся SocialBid. Они не создают/не продлевают Activity и возвращают только текст. Явный wire v3 оставляет v1/v2 неизменными; небольшой `/v3/chat` bridge передаёт одну предыдущую AI-фразу, чтобы ответ «да» имел контекст без поддельного user message. Общие transport/budget/current-generation gates сохраняются, а более строгая event policy и приоритет пользователя ограничивают навязчивость/стоимость.

Отдельно закрыт product acceptance: уже выученная affinity должна влиять на локальный игровой выбор. #59 подключает bounded bias existing notice chance; текущие physics/dwell/quiet/budget механики #48–#50 не переписываются. #57 отвечает за формирование/сохранение/caps, а доказательство consumption становится обязательным результатом #59.

## Layer boundaries & Contracts

- [AI_EVENTS_CONTRACT](AI_EVENTS_CONTRACT.md) — единственный canonical источник event eligibility, game commit/source dedupe, shared budgets/handoff, quiet/ignore/current lifecycle, UI/previousInitiative, v3 wire/data и learned preference consumption.
- [ai-event-provider.interface.ts](../../src/application/ports/ai-event-provider.interface.ts): semantic event provider/cancel, shared request-control extension, user interlock и additive game-commit observer. Observer согласован с разработчиком #7/#8: `append` no-op также возвращает success, поэтому once-only event dedupe обязателен по composite source key.
- [ai-provider.interface.ts](../../src/application/ports/ai-provider.interface.ts): optional previousInitiative только для v3. #56 v2 payload/response не изменяются. Memory shape берётся из принятого v2; UTF-16 budget уточнён как рекурсивная сумма string values, включая key/enum values, без JSON property names.
- [backend-events-contract.ts](../../src/application/ports/backend-events-contract.ts), [v3 fixtures](../contracts/fixtures/desktop-backend-v3/) — явные обе стороны events/chat. Backend v2 задача #2 может завершаться независимо, без чтения/реализации v3.
- [IPC DTO](../../src/shared/ipc-contracts.ts): additive optional initiativeSpeech, без нового канала/команды. [UI §6.1.1](UI_SPEC.md#611-cursor-game-v1-presentation) сохраняет приоритет текущего dialogue/local game.
- Только формы расширены в Domain `CharacterAutonomySnapshot` и `CursorObserveInput`; runtime choice policy не реализована. Existing CharacterState/preferences/snapshot schema сохраняются; Domain не импортирует Application/SQLite/provider.

## Implementation consequences

### #59 — desktop events и реальное влияние learned preference

Prerequisites #54/#56/#57; server v3 можно реализовывать параллельно. Обязательные источники: весь этот результат, [AI Events §1–7](AI_EVENTS_CONTRACT.md), [AI Provider lifecycle/admission](AI_PROVIDER_CONTRACT.md#ordering-admission-и-in-flight), [Memory §6/§9](MEMORY_ENGINE.md#6-полный-reset-и-защита-от-поздних-записей). Для Brain integration читать только Activity §16/§17 и Autonomy §12/§13, без повторной реализации #48–#50.

1. Создать Application event orchestration и Main-owned Infrastructure adapter/DI для apiVersion3/eventsEnabled. Никакой сети из Renderer/Domain. Реально существующий SocialBid start и join confirmed game commit+Activity terminal дают только разрешённые source events; actual local speech/physics не ждут provider.
2. Additive `IGameEpisodeCommitObserver` подключить к MemoryHistory после успешного append и проверки generation; identity включает appRunId/activityRunId/memoryGeneration. Отдельно сверить actual Activity completed status; stored caught после отмены не является разрешённым event. Duplicate idempotent commit не вызывает второй LLM. Не менять SQL/worker schema/способ записи game.
3. Один shared request controller расширить event sub-budget и common counter accounting; получить single HTTP slot/handoff. Accepted user turn захватывает previousInitiative, отменяет event, ждёт settlement перед собственным fetch; runtime deadline продолжает тикать. User canSubmit не зависит от одного event in-flight, остальные ограничения сохраняются. Guard failures не ставят события в очередь.
4. Causal game2s delay +2500ms latest start, social source lifetime, event3500/3000ms deadlines и current IDs проверять после каждого await. Quiet/ignore/late/error не создают реплику/намерение/fact/историю. Existing scheduler, no polling/new generic scheduler subsystem.
5. Подключить optional initiativeSpeech object/null в publisher/exact validator/preload/Renderer, сохранить действующий user/game speech priority и2s expiry. Speech не заменяет dialogue turn, не приносит Character reward и не создаёт animation-owned lifecycle. RAM previousInitiative≤60s/currentgeneration включается в один accepted v3/chat request; никаких orphan assistant rows в messages.
6. Подключить **локальный consumer preference** из §6: Main проецирует Character `activity.cursor_game` в `learnedCursorGamePreference`; cursor resolver получает gameCandidateEligible только после existing gates+dwell. Применить bias к existing noticeChance с тем же random draw. Обычный gaze, ручной play, hard eligibility/caps/game outcome не меняются; restore preference должен менять тот же выбор.
7. Регрессии/acceptance: весь список AI Events §7; особенно общий single-flight без overlap при user preemption, actual counter charge при abort, no repeat после expired/evicted source, cancelled-but-playCompleted game, ignore completed vscancelled, no extra physical reward, v1/v2 stability, memory reset after commit/request и restored +/- affinity selection.

Code gate: `npm run typecheck` → `npm test`; build запрещён. Live Groq/endpoint не блокирует code gate; common mocked fixtures проверяются обеими реализациями. Windows/manual scenarios выполняет пользователь.

### Backend #3 — events и последующий разговор v3

Отдельная задача в **существующем `wisp_backend`**, prerequisite backend #2 (v2 memory) и этот gate. Scope: `wisp_backend/api/`, отдельные v3 schemas, prompt/internal provider reply mode, service/admission deadline plumbing, common ledger path namespace, tests/fixtures/docs. Сохранить Python/FastAPI/httpx/Groq, exact dependency snapshot; новых пакетов/моделей/хранилищ не требуется.

1. Добавить `/v3/events` с event-specific strict request и **text-only** model result; output cap1024, server2500ms/body500ms. `decision`/`memoryCandidates` запрещены в model event reply; usage всё равно учитывать на invalid output. Один provider call, без extraction/retry/background scheduler.
2. Добавить `/v3/chat`, reuse v2 validation/response с version3 и optional bounded previousInitiative. Chat сохраняет привычные10s/body2s; source quote extraction ссылается только на текущий последний user text. Контекст previousInitiative не выдавать за user statement/system command.
3. Делить общий admission/rate/concurrency/daily-token ledger с v1/v2, digest включает path; cross-endpoint same ID →409 conflict. Сохранить replay/uncertain/late usage semantics BE-I01 и v2, не создавать event-specific free quota. Abort/disconnect/timeout settlement once-only.
4. Скопировать шесть v3 fixtures без изменений, сохранить v1/v2 regressions; проверить route-version/error envelope, game authoritative outcome prompt, previousInitiative provenance/caps, no user message invention, malformed/unknown output fields, deadlines/cancel/shared budget/ID conflict, usage onerror и отсутствие memory/event content в logs.
5. Документировать допустимые event/previousInitiative поля, прежние retention/ZDR/private network условия. Никакого server character memory, event scheduling, deployment или API credentials в desktop. Code gate: `python -m pip check` + `python -m pytest -q`; live credentials не используются в tests.

## VERIFICATION

**PASS:** `npm run typecheck`, локальные file links и heading anchors, лимит450 строк, consistency/byte caps шести v3 fixtures, `git diff --check`. SHA-256 всех прежних v1/v2 fixtures совпадают с принятыми gate. `npm test`/build — NOT RUN по роли; runtime/backend реализации не добавлены. Live/Windows проверки — внешние операторские/пользовательские действия, не code gate этого результата.

**CHANGES:** event canonical contract/result, additive ports/wire/IPC/Domain input types, v3 fixtures и ссылки из существующих specs. **BOUNDARIES:** без новой подсистемы/зависимости/storage migration/сети/графики/переписывания48–50. **SPRITES:** none. **RECOMMENDED NEXT GATE:** app-developer #59 и отдельный backend #3; behavioral-consumption acceptance #57 явно завершается в #59.
