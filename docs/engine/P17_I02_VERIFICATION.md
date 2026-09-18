# P17-I02 — desktop backend adapter

**TASK:** [#54](https://github.com/zyzycode/project_wisp/issues/54), 2026-09-18. Реализация по [BE-A01](BE_A01_RESULT.md), [AI Provider](AI_PROVIDER_CONTRACT.md#desktop--backend-v1) и [wire v1](BACKEND_API_CONTRACT.md). Независимое review временно исключено прямым поручением пользователя.

## Подключение

Main читает `WISP_BACKEND_URL` как доверенный base URL без `/v1/chat`, query, fragment или credentials. Для разработки допустим `http://127.0.0.1:8000`; удалённый и packaged backend требуют HTTPS. Например, в PowerShell перед обычным `npm run dev`: `$env:WISP_BACKEND_URL = "http://127.0.0.1:8000"`.

Без URL используется прежний локальный Mock без расходования сетевых counters. Некорректная конфигурация даёт локальный offline fallback и не прерывает startup/автономную жизнь. Конфигурация не доступна Renderer; provider credentials остаются на сервере. Для доступа к alpha действуют ограничения private ingress и проверки обработки данных из [wire §5–6](BACKEND_API_CONTRACT.md#5-закрытая-alpha-серверный-admission-учёт-и-повторы).

## Реализовано

- Explicit snapshot projection, последние три пары volatile context, UUID v4, ranges/plain text; самостоятельные exact response validators и общий fixture contract. Wire-valid `playful` mood опускается, остальные valid hints сохраняются; malformed decision целиком заменяется text-only response.
- Одно POST на ручную send-команду, запрет redirects/cookies, bounded UTF-8 body, abort/settlement transport deadline. Транспортные ошибки получают безопасный локальный fallback; protocol failure отклоняет promise. Локальная policy сохраняется через reset/reload.
- Main DI использует прежний DialogueRuntime, current-generation checks и Character admission. IPC channels и семантическое владение Character сохранены; Renderer показывает отдельный admission notice рядом с вводом. Persistent history в network context не подключается этой задачей.

- Session-cap notice публикуется сразу после сотой фактической отправки, до получения ответа и без 101-й команды. Completed reply сохраняется; notice не подменяет реплику, историю или Character stimulus. Cooldown expiry очищает notice; reset/reload сохраняют session cap.

## Проверка

Адресные проверки: 79 tests, включая shared fixtures, ranges, unknown keys, wrong ID/version/status, oversize stream cancellation, timeout/body stall, outage/429/cooldown, 6/min и 100/session, reset/reload/dispose/late result, no auto-retry и существующее behavior admission.

`npm run typecheck`: PASS после notice slice. Notice regressions: 46 tests PASS в 6 файлах; сначала воспроизведены 4 падения (отсутствие notice на сотой отправке/cooldown, отказ validator/publisher). Проверены actual-send publication до ответа, сохранение completed reply, reset/reload, cooldown expiry, semantic delivery и Renderer stale snapshots/no speech.

Общий финальный gate #6/#7/#8 + #54 после notice slice: `npm run typecheck` PASS, затем `npm test` — 858 PASS, 2 SKIP (108 файлов PASS, 2 SKIP); `git diff --check` PASS. `npm run build` не запускался по правилам проекта. Архитектурный blocker session-cap notice закрыт: DTO, validation, publisher и Renderer согласованы атомарно.

**NOT RUN:** реальный Windows HTTPS/offline/timeout/drag/cursor smoke и вызов живого provider. Windows-проверки пользователь выполняет вручную; для live integration нужны поставка endpoint по [#53](https://github.com/zyzycode/project_wisp/issues/53) и разрешённая конфигурация alpha; integration не объявляется принятой по mocked tests.

**BOUNDARIES:** без server runtime, SDK/секретов LLM, memory wire expansion и новых зависимостей. **SPRITES:** none. **RECOMMENDED NEXT GATE:** done для реализации; live acceptance оператором после #53, Windows acceptance пользователем. Независимое review временно отменено пользователем.

## Scope notice slice

- Application: `src/application/services/dialogue-loop.service.ts` (только admission presentation/rejection и publication после transport start; параллельные memory hooks сохранены).
- Validation: `src/shared/dialogue-ipc-validation.ts`; DTO расширен предыдущим architect gate. Publisher production code не менялся: полный dialogue уже входит в semantic signature.
- Renderer: `src/renderer/dialogue-command-client.ts`, `src/renderer/hooks/useDialogueLoop.ts`, `src/renderer/hooks/usePetDialogue.ts`, `src/renderer/components/PetOverlay.tsx`, `src/renderer/components/Chat/ChatInput.tsx`.
- Tests: `tests/application/external-dialogue-runtime.test.ts`, `tests/shared/dialogue-ipc-validation.test.ts`, `tests/main/brain-state-publisher.test.ts`, `tests/renderer/dialogue-command-client.test.tsx`, `tests/renderer/dialogue-submission-notice.test.tsx`.
