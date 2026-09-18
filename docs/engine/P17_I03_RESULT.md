# P17-I03 — события, инициативы и локальный игровой выбор

**TASK:** [#59](https://github.com/zyzycode/project_wisp/issues/59), по [P17-A04](P17_A04_RESULT.md) и [AI Events](AI_EVENTS_CONTRACT.md). Независимое review временно отменено; ручную Windows-приёмку выполняет пользователь.

## Поведение и включение

По умолчанию сетевые события выключены. Main включает их только при одновременно заданных `WISP_BACKEND_URL`, `WISP_BACKEND_API_VERSION=3`, `WISP_AI_EVENTS_ENABLED=true`. Версия1 остаётся default; версии2/3 сохраняют явный выбор без probes/downgrade. Транспорт — тот же сервер, [backend#3](https://github.com/zyzycode/wisp_backend/issues/3). Личные credentials и live requests при разработке не использовались.

- Реальное завершение cursor game соединяется с `ActivityOutcome=completed` и подтверждением сохранения GameEpisode. Только успешный текущий источник допускает одну попытку через2s; no-op commit не повторяет вызов. Cancel после завершённой игровой фазы по-прежнему сохраняет физический результат, но не запускает AI event.
- Уже начавшийся SocialBid допускает optional AI speech после местного budget.start. AI не создаёт и не продлевает жест/игру, не обновляет Character, facts или историю. Quiet/menu/disable/P0/P1/P2/reset/dispose и поздний результат отменяют речь. Два опубликованных SocialBid без контакта при completed приостанавливают только сетевые события на30min; pet/accepted chat снимает suppression.
- Общие6/min и100/session расходуются тем же controller, что direct chat. Events ограничены2/hour, интервалом5min,10/session и резервом20 прямых сообщений; первая возможность — не раньше5min после старта Main. Нет фонового polling или event queue.
- Accepted user send захватывает предыдущую инициативу, отменяет event и ждёт завершения его HTTP promise перед собственным fetch. UI остаётся доступным; event сам по себе не выключает canSubmit. Abort не возвращает потраченный счётчик.
- `initiativeSpeech` передаётся в существующем Brain snapshot и живёт максимум2s. Renderer сохраняет приоритет dialogue/immediate game speech и не переигрывает старую реплику после expiry. Один RAM previousInitiative до60s передаётся следующему accepted `/v3/chat`; user rows не подделываются, orphan history rows не создаются.
- Выученная `activity.cursor_game` теперь влияет на существующий notice chance только для уже допустимого зрелого game candidate. Формула и прежний RNG сохранены; quiet/sleep/stale/dwell/budget нельзя обойти affinity. Факты пользователя остаются отдельны от вкуса персонажа.

## Проверки

Адресно проверены real Main game→Activity terminal→acknowledged memory→AI speech без повторного reward; real SocialBid start/quiet; idempotent/failed/late commits и cancelled-but-playCompleted; deadlines и current generation после await; shared quotas/reserve; user preemption без overlap и счётчик aborted event; suppression/contact; explicit versions/default off; все6 v3 fixtures и v1/v2 regressions; text-only/unknown fields; speech validator/publisher/Renderer; предыдущая инициатива и retired user turn при handoff.

Consumer-проверки включают six persisted like/dislike samples→SQLite checkpoint→restart→разный игровой выбор при одинаковом RNG; отсутствие/невалидное preference и confidence<0.5 сохраняют baseline. Schema_v1 и60s/5min learning gates сохранены.

Финальный `npm run typecheck` PASS → `npm test` PASS: **1003 passed, 2 skipped**,121 test files passed,2 skipped. Windows и живой provider NOT RUN — пользователь/оператор выполняют их отдельно. `npm run build` не запускался.

## Scope

Application: AIEventRuntime, общий AIRequestControl, DialogueRuntime interlock/previous context, MemoryHistory commit observer и MemoryLifecycle binding, favorite-topic recall. Infrastructure: strict v3 projections/validators и общий abortable external adapter. Main: DI, реальные start/outcome callbacks, gating, publisher/mapper; Renderer/IPC: additive initiative speech. Domain: ограниченный preference bias существующего cursor resolver.

Новых npm dependencies, подсистем, миграций, графики или серверного хранения личности нет. Existing48–50 execution/physics сохраняются. **SPRITES:** none. **RECOMMENDED NEXT GATE:** done (кодовый gate); Windows — пользователь.
