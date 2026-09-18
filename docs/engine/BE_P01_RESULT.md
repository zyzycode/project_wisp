# BE-P01 — поставка существующего backend

**TASK:** [#53](https://github.com/zyzycode/project_wisp/issues/53), 2026-09-18. Серверный код реализован в отдельном [wisp_backend](https://github.com/zyzycode/wisp_backend/tree/codex/memory-ai-mvp-20260918); ветка `codex/memory-ai-mvp-20260918`, кодовая версия `7065dd8`, HEAD с закреплёнными ссылками документации `3101c96`. Ветка опубликована, server main и deployment не менялись.

| Работа | Результат | Проверка |
|---|---|---|
| [BE-I01 #1](https://github.com/zyzycode/wisp_backend/issues/1) | `5d74958`: ledger, quota/idempotency, общий deadline, cancellation, operator rules | pip check и 122 pytest PASS |
| [BE-I02 #2](https://github.com/zyzycode/wisp_backend/issues/2) | `af21c36`: `/v2/chat`, selected memory/candidates, общий ledger namespace | pip check и 174 pytest PASS |
| [BE-I03 #3](https://github.com/zyzycode/wisp_backend/issues/3) | `7065dd8`: `/v3/events`, previousInitiative в `/v3/chat`, late replay regression | pip check и 224 pytest PASS |

**CHANGES:** исходный Python/FastAPI/httpx/Groq backend сохранён и расширен по [BE-A01](BE_A01_RESULT.md), [P15-A02](P15_A02_RESULT.md) и [P17-A04](P17_A04_RESULT.md). Каждый slice имеет отдельный commit, Issue и result в серверном `docs/`. Зависимости закреплены exact snapshot; новые runtime libraries и LLM-модели не добавлялись. Через стандартный sqlite3 добавлен служебный ledger; индивидуальная память остаётся в desktop SQLite.

**BOUNDARIES / внешний остаток:** готового live endpoint и его операторской конфигурации этой задачей не подтверждено. Для внешних тестеров оператор должен предоставить private HTTPS ingress с отзывом доступа, server-only provider credentials, проверить ZDR/retention/регион и фактический расход. До этой проверки тесты используют синтетические данные и mocked provider. Кодовая поставка не означает deployment или приёмку живого LLM. Windows вручную проверяет пользователь; независимое review временно отменено по его поручению.

**SPRITES:** none.

**VERIFICATION:** финальные backend pip check → 224 pytest PASS; diff/links/exact pins PASS. Менеджер дополнительно сравнил SHA-256 всех 12 общих fixtures v1/v2/v3 между desktop и backend: побайтовое совпадение. Продуктовые тесты менеджер не дублировал; результаты исполнителей приведены выше. Реальный provider и Windows — NOT RUN.

**RECOMMENDED NEXT GATE:** done для координации и поставки кода; операторское подключение и [Windows checklist](../WINDOWS_MVP_CHECKLIST.md) остаются явными внешними действиями владельца продукта.
