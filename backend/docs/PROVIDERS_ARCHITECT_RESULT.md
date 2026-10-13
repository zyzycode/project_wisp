# Переключаемые AI-провайдеры — ARCHITECT RESULT

**TASK:** запрос пользователя от 2026-10-13: согласовать и реализовать переключение Groq / Google AI Studio.

**Decision:** один активный провайдер на процесс, выбираемый оператором при startup. Существующий `Provider` остаётся внутренним портом; composition создаёт Groq либо Gemini adapter через имеющийся httpx. Gemini использует native generateContent: роли, JSON output и usage (включая thoughts) преобразуются явно. Реестр проверенных моделей хранит defaults и reservation; произвольная модель из environment не разрешается. По последующему запросу пользователя эксплуатационные параметры доступны отдельными env variables; URL задаёт только оператор, с HTTPS либо loopback HTTP, без credentials/query/fragment. Это явный выбор получателя ключа и контекста, требующий тех же data-policy условий, что provider.

**Alternatives:** OpenAI compatibility уменьшает различия payload, но добавляет промежуточное преобразование Gemini usage. Автоматический fallback между поставщиками отклонён: он меняет получателя данных и может повторно расходовать токены. Универсальный plugin framework не нужен для двух адаптеров.

**Layer boundaries & Contracts:** сервер владеет выбором модели, credentials, HTTP lifecycle и accounting. Канонические правила — [Backend API §5–6](../../docs/contracts/BACKEND_API_CONTRACT.md#5-закрытая-alpha-серверный-admission-учёт-и-повторы); внутренние типы — [Provider](../wisp_backend/providers/base.py), [Usage/ProviderResult](../wisp_backend/contracts.py). Wire v1/v2/v3 и desktop не изменяются. Новых зависимостей и нового storage нет; существующий ledger получает reservation каждой записи с совместимой миграцией.

**Implementation consequences:**

1. `config.py`, каталог профилей в `providers/`, `application.py`, `upstream.py`: выбор `WISP_AI_PROVIDER`, optional `WISP_AI_MODEL`, изолированные ключи; Groq остаётся default. Legacy ASSISTANTS_JSON сохраняется, конфликтующие настройки отклоняются. Выбор действует после restart.
2. Gemini adapter и общая bounded HTTP/JSON validation: все пять endpoints, safe errors, один вызов, no retry/redirect, cancellation и закрытие ресурсов. Не менять prompts или wire validation ради конкретной модели.
3. `ledger.py`: reservation сохраняется при admission; recovery/settlement используют значение записи. Старые записи мигрируют с 131072. Переключение не очищает budgets, halt или namespace requestId. Default daily cap Gemini — 2000000; явный cap ниже reservation отклоняется при startup.
4. `.env.example`, OPERATIONS и канонические provider-specific положения memory/events: инструкция переключения и условия передачи данных. Правила Gemini не приравниваются к Groq ZDR; новая интеграция разрешена для синтетических данных, внешние пользовательские данные требуют operator gate §6.
5. Mocked tests: конфигурация/ключи, все wire versions, usage при invalid output, outage/auth/timeout/oversize, cancellation/late result, миграция и restart при смене профиля. Затем backend check → tests. Реальные provider calls не входят в задачу.
6. Пользователь отдельно разрешил `scripts/commands.mjs` и его тест: добавить новый ключ и server profile variables в фильтр окружения desktop. Проверить сначала регрессионный тест, затем tooling suite; desktop runtime не меняется.
7. Последующее поручение: provider/model/keys, base URL, output cap, temperature, Gemini thinking level и HTTP timeouts читаются из `backend/.env`/process environment с проверкой диапазонов. Пустые optional значения используют defaults; конфликт с ASSISTANTS_JSON отклоняется. Дополнить локальный ignored `.env`, сохранив секреты и действующие значения без вывода. TLS verification, no retry/redirect, wire caps, deadlines и reservation не отключаются env.

**CHANGES:** принято решение и обновлены канонические серверные правила.
**BOUNDARIES:** backend runtime/config/tests, связанная документация и явно разрешённый фильтр server secrets в root launcher; без dependencies, desktop runtime, публичного deployment и изменения секретов.
**SPRITES:** none.
**VERIFICATION:** архитектурный этап — документация и первичные API/model/data-policy источники проверены; продуктовые тесты выполняются на этапе app-developer.
**RECOMMENDED NEXT GATE:** done для архитектуры; app-developer реализует последствия выше по прямому поручению пользователя в этом чате.
