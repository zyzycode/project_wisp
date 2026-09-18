# P15-M04 — индивидуальная память в диалоге

**TASK:** [#56](https://github.com/zyzycode/project_wisp/issues/56), по [P15-A02](P15_A02_RESULT.md), [Memory §9](MEMORY_ENGINE.md#9-p15-a02-явные-знания-и-простой-recall), [wire v2](BACKEND_MEMORY_CONTRACT.md). Независимое review временно отменено пользователем, Windows он проверяет вручную.

## Подключение и поведение

Main использует `WISP_BACKEND_URL` и явно заданный `WISP_BACKEND_API_VERSION=2` для `/v2/chat`. Без версии используется v1; без URL — локальный Mock. Неизвестная версия даёт offline provider, автоматического probe/downgrade/retry нет. Версия и URL остаются вне Renderer. Серверная поддержка — [wisp_backend#2](https://github.com/zyzycode/wisp_backend/issues/2).

После показа terminal reply локальный recognizer разбирает текущую пользовательскую реплику. Пара сначала атомарно записывается в history; только успешный acknowledgement и текущая memory generation разрешают fact upsert. Последовательная очередь сохраняет порядок corrections. Mock/fallback допускают распознавание user text без предложений модели. Reply модели не источник; неподдержанные, временные и цитируемые формы не записываются как facts. Startup ничего не переизвлекает.

Успешный persisted `user.cursor_game` даёт once-only callback через `ICharacterPreferenceLearning`; числовые изменения Character выполняет отдельная #57. Ошибка fact write сохраняет уже показанный reply и обновляет существующий memory status. Reset/shutdown инвалидируют поздние callbacks.

Перед v2 turn recall читает максимум100 messages,100 facts и20 games за общий бюджет200ms внутри прежнего15s deadline. Этот бюджет включает ожидание очереди предыдущих append/fact writes, чтобы быстрый следующий turn не прочитал старое значение correction. Ошибка/timeout даёт пустую память; один незавершённый read group не позволяет накапливать новые группы. Late read не меняет отправленный запрос. Facts включаются независимо от запроса, registry-фразы исключаются из recalled dialogue, query tokens детерминированно выбирают максимум два эпизода. При игровом вопросе одно место получает последняя сохранённая игра; outcome/длительность передаются буквально. Storage-valid последняя игра дольше60000ms пропускается в projection, без clamp или подстановки более старой; оба места остаются dialogue matches. Character affinity при confidence≥0.5 отделён от user fact.

SQLite schema_v1 не меняется: additive game reader использует существующий rowid порядок. Полный transcript остаётся локальным; сеть получает ограниченную projection без source IDs и SQL internals. Wire validation повторяется независимо от semantic DTO; кандидаты с неправильным evidenceQuote или duplicate key удаляются, valid reply сохраняется. Все string values в memory учитываются в2400UTF-16 budget, HTTP request/response caps32/16KiB сохранены.

## Проверка

Проверены распознавание/отрицание/цитаты/temporary role, отсутствие model authority, порядок append→fact→learning, failed append/fact, once-only/late acknowledgements; actual SQLite corrected fact и game после restart, отсутствие startup re-extraction, source retention и full reset; bounded recall/ranking/volatile exclusions/200ms timeout/no backlog; runtime reset/dispose после recall; общие v1/v2 fixtures, exact shapes/source quotes/duplicate candidates/timestamps/caps, no version fallback и native worker game read.

Адресные проверки #56: 75 tests PASS в7 suites. Финальный совместный gate #56/#57: `npm run typecheck` PASS → `npm test` PASS: 934 tests passed, 2 skipped; 115 test files passed, 2 skipped. `npm run build` не запускался. Живой provider и Windows smoke NOT RUN: внешний endpoint/доступ настраивает оператор, Windows вручную проверяет пользователь; кодовые gates этим не заменяются.

## Файлы и границы

- Application: `memory-fact-registry.ts`, `memory-knowledge.ts`, `memory-recall.ts`; `memory-history.ts` post-ack hook, `memory-lifecycle.ts` knowledge lifecycle, `memory-runtime.ts` recall port binding; `dialogue-loop.service.ts` recall/volatile IDs, `dialogue-provider-result.ts` optional proposals.
- Infrastructure: `backend-memory-validation.ts`, `external-ai-provider-client.ts`; memory `protocol.ts`, `adapters.ts`, `sqlite-store.ts` additive reader без migration/writer changes.
- Main: `main-ai-provider-composition.ts` explicit version и `index.ts` recall DI. Character learning и его отдельный Main binding принадлежат #57.
- Tests: `memory-knowledge.test.ts`, `memory-recall.test.ts`, `dialogue-memory-recall.test.ts`, `knowledge-restart.test.ts`, `backend-memory-contract.test.ts`; добавлены проверки существующих worker/Main composition suites.

**BOUNDARIES:** новая библиотека, LLM на клиенте, embeddings, server profile storage и новые пользовательские IPC не вводятся. **SPRITES:** none. **RECOMMENDED NEXT GATE:** done (кодовый gate); Windows acceptance пользователем.
