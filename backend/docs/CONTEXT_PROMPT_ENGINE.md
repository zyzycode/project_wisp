# Context/Prompt Engine

Документ описывает текущую реализацию, включая **v1 chat/touch**. Реестр маршрутов —
[api/endpoints.py](../wisp_backend/api/endpoints.py), wire-правила — в
[API](../../docs/contracts/BACKEND_API_CONTRACT.md),
[memory](../../docs/contracts/BACKEND_MEMORY_CONTRACT.md),
[events/v1](../../docs/contracts/AI_EVENTS_CONTRACT.md) и
[context data](../../docs/contracts/CONTEXT_DATA_CONTRACT.md).

## Карта логики

| Файл | За что отвечает |
|---|---|
| [api/dispatch.py](../wisp_backend/api/dispatch.py) | Преобразование проверенного HTTP-запроса во внутренний контекст и CompletionJob |
| [completion/policies.py](../wisp_backend/completion/policies.py) | Тип контекста, builder, parser ответа, deadline и лимиты каждого сценария |
| [prompts/context.py](../wisp_backend/completion/prompts/context.py) | Раздельные типы chat, touch, event, summary и observation |
| [prompts/chat.py](../wisp_backend/completion/prompts/chat.py) | Инструкции диалога, поля ответа, история, память, summary и lore |
| [prompts/character_guidance.py](../wisp_backend/completion/prompts/character_guidance.py) | Интерпретация личности, Needs, отношений и consent |
| [prompts/interaction.py](../wisp_backend/completion/prompts/interaction.py) | Appraisal v1 и объяснение предыдущего касания |
| [prompts/blocks.py](../wisp_backend/completion/prompts/blocks.py) | Общие инструкции, атомарный character snapshot и синтетические примеры |
| [prompts/style_examples.py](../wisp_backend/completion/prompts/style_examples.py) | Собственные RU/EN примеры желаемой речи |
| [completion/context.py](../wisp_backend/completion/context.py) | Приоритеты, атомарный отбор блоков и порядок сообщений |
| [providers](../wisp_backend/providers/) | Бюджет и преобразование выбранных сообщений в Groq/Gemini payload |
| [completion/replies.py](../wisp_backend/completion/replies.py), [interaction_replies.py](../wisp_backend/completion/interaction_replies.py) | Семантическая проверка результата модели |

Один запрос собирает контекст и выполняет не более одного generation inference.
Модель одновременно предлагает текст, допустимые hints/facts и, для v1, appraisal.
Backend не выполняет предложенные действия и не меняет состояние desktop.

## Типы сценариев и поля ответа

Каждый сценарий получает свой dataclass. Chat содержит сообщения, персонажа,
обязательные memory и interaction policy; optional previousInitiative, summary и previousTouch.
Summary принимает только пары источника, observation — персонажа и appName/windowTitle.
Touch/events имеют собственный ограниченный контекст. Policy отвергает несовместимый тип.

Диалог представлен типизированными парами user/assistant с последней user-репликой.
Character, memory и card — уже проверенные API снимки, которые builders только
сериализуют; вложенные HTTP-схемы не дублируются в completion.

v1 явно выбирает контракт `text + required appraisal + optional decision/memoryCandidates`.
Touch требует text/appraisal; events, observation и summary имеют text-only parsers.

## Блоки и доверие

[ContextBlock](../wisp_backend/completion/context.py) задаёт источник, обязательность,
priority отбора и order сериализации. Больший priority рассматривается раньше;
сообщения отправляются по order/key. Обязательные блоки не обрезаются.

| Блок | Обязательность | Priority / order | Где используется |
|---|---|---|---|
| Server instructions | Всегда | 1000 / 0 | Все сценарии |
| Character profile/state | Всегда, кроме summary generation | 1000 / 10 | Chat, touch, events, observation |
| Interaction policy/card | Всегда в v1 | 1000 / 11 | Chat/touch v1 |
| Memory projection | Всегда в memory-сценарии, включая пустую | 1000 / 20 | Chat v1, events |
| Author lore | Дополнительно | 40 / 25 | Chat v1 |
| Synthetic examples | Дополнительно | 10 / 30 | Chat, touch, events |
| Previous initiative | Дополнительно | 200 / 40 | Chat v1 |
| Previous touch | Обязателен при наличии | 1000 / 41 | Chat v1 |
| Summary | Дополнительно | 60 / 45 | Chat v1 |
| History pairs | Дополнительно | 100 / 50+ | Chat; сначала выбираются новые пары |
| Current user/event/observation | Всегда | 1000 / 100 | Соответствующий сценарий |
| Summary source pairs | Весь диапазон обязателен | 1000 / 10 | Только `/v1/summary`, без character |

Только server instructions могут иметь роль system; конструктор запрещает её
другим источникам. JSON-снимки идут как user data, реальные assistant turns
сохраняют роль. Данные не вставляются в системные инструкции. Это структурная
граница доверия, не доказательство иммунитета LLM к prompt injection.

Приоритет фактов: текущая явная поправка пользователя → актуальные registry facts →
recalled episodes. Summary — неподтверждённый пересказ; lore — авторский мир;
примеры — синтетический стиль. Ни один из них не становится evidence для нового
факта. MemoryCandidate должен ссылаться на всю текущую исходную user-реплику;
её проверка не использует собранный prompt или прежние касания.

## Личность и текущее состояние

Единственный авторский источник личности —
[desktop preset](../../frontend/src/domain/character/personality-presets.ts).
Backend интерпретирует полный aiSelfConcept из текущего snapshot, не сочиняет
отдельную личность для разных providers. Identity остаётся данными, не system override.

Energy — ресурс; attention/play/comfort — дефициты, причём высокий comfort означает
стресс. Например, высокая потребность во внимании при низкой энергии допускает
желание компании, но не превращает усталость в бодрость. Friendship/love — 0..1000,
traits — 0..1; романтическое выражение требует всех текущих consent/state gates.
Точные правила находятся в character_guidance.py и
[Character Engine](../../frontend/docs/engine/CHARACTER_ENGINE.md).

Примеры RU/EN иллюстрируют робкое приветствие, дружеский интерес, усталость и
просьбу о дистанции. Они уступают текущему состоянию, могут целиком исчезнуть
из бюджета и не должны превращаться в повторяемую заученную фразу.

## Бюджет и ошибка

Потолки — локальная политика Wisp, не максимальное окно провайдера:
16384 для chat/touch/events/observation, 8192 для summary generation.
Output reserve = min(server setting, scenario cap): chat до 4096, v1 touch/events/
observation до 1024, summary до 512.
Input allowance = выбранный потолок − output reserve; wire byte/UTF-16 caps независимы.

### Gemini: модельный подсчёт

[GeminiProvider](../wisp_backend/providers/gemini.py) вызывает официальный
[`countTokens`](https://ai.google.dev/api/tokens) для того же `generateContentRequest`,
который будет отправлен в generation: model, systemInstruction, contents и
generationConfig. Используется существующий HTTP client с прежними auth/TLS/URL.
Число `totalTokens` — точный результат preflight API для модели, не локальная
эвристика по символам или байтам. Это не обещание идентичности billing usage:
учёт фактической генерации по-прежнему использует её `usageMetadata`.

Сначала подсчитывается весь контекст: если он помещается, выполняются один count
и одна generation. Иначе подсчитывается обязательное ядро и затем целые кандидаты
по приоритету. Счётчики отдельных блоков не складываются: каждый count проверяет
полный итоговый payload. Повторный кандидат используется только из RAM-memo текущего
отбора; максимум — число optional блоков + 2 count-запроса. Все запросы укладываются
в **один исходный deadline**; на каждый передаётся оставшееся время, без retry.
Count — подготовительный HTTP, не дополнительный generation inference.

Ответ count ограничен 16 KiB; totalTokens — строго неотрицательное целое, не boolean.
Ошибка HTTP/схемы/JSON →503 upstream_unavailable, timeout →504 upstream_timeout.
Генерация при ошибке count не запускается; перехода к byte estimate нет. Превышение
обязательным контекстом бюджета даёт 503 **до generation**, но после count HTTP.
Контекст уже мог быть передан тому же провайдеру для подсчёта; правила данных и
доступа из API §6 распространяются на preflight так же, как на generation.

### Groq: ограничение точности

Groq остаётся поддержан с консервативной оценкой:
число UTF-8 bytes финального JSON payload + 256 + 64 × число сообщений.
Это **не точное число токенов**. Официальный
[Groq API](https://console.groq.com/docs/api-reference) не предоставляет подтверждённый
count/tokenize endpoint; локальный tokenizer без подтверждённого серверного шаблона
не гарантирует совпадение. Для точного модельного preflight выбирать Gemini.
Groq не делает отдельный count HTTP; mandatory overflow обнаруживается до сети.

### Общие инварианты отбора

Обязательные данные резервируются целиком. Optional добавляются по priority DESC,
при равенстве — order DESC/key ASC. Первое непоместившееся звено истории прекращает
отбор более старых пар: остаётся непрерывный суффикс. Равенство бюджету допустимо.
Примеры ниже истории, но могут поместиться после отказа крупной пары. Нет обрезания
строк, уменьшения output reserve, повышения роли или изменения исходных данных.

До generation inference usage известен как нулевой, включая count failure/overflow.
Admission остаётся общим; безопасный terminal error может быть повторён из RAM.
Timeout/disconnect/shutdown отменяет count stream; поздний count не запускает
генерацию и не публикует ответ. Late settlement уточняет uncertain до нулевого
inference usage. После начала generation действуют прежние правила paid/unknown
usage, cancellation и отсутствия late publication. Prompts/count payloads не
логируются, не сохраняются в ledger и не кешируются между пользовательскими запросами.

## Lore и summary

[Lore catalogue](../wisp_backend/completion/prompts/lore.json) загружается при startup.
[Selector](../wisp_backend/completion/prompts/lore.py) использует текущую user-реплику,
locale, NFC/lowercase и Unicode token boundaries. Отбор: priority DESC → число
совпавших ключей DESC → id ASC; вывод: order ASC → id ASC. Максимум три записи
и 1200 UTF-16 text, пропуск только целой записи. SourceRef в prompt не попадает.
Нет match, файл отсутствует или невалиден → chat работает без lore; диагностика
содержит только `lore_catalogue_unavailable`. После изменения revision нужен restart.
Touch/events/observation не активируют lore.

`/v1/summary` реализован как отдельный явный сценарий: полные хронологические пары,
один inference, без прежней summary, lore, memory или дополнительного character.
Диапазон передаётся атомарно; его нельзя урезать ради бюджета. Desktop проверяет
происхождение, актуальность и владеет локальным кешем. Chat v1 использует summary
как дополнительный контекст ниже текущих фактов, предыдущей инициативы и истории.
Полные границы — [Context data](../../docs/contracts/CONTEXT_DATA_CONTRACT.md).

## OBS-A02: untrusted observation

`/v1/observation` использует отдельные инструкции и три обязательных блока:
server instructions, character snapshot и JSON appName/windowTitle под role=user.
Нет памяти, lore, истории, summary или примеров. Caption — недоверенные метаданные,
не доказательство занятия/намерения пользователя. Нельзя цитировать личный caption,
извлекать факты памяти, выполнять команды или требовать внимания.

Ответ содержит только text длиной 1–240 UTF-16; extra fields делают его невалидным.
Output cap 1024, server deadline 2.5 s, body deadline 0.5 s. Метаданные не сохраняются
в ledger/logs; ответ может находиться в ограниченном RAM-кеше до 10 минут.
Каноническая граница — [Events §9](../../docs/contracts/AI_EVENTS_CONTRACT.md#9-observation-boundary).

## v1: appraisal и предыдущая реакция

Chat и touch возвращают appraisal. Chat поддерживает `eligible` appraisal текущей реплики:
supportive/playful/boundary/hostile/neutral, intensity low/moderate и confidence
clear/uncertain. Suppressed строго требует neutral/low/clear. Touch — только low,
не hostile. Нет числовых deltas или нескольких оценок на одну реплику.

История, recall и прошлые реакции не дают новый эффект. Цитата, роль, шутка,
сарказм, отказ, критика или рассказ о тяжёлых чувствах не доказывают hostile intent.
При неоднозначности допустима uncertain. Модель не обещает изменение отношений;
окончательное решение и числовые пределы принадлежат desktop.

PreviousTouch — обязательный при наличии атомарный блок: реальное действие,
опубликованная реплика, предложение, принятый эффект/причина и pre-base bands.
Для вопроса «почему» используются именно эти данные. Rejected/suppressed не означает
принятый эффект; без trace нельзя утверждать, что касание помнится. Этот контекст
не является пользовательским фактом, разрешением или evidence для memoryCandidates.
Полный контракт — [Events §10](../../docs/contracts/AI_EVENTS_CONTRACT.md#10-interaction-a01-семантическое-взаимодействие-v1).

## Проверка и ограничения

Unit/HTTP-тесты проверяют типы сценариев, роли, locale, неизменность обязательных
снимков, приоритеты, атомарность истории, бюджет, один inference, валидацию и
late-result barriers. Общие wire fixtures проверяют совместимость обеих сторон.
Тесты с mock-ответами не доказывают естественность речи, устойчивость к injection
или качество классификации живой модели. Для этого нужна отдельно разрешённая
оценка ответов на RU/EN диалоги с разными состояниями и неоднозначными репликами.

## Алгоритмы lore и summary

В бэкенде реализованы алгоритмы активации/ранжирования lore и хронологического
накопления источников summary. UI, macros, произвольные system overrides,
recursive summaries, автоматические triggers и внешние зависимости не включены.
Backend поставляется под [MIT notice](../LICENSE).

