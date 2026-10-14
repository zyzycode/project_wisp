# OBS-A01 — ARCHITECT RESULT

**TASK:** [#67](https://github.com/zyzycode/project_wisp/issues/67), frontend + backend,
проектирование наблюдения приложений/заголовков и отдельного screen experiment.
Статус: архитектурное решение принято, реализация отсутствует. Ни API, ни UI,
ни новые порты этим docs-only изменением не включаются.

**Decision:** первый этап — явно включаемый локальный foreground observer с
allowlist и отдельным разрешением заголовков. Минимальная полезная реакция опирается
на назначенную пользователем категорию, без вывода симпатии или анализа содержимого.
Экран исследуется отдельным offline экспериментом на предоставленных synthetic
fixtures; перед выбором OCR/CV, live capture или сетью необходим следующий gate.
Это даёт проверяемый slice без передачи содержимого рабочего стола провайдеру.

**CHANGES / Layer boundaries & Contracts:**

- [Perception §11](../frontend/docs/engine/PERCEPTION_ENGINE.md#11-obs-a01-активное-приложение-и-заголовок)
  — канонические consent, settings, policy, projected observations, platform fallback,
  cadence/lifecycle, локальная реакция и retention.
- [Perception §12](../frontend/docs/engine/PERCEPTION_ENGINE.md#12-obs-a01-отдельный-эксперимент-содержимого-экрана)
  — границы эксперимента, критерии оценки и последующие dependency/capture/wire gates.
- [AI events §9](contracts/AI_EVENTS_CONTRACT.md#9-observation-boundary)
  — явная неизменность wire v1–v3: observation не маскируется под event/memory/chat.
- Планируемый Application port — `ActiveApplicationObservationPort`; owner policy и
  lifecycle — Application/Main, OS adapter — Infrastructure, eligibility — существующий
  Domain behavior, presentation/status/preview — Renderer. Объявлений типов в этой
  задаче нет; в implementation они предшествуют сервисам/адаптерам.

**BOUNDARIES:** существующий geometry adapter не начинает читать titles; курсор,
Motion и FSM не зависят от нового источника. Backend/provider не получают observation
и не требуют runtime изменений. Новая локальная speech projection отдельна от AI
events и не создаёт previousInitiative/память. Новая зависимость не одобрена;
собственный Windows helper продолжает ограничения Perception §10. Нет новых storage,
auth, topology, сетевых контрактов, графики или tooling.

**Implementation consequences:** весь этот результат и применимые разделы ниже
обязательны исполнителю; постоянные требования находятся только в canonical contracts.

### OBS-I01 — локальное наблюдение и первая реакция

Один законченный frontend slice, app-developer; **Ready после принятия #67**.
Обязательные источники: Perception §11 полностью, §10 «Dependency Review» для
helper, AI events §9, существующие frontend AGENTS и tests AGENTS.

Scope:

1. `frontend/src/application/ports/active-application-observation.port.ts`,
   `frontend/src/shared/ipc-contracts.ts` — сначала порт, policy/status/preview и
   optional `observationSpeech`; existing shared validators/mappers подключить атомарно.
2. `frontend/src/infrastructure/platform/` — observer factory, opt-in Windows helper,
   unavailable adapter для Linux/macOS; существующий config adapter сохраняет только
   policy. Не переделывать geometry observer/его протокол.
3. `frontend/src/application/`, existing `frontend/src/domain/behavior/`,
   `frontend/src/main/` — lifecycle, pure eligibility, общий budget и DI. Без новой
   Domain подсистемы, новых physics/Activity primitives или AI requests.
4. Существующий settings/menu Renderer — секция §11.1, executable picker через Main,
   назначение категории, per-app title consent, exclude/remove, pause/resume/delete,
   явный status и локальная preview; existing bubble получает lowest-priority speech.
   Никакого отдельного окна, graphics или framework. При расширении UI_SPEC обновить
   только эту секцию и ссылаться на Perception для policy; UI_SPEC — scope реализации.
5. Сфокусированные frontend tests и Windows smoke. Package/lockfile/root tooling,
   backend, asset-pipeline и внешние scopes исключены.

Приёмка: сценарий §11.3; старт off/пустой allowlist/restart paused; reject invalid IPC;
title API не вызывается без consent и при exclusion; missing title vs corrupt envelope;
native metadata не выходят из adapter; foreground race, gap/TTL и deadlines;
revocation/lock/suspend/reset/dispose до/после каждого await; malformed/late helper output;
budget/speech priority/10-min guard; повторяемый результат при backend outage; никакой
записи observation/новых facts/preferences/HTTP. Windows smoke: доступное editor окно,
переключение/закрытие, Add-Type denied, доступ к процессу запрещён, helper shutdown,
пауза и resume; non-Windows fallback без остановки текущих механик.
Developer gates: `node scripts/wisp.mjs typecheck`, затем
`node scripts/wisp.mjs test:frontend`; build запрещён. Реальные экраны не захватывать.

### OBS-X01 — дизайн offline screen experiment

Следующий отдельный architect этап, **не implementation issue текущего slice**.
Обязательные источники: Perception §12 и AI events §9.
Scope: список вопросов/labels, dataset manifest и split только для готовых
предоставленных человеком synthetic fixtures, baseline, протокол подсчёта quality,
latency/RAM/cost и сравнение вариантов. Если fixtures не предоставлены — обозначить
это как blocker эмпирической оценки, не создавать изображения агентом.
Итог: go/no-go для отдельного dependency/прототипного gate; без реального capture,
provider calls, downloads/packages или обещания качества по неизмеренным данным.
Remote analysis требует отдельного architect результата с обеими сторонами wire;
его endpoint/DTO/auth/provider/цена сейчас **не выбраны** и не разрешены к реализации.

**SPRITES:** none.

**VERIFICATION:** 44 локальные Markdown ссылки/anchors, согласованность с port/wire
ownership, лимит 450 строк и `git diff --check` — PASS. Исправлена устаревшая ссылка
Ownership внутри изменённой Perception specification на действующий раздел индекса.
Typecheck и продуктовые тесты **NOT RUN**: изменена только документация, новых
types/schemas нет. Runtime Windows smoke/эксперимент **NOT RUN**: будущие задачи.

**RECOMMENDED NEXT GATE:** `done` для #67; OBS-I01 → app-developer.
OBS-X01 → отдельный architect, без блокировки первого локального этапа.
