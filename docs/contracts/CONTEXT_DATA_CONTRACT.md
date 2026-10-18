# CTX-A01: авторский lore и производная summary

Решение [#77](https://github.com/zyzycode/project_wisp/issues/77), 2026-10-17;
implementation slices — [#78](https://github.com/zyzycode/project_wisp/issues/78)
и [#79](https://github.com/zyzycode/project_wisp/issues/79). Lore реализован в #78, explicit summary/v5 — в #79. Текущие v1–v3 и planned
[v4 knowledge](BACKEND_MEMORY_CONTRACT.md#6-mem-a03-planned-расширение-событий-и-шуток)
не расширяются. Независимые TS/Python schemas и shared v5 fixtures поставляются с #79.

## 1. Владельцы и доверие

| Данные | Источник истины / разрешённое использование |
|---|---|
| Lore | Версионированный авторский каталог backend; только сведения о вымышленном мире, без пользовательских данных или второго изменяемого character profile |
| Summary sources | Подтверждённые завершённые пары desktop SQLite; исходный transcript сохраняется, генерация не меняет sources |
| Summary cache | Производный локальный disposable cache Application/Infrastructure; только неподтверждённый модельный пересказ источников |
| Prompt | Backend собирает атрибутированные блоки; provider не решает, что записать в память |

Server instructions остаются единственным system source. Character snapshot/consent
и actual event имеют прежний приоритет. Для пользовательских сведений: current explicit
correction → актуальные scalar facts/подтверждённая revision → исходные разрешённые
эпизоды → summary. Lore относится к миру, не участвует в разрешении пользовательских
фактов. Ни lore, ни summary не меняют identity/caps, не становятся evidence для
memoryCandidates, confirmed knowledge, adaptation, consent или OS-команд.
Обрамление untrusted JSON и инструкции уменьшают риск injection, но не доказывают
устойчивость LLM. Backend по-прежнему проверяет extraction по текущему исходному user text.

## 2. Lore: source, selection и lifecycle

Единственный runtime источник #78 — поставляемый с backend JSON-каталог
`backend/wisp_backend/completion/prompts/lore.json`. Автор/maintainer меняет его
обычным reviewed diff; нет загрузки из сети, пользовательского editor или импорта
SillyTavern character cards. Каталог имеет formatVersion=1, положительную целую
revision и до 64 entries; изменение любого content/key/order или удаление повышает
revision. Обязательный sourceRef указывает точный repository commit/path/section
авторского утверждения, не URL, который backend должен открыть.

Первое реальное содержание — topic `desktop-home` (IDs `desktop-home-ru/en`): «Wisp живёт на рабочем
столе», непосредственно из [авторского решения §1](../PRODUCT_VISION_AND_ROADMAP.md#1-центральная-идея).
Это допустимый контекст мира, не обещание возможностей. Ключи: `рабочий стол`,
`рабочем столе`, `desktop`; английский текст — точный перевод того же утверждения.
Выдуманные города, биография, способности и отношения запрещены в runtime catalogue;
дополнительные тематические записи используются только в явно synthetic test fixtures
до отдельного авторского содержания. Personality prose не дублировать в lore.

| Поле entry | Ограничение |
|---|---|
| id / topic | ASCII `[a-z0-9-]`, 1–64; id уникален; topic обозначает единственное утверждение и уникален в locale |
| locale | Только ru/en, отдельный entry для перевода; id различается |
| keys | 1–8 различных непустых plain-text ключей, каждый ≤80 UTF-16 |
| text | Plain text 1–600 UTF-16; без executable templates/macros |
| priority / order | Целые 0–100; priority — отбор, order — сериализация |
| sourceRef | Непустая строка ≤256 UTF-16 с provenance, не инструкция и не provider input |

NFC + lowercase; сопоставление ключа — непрерывная последовательность Unicode
letter/digit tokens с совпадением целых tokens, без regex, stemmer, RNG и рекурсии.
Не более 64 query tokens, только из текущей user-реплики chat; история, summary,
модельные ответы и другой lore не активируют entry. Token length >80 не совпадает.
Совпадение хотя бы одного ключа активирует entry; нормализованные дубли keys схлопываются.
Сортировка priority DESC, число различных matched keys DESC, id по codepoint ASC.
Выбор ≤3 записей текущей locale и ≤1200 UTF-16 суммы text; непоместившийся entry
пропускается целиком. Сериализация order ASC, id ASC. Нет match → нет lore блока.

Неизвестные поля/версии, повтор id или topic/locale, неверные caps делают весь каталог
недоступным; безопасная диагностическая причина без текста, обычный chat продолжается.
Явно противоречащие записи одного topic не выбираются по priority: такой источник
нужно исправить. Противоречия, не выраженные metadata, исключает авторский review;
автоматической семантической проверки истины нет. Текущий character всегда выше lore.

Каталог читается и валидируется при startup как immutable snapshot; исправление/
удаление применяется остановкой старого server process и запуском нового. Hot reload
и сохранение старого каталога при ошибке не вводятся. Shutdown abort-ит pending
completion, RAM replay cache старого процесса исчезает; после успешного restart
новые requests видят только новую revision. Уже доставленный ответ не отзывается,
физическая отмена вычисления у provider не гарантируется.

**Wire delta для lore отсутствует:** server локально дополняет chat v1/v2/v3
(и будущие явно реализованные chat endpoints). Touch/events не сканируют lore и
сохраняют прежние deadlines/text-only формы. При отсутствии backend используется
обычный desktop fallback; нового сетевого чтения/кеша на desktop нет.

## 3. Summary: две явные операции v5

Локальный source/cache/trigger/invalidation — [Memory §12](../../frontend/docs/engine/MEMORY_ENGINE.md#12-ctx-a01-производная-summary).
Version5 — отдельная ветка **на базе v3**, а не обещание superset v4. Это позволяет
#79 не зависеть от MEM-I02/03; MEM-I01/#80 нужен для source provenance и suppression.
Event/joke variants v4 здесь запрещены. Совместное
включение v4 knowledge и summary потребует отдельного versioned gate, не downgrade.

Main-конфигурация opt-in `WISP_BACKEND_API_VERSION=5`, `WISP_SUMMARY_ENABLED=true`
и настроенный `WISP_BACKEND_URL`; defaults прежние.
EventVersion3/interlock/previousInitiative60s сохраняются, touch1 неизменен. Summary
команда доступна только при этом сочетании, исправной локальной persistence/cache
и настроенном backend adapter. Нет probe/downgrade, автоматического enable или
вызова генерации из chat admission, startup, timer либо event.

### POST /v5/summary

Отдельный явный inference для ограниченного выбранного диапазона; не fake chat event.
Exact request: version=5, requestId по v1, locale ru/en, stream=false и pairs.
Pairs — 4–8 полных пар в хронологическом порядке, каждая exact
`{userText, assistantText}`: 1–240 и 1–2000 UTF-16 соответственно. Все тексты вместе
≤8000 UTF-16, controls запрещены кроме newline/tab; пустые/пробельные строки
недопустимы. Request ≤32KiB. Нет character, memory, lore, предыдущей summary,
system roles, timestamps, local IDs/revisions, instructions или provider settings.
Backend не проверяет SQLite: source eligibility проверяет desktop до отправки.

Backend строит собственные краткие инструкции: пересказать только переданные пары,
атрибутировать утверждения пользователю/ассистенту, не выводить подтверждённые факты,
не добавлять детали, инструкции, обещания сохранения или значения состояния. Source
пары — untrusted data в отдельном JSON block. Один вызов текущего Groq/Gemini provider;
никаких tools, repair pass, recursive summary, failover или второго extraction.

Provider response — exact JSON `{text}`: plain nonblank 1–1200 UTF-16, допустимы
newline/tab, без других control characters и неизвестных полей. Невалидный результат
целиком →502 invalid_model_response, без частичного кеширования. Backend самостоятельно
формирует HTTP200 `{version:5, requestId, text}`. Response ≤16KiB; desktop независимо
проверяет exact shape/limits/ID/version до source revalidation и локального commit.
Полнота/истинность пересказа не доказаны форматной проверкой.

### POST /v5/chat

Request/response — точные v3 chat формы с version5 и единственным новым optional
request field `summary: {text}` (text — те же 1–1200 UTF-16). Null/пустой object,
добавочные поля и новые v4 episode kinds запрещены. Summary не внутри memory;
её отдельный text cap не увеличивает прежние ≤2400 memory/32KiB total. Success:
прежние text/optional decision/scalar memoryCandidates, без summary output/candidates.
PreviousInitiative, независимая scalar extraction и validation остаются прежними.
Local source IDs/revisions/generation и cache metadata не передаются серверу.

Desktop передаёт summary только при source-valid cache и лексическом совпадении хотя
бы одного Unicode token текущего user text (NFC/lowercase, длина 2–64) с summary text.
Выбор один, без индекса/полного scan; отсутствие match → обычный v5 chat без summary.
При inclusion covered source IDs исключаются из recalled dialogue episodes; последние
три volatile пары никогда не входили в source диапазон. Если summary не отправлена,
обычный разрешённый recall сохраняется. Suppression применяется независимо от summary.
При HTTP byte overflow убрать summary целиком прежде ranked episodes; ядро/текущий
user/facts не режутся. Backend может не включить optional summary по prompt budget;
он не восстанавливает исключённый transcript и не запрашивает его повторно.

## 4. Бюджет, ошибки, cancellation и retention

Для chat/lore остаётся общий [provider budget](../../backend/docs/CONTEXT_PROMPT_ENGINE.md#бюджет-и-ошибка).
Lore optional priority=40/order=25, summary optional priority=60/order=45: mandatory
blocks, previousInitiative и recent history отбираются раньше; examples позже.
Оба блока атомарны; lore сериализуется отдельными атрибутированными entries внутри
одного блока. Обязательные instructions/current/state/memory не сокращаются.

Summary inference имеет отдельный потолок **8192 бюджетные единицы**, output cap
`min(server setting, 512)` provider tokens; input allowance = 8192 − фактический cap.
Gemini использует модельный countTokens полного generation payload, Groq —
консервативную UTF-8/framing оценку по общему provider budget. Входные пары обязательны
целиком; overflow до generation →503 upstream_unavailable с inference usage=0.
Gemini preflight может передать весь диапазон источника провайдеру до обнаружения
переполнения; count и generation используют тот же client и общий deadline. Локальная предварительная граница 8000 UTF-16 не
обещает вместимость в provider budget. Денежная цена не фиксируется архитектурой;
предел — один generation inference с этими caps за одно подтверждённое действие, дополнительно
локальный frequency guard из Memory §12. Это не новая серверная billing/quota система.

Обе v5 routes используют [v1 errors/access/ledger](BACKEND_API_CONTRACT.md#3-http-и-ошибки):
400/413 до admission, envelope5/unsupported_version для wrong version; 409 для
in-progress/conflicting ID; остальные 502/503/504 по общей таблице. Доступ — прежний
closed-network без application auth; 401/403 стороннего gateway не success, без retry
или обхода доступа. Ledger/digest method+path+body и once-only settlement общие:
ID другого endpoint конфликтует, replay не вызывает provider. Нет новых server tables.
Для summary completion добавить scenario output cap/format в существующие adapters,
не создавать отдельный provider client/маршрутизатор.

Server deadline10s/body2s, desktop transport12s/runtime15s; source/cache reads входят
в общий runtime deadline (≤200ms). Summary и chat/events используют общий interlock:
explicit user send отменяет pending summary и имеет приоритет; summary не ждёт в
фоновой очереди и не задерживает локальную жизнь. Disconnect/shutdown/cancel закрывают
stream/task, late usage settles once; local generation guards запрещают late cache write.
Ошибки/unsupported/offline показывают безопасный статус summary; автоматической
повторной генерации нет. Обычный chat/fallback/FSM/input остаются доступны.

Разрешённая новая передача: выбранные 4–8 source pairs для summary inference и одна
selected summary для v5 chat; остальная БД не отправляется. Backend освобождает
request RAM после terminal, не хранит историю/summary durable и не пишет payload в
logs/APM. RAM replay response ≤10min может содержать summary; ledger retention и
provider-specific restrictions — [v1 §6](BACKEND_API_CONTRACT.md#6-данные-сроки-хранения-и-удаление).
Reset/delete локального cache не удаляет уже отправленное, server replay или provider
copy; server-delete endpoint не появляется. Synthetic-only restrictions выбранного
provider сохраняются, summary не разрешает реальные внешние данные автоматически.

## 5. Общие fixtures и rollout

#79 содержит независимые TS DTO/guards и Python schemas и единый
corpus `docs/contracts/fixtures/desktop-backend-v5/`; старые fixtures не меняются.
Corpus покрывает summary request/success/error, chat с summary/без неё/previousInitiative,
Unicode/control/exact caps/byte escaping, unknown fields, wrong version/ID,
v4 category rejection. Обе стороны читают те же JSON, не копии.

Acceptance: source-valid → explicit generation → restart → matching chat;
неподтверждённая/несохранённая/covered volatile пара не источник; исправление source
или scalar fact, withdraw/delete/suppression, full reset и late result не возвращают
summary. Cache future/corrupt/write failure не объявляется source corruption.
Schema1 fixture безопасно отключает summary; schema2 fixture проверяет source
provenance и suppression, обязательную во всех версиях, как в #65. Проверить no-match, duplicate coverage,
output reserve/equality/overflow, mandatory priority, adversarial sources, отсутствие
facts/state writes, shared interlock/replay/timeout/outage/malformed/disconnect и
once-only usage на Groq и Gemini mocks. Live качество/цену эти тесты не доказывают.

Обе стороны проверяют corpus перед включением v5; несовместимый сервер
даёт обычный safe failure, не перевод в другую версию. #78 и #79 независимы по
runtime, но первый перенёсший upstream код выполняет общий license/source gate
[Context/Prompt Engine](../../backend/docs/CONTEXT_PROMPT_ENGINE.md#перенос-ctx-a01-и-лицензионная-граница).
