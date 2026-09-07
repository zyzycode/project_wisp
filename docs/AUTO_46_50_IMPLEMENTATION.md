# Реализация AUTO-I11–AUTO-I15 (#46–#50)

Архитектурная база: [AUTO_A09_RESULT](engine/AUTO_A09_RESULT.md), принята пользователем в текущей задаче.
По указанию пользователя проверки выполнены после последовательной реализации всех пяти Issues.

| Issue | Основной коммит | Реализация |
|---|---|---|
| #46 | `f00e3be` | Запрос игры отделён от выполненной фазы; once-only игровые и Explore effects, физические последствия, ограниченный catch-up и attention/energy wake. |
| #47 | `b060e7f` | Utility после eligibility, Needs/personality/history, конечные calm-позы и игра, gait до Motion, bounded diagnostic trace. |
| #48 | `16eda8e` | Один подход на текущей опоре после dwell, пределы времени/расстояния, freshness и общий бюджет инициатив. |
| #49 | `99a2d60` | Невербальный SocialBid с конечным ожиданием, общий бюджет, session quiet через typed IPC и полный Brain snapshot. |
| #50 | `98c5326` | Main-owned offer metadata, immediate/safe-deferred admission, конечное AI ownership в общем ActivityRunner, reset/expiry и возврат локального выбора. |

Завершающий коммит этой серии содержит исправления интеграции и миграцию тестовых fixtures.
GitHub Issues не закрывались: следующий этап — независимое review и ручная desktop-приёмка.

## Проверка

- `npm run typecheck`: PASS.
- `npm test`: PASS — 629 passed, 2 skipped; 83 test files passed, 1 skipped.
- `npm run build`: PASS — Renderer, Electron Main и Preload собраны.
- `git diff --check`: PASS.
- Ручной desktop/OS smoke: NOT RUN. Unit и Main integration fixtures не подтверждают визуальную приёмку Windows/Linux.
- Тесты запускались с уже имевшимися локальными изменениями `package.json`, `vitest.config.mjs` и дополнительным тестом `activity-consequences.test.ts`; эти файлы не включены в коммиты реализации.
- Sandbox запрещал создание дочерних процессов Vitest (`spawn EPERM`); успешный прогон использовал разрешённый запуск с дочерними процессами.
- Для существующего read-only теста манифеста временный `python3.cmd` в системной temp-папке направлял вызов к установленному `C:\Python313\python.exe`. Конфигурация продукта не менялась.
- Vite выводит предупреждение о будущей смене native config loader; текущая сборка успешна.

## Детерминированные сценарии и tuning

[Сквозные тесты](../tests/main/autonomy-closed-loop.test.ts) используют настоящий CharacterStateService,
явное время, управляемый RNG и Main composition. Проверены запрос → admission → исполнение игры,
отмена до/после sprint, дедупликация по run/effect, полная цепочка Explore, quiet/attention wake,
игнорирование SocialBid без штрафа, курсорный dwell/единственный подход/stale cancellation,
AI ownership, optional nap versus full user sleep и AI timeout.

Сценарий из 200 возможностей выбора получает calm, Explore и Zoomies, изменяет Needs,
сохраняет отношения при одиночных занятиях и ограничивает trace 64 записями.
Это проверка замыкания поведения, а не оценка субъективной естественности.
[Тесты admission](../tests/application/provider-behavior-admission.test.ts) проверяют deferred start,
точную границу timeout, reset, устаревшие/некорректные offers и отсутствие повторного запуска.
[Dialogue tests](../tests/application/dialogue-runtime.test.ts) проверяют settlement metadata,
text-only responses, single-flight, offline, timeout, reset/reload и поздние результаты.

Начальный tuning: `AUTO-I12-v1`; calm 8000 ms; run = 2 × walk, crawl = 0.5 × walk.
Utility factors и положительный repetition floor находятся в
[local-activity-policy.ts](../src/domain/behavior/local-activity-policy.ts).
В пределах контракта AUTO-A09 сохранены Needs deltas и sleep/wake thresholds;
catch-up не более 60000 ms за transaction, initiative budget 2/120000 ms с интервалом 30000 ms,
курсор 6000 ms / 160 DIP, SocialBid wait 4000 ms, AI TTL/defer/run 30000/3000/20000 ms.

## Границы и графика

Domain остаётся без Electron/Node/React, Application без платформенных API;
quiet проходит точную Main-валидацию, Renderer передаёт команды через `wispAPI`.
Провайдер не управляет движением или визуальными кадрами и не создаёт второй scheduler.
Новых npm-зависимостей нет. `asset-pipeline/` и `discord_orcestrations/` не изменены.
SPRITES: `cursor_play` — временно `wave` с happy expression;
[запрос художнику](art/SPRITE_REQUESTS.md). Графика не генерировалась.

RECOMMENDED NEXT GATE: reviewer.
