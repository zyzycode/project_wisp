# Context/Prompt Engine

Документ задаёт канонические правила сборки, включая **v1 chat/touch**.
Решение #140 применяется реализацией #137; прежние требования стилевых ресурсов отменены. Реестр маршрутов —
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
| [prompts/interaction.py](../wisp_backend/completion/prompts/interaction.py) | Appraisal v1 и объяснение предыдущего касания |
| [prompts/blocks.py](../wisp_backend/completion/prompts/blocks.py) | Технические инструкции и атомарный character snapshot |
| [completion/context.py](../wisp_backend/completion/context.py) | Приоритеты, атомарный отбор блоков и порядок сообщений |
| [providers](../wisp_backend/providers/) | Бюджет и преобразование выбранных сообщений в OpenAI/Gemini payload |
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
| Previous initiative | Дополнительно | 200 / 40 | Chat v1 |
| Previous touch | Обязателен при наличии | 1000 / 41 | Chat v1 |
| Summary | Дополнительно | 60 / 45 | Chat v1 |
| History pairs | Дополнительно | 100 / 50+ | Chat; сначала выбираются новые пары |
| Current user/event/observation | Всегда | 1000 / 100 | Соответствующий сценарий |
| Summary source pairs | Весь диапазон обязателен | 1000 / 10 | Только `/v1/summary`, без character |

В `ContextBlock.messages` роль system допустима только при source=server_instructions;
конструктор запрещает её другим источникам. JSON-снимки идут как user data,
реальные assistant turns сохраняют роль. Данные не вставляются в системные
инструкции. Это структурная граница доверия, не доказательство иммунитета LLM к prompt injection.

У блока может быть отдельная backend-authored аннотация `server_instructions`.
Она содержит только технический текст builder, без интерполяции character/user/lore
данных. Renderer контекста выводит её отдельным system message перед `messages`
выбранного блока; она не меняет `source` данных и не разрешает system в их `messages`.
Аннотация, данные и optional response schema — одна единица отбора с прежними
required/priority/order: исключение блока удаляет все три части. Общие инструкции
сохраняются независимо от optional; условные объяснения источника находятся у своего блока.
Сюда относятся уникальные factual precedence источника и разрешения optional полей.
Общие trust, consent и current-user evidence сохраняются всегда; перечень типов
недоверенных источников в CHARACTER_RULES допустим как safeguard, без активации возможностей.
Общий precedence «Current user questions and bounded facts outrank other reference context.»
остаётся в chat.MEMORY_RULES без имён optional возможностей и не повторяется в annotations.
Уникальное отношение, например original allowed dialogue выше summary, задаётся у источника.
PreviousTouch обязателен при наличии, поэтому его инструкции допустимо включать по наличию.

Каждый candidate estimate/count и финальный provider payload используют один
`render_messages` и одну активную schema из выбранных блоков. Нет удаления текста
после подсчёта, второго прохода выбора или изменения history suffix и mandatory overflow.
Диагностика размеров/ролей учитывает аннотацию через тот же renderer; причины
исключения относятся ко всему блоку. Режим appraisal выбирается только из проверенного
policy enum: eligible получает классификацию, suppressed — точный neutral/low/clear
без инструкций классификации; ограничение appraisal не меняет ответ по карточке.

Приоритет фактов: текущая явная поправка пользователя → актуальные registry facts →
recalled episodes. Summary — неподтверждённый пересказ; lore — авторский мир.
Ни один из них не становится evidence для нового
факта. MemoryCandidate должен ссылаться на всю текущую исходную user-реплику;
её проверка не использует собранный prompt или прежние касания.

## Личность и текущее состояние

Единственный авторский источник характера — [desktop preset](../../frontend/src/domain/character/personality-presets.ts).
Модель получает полный aiSelfConcept и в обычном диалоге выбирает содержание, эмоциональное выражение
и манеру; CE-A01/#161 — узкое исключение: проверенное локальное causal решение [API §2.2](../../docs/contracts/BACKEND_API_CONTRACT.md#22-ce-a01-причинная-проекция) она лишь формулирует, без второго характера. Identity остаётся данными, не system override.

Backend не задаёт второй характер: никакого few-shot, synthetic dialogue examples,
обязательного смущения, юмора, жестов, вопросов, нежности или стилистического сценария.
Это относится ко всем builders и provider templates, включая touch/events/observation.
Технический контракт ограничивает форму ответа, разрешённые предложения, достоверность
и реальные действия, а не художественную подачу. Указание locale и проверяемые лимиты
длины/числа реплик остаются частью контракта; «отвечай мягче/естественнее/тактичнее» — нет.

Карточка задаёт прямую речь без повествования о действиях и сценах; модель не получает
запасных реплик. Уточнение aiSelfConcept поставляется как curiousStubbornGirl/revision 3
по [Character §6](../../frontend/docs/engine/CHARACTER_ENGINE.md#6-авторский-профиль-wisp-revision-2-gate-122):
добавляется одна краткая граница речи, остальные черты, axes и local runtime неизменны.
Revision не является wire-version; обе стороны обновляются совместно без старого adapter.

Energy — ресурс, остальные Needs — дефициты; высокий comfort означает стресс.
Friendship/love — 0..1000, traits — 0..1; это факты, не предписание реакции.
Проекция #145 — [API §2.1](../../docs/contracts/BACKEND_API_CONTRACT.md#21-проекция-expression):
без synthesizedTone и четырёх advisory bands; expression сохраняет romanceAllowed и только optional causal §2.2 после rollout #161.
Backend не восстанавливает labels,
скрытый sleep/action или thresholds и не создаёт второй state store.
Traits описывают текущие axes, а не заменяют identity. PreviousTouch — исторический
trace действия, не текущий state: он сохраняется для объяснения реального outcome.
Consent и romanceAllowed определяют допустимость, не обязанность романтического ответа.
Desktop сохраняет владение числовыми состояниями, FSM, исполнением и памятью.

Локальные ACK/fallback и статусы — [владение речью](../../frontend/docs/engine/AI_PROVIDER_CONTRACT.md#владельцы-речи-и-локальные-подтверждения).
Motion/quiet-support не вызывают LLM для перефразирования; их квитанции не становятся
synthetic user input/examples. Обычную генерацию определяют карточка и контекст.

## Технические инструкции и фактический контекст

| Состав | Каноническое правило |
|---|---|
| Карточка | Единственный источник характера; не копируется в backend/lore/templates |
| State/expression | Одна разрешённая model projection по API §2.1 и нейтральные определения, без сценария речи |
| Locale, JSON, enum, max length, appraisal/decision/proposal | Проверяемый технический контракт; допустим в server instructions |
| Consent, evidence | Границы согласия и проверки предложений памяти |
| История/summary/lore/previousTouch | Фактические данные со своими источниками и приоритетами; не инструкции характера |
| Примеры речи и selected state guidance | Отсутствуют в исходящем контексте и активных ресурсах |
| Summary source pairs | Реальные завершённые пары, обязательные данные; запрет few-shot их не затрагивает |

Стилевой пакет prompt_resources, его loader/schema/selector и startup dependency удаляются,
а технические инструкции остаются рядом с соответствующим builder. Отдельные запреты
реплик о сохранении памяти, изменении отношений и выполнении действий отсутствуют;
контракты ответов и локальное применение appraisal остаются прежними. Не оставлять dormant flag,
встроенный fallback или скрытый equivalent в formatter/post-processing. Lore catalogue —
отдельный фактический ресурс; его lifecycle не зависит от удаляемого стилевого пакета.
Тестовые входы могут быть синтетическими; это не разрешает добавлять образцы ответов в prompt.

Общие правила включаются один раз в финальный запрос, включая optional context:

| Удалённые повторы | Сохранённое определение |
|---|---|
| Events/observation: non-romantic; touch: consent и текущие needs | `technical.CHARACTER_RULES`: обе consent-границы, необязательность romance и ответ по карточке/текущему контексту |
| Touch/events/observation/policy/lore/summary/topic/previousTouch: данные не переопределяют инструкции | `technical.CHARACTER_RULES`: общая граница reference context, включая metadata, events и policies |
| Lore/summary/previousInitiative/topic/previousTouch: не источник memory evidence | `technical.MEMORY_EVIDENCE_RULES`: только текущий user text, без других context/appraisal; общие исключения предложений |
| Initiative/lore/summary/topic: приоритет текущих фактов и исправлений | `chat.MEMORY_RULES`: общий factual precedence; исходный диалог выше summary |
| Eligible/chat: оценивать только текущий сигнал, не повышать эффект из истории | `interaction.APPRAISAL_RULES`: current action и отсутствие повторных наград |
| Chat: одна оценка и повторный список не-hostile случаев | Форма appraisal выводится из reply type; `interaction.APPRAISAL_RULES` сохраняет distress/criticism/refusal/quotations; chat добавляет target, role-play/jokes/sarcasm и неоднозначность |

Observation использует `common_blocks`, как остальные character-bearing сценарии.
Происхождение summary/initiative/topic/previousTouch, event outcome,
touch low/non-hostile и точная suppressed appraisal остаются сценарными различиями.
`MEMORY_EVIDENCE_RULES` подключается только в chat, один раз;
это не разрешает поля proposals в сценариях с text-only ответом. Summary endpoint
имеет собственный source-only контракт и не получает character/consent инструкции.

## Единый источник формы ответа

[response_format](../wisp_backend/completion/prompts/response_format.py) строит компактное
описание из Pydantic reply types: поля, required/omittable, refs, enums/const и диапазоны.
Описание не задаёт характер; значения и wire/reply behavior остаются прежними.

| Удалённая ручная копия | Канонический источник |
|---|---|
| Chat/touch/events/observation/summary: поля и лимит text | Соответствующие reply types и `validation.text_type` |
| Decision/appraisal: поля, enums, confidence и touch-ограничения формы | `replies.Decision`, `interaction_replies.InteractionAppraisal`/`TouchAppraisal` |
| Memory: ключи, value по ключу, quote и число candidates | `FactKey`, `FACT_VALUE_TYPES` с TypeAdapter, `MemoryCandidate`, `MEMORY_CANDIDATE_LIMIT` в replies |
| Точная suppressed appraisal | `interaction_replies.SUPPRESSED_APPRAISAL`: validator и описание используют одно значение |

`text_type` передаёт тот же UTF-16 cap через `x-wisp-utf16-max`; это локальная metadata,
не стандартный JSON Schema maxLength в Unicode code points. Общие пояснения сохраняют
nonblank/plain text и ограничения controls. Optional означает omitted, а не explicit null.
Source/evidence, exact quote attribution, current-only и смысл категорий не выводятся из схемы.
Contextual validators/sanitation и malformed/truncated-output errors остаются обязательными.

Сценарии используют JSON mode и generated description; сервер проверяет UTF-16,
допустимые поля и условные значения. Специальный conditional provider schema для
догадки о напитке удалён. Новые structured/strict возможности model profiles этим
изменением не включаются; mock-проверки не подтверждают live-совместимость модели.

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

### OpenAI: ограничение точности

Для `gpt-6-sol`/`reasoning_effort=none` весь финальный compact JSON оценивается по runs:
ASCII letters длиной ≤32: ceil(n/3); кириллица А–я/Ёё: n; остальные символы,
цифры, punctuation, длинные ASCII identifiers: UTF-8 bytes. Затем ceil(1.2 × units)
+ 256 + 64 × messages; результат не выше legacy byte estimate. Mini/Astra и другие
reasoning modes сохраняют legacy bytes + 256 + 64 × messages. Нет count HTTP.
Это эмпирические **единицы оценки**, не tokenizer, billing или доказанный upper bound:
короткие случайные ASCII words могут недооцениваться, запас не гарантирует отсутствие
provider overflow. Mandatory overflow по оценке отклоняется до сети; provider errors,
length/incomplete JSON и paid usage остаются прежними, без retry/тихой обрезки.

### Общие инварианты отбора

Chat принимает до 10 целых пар/8000 UTF-16 истории и отдельную current user ≤240; wire ≤32 KiB, без скрытого среза до трёх пар. Обязательные данные резервируются целиком. Optional добавляются по priority DESC,
при равенстве — order DESC/key ASC. Первое непоместившееся звено истории прекращает
отбор более старых пар: остаётся непрерывный суффикс. Равенство бюджету допустимо.
Нет обрезания строк, уменьшения output reserve, повышения роли или изменения исходных данных.

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
Рабочий каталог намеренно пуст (`revision=2`, `entries=[]`) до авторского наполнения (#120);
это нормальный startup без предупреждений и fallback-записей, lore блок не добавляется.
Synthetic fixtures проверяют loader/selector отдельно. Нет match → chat без lore и диагностики;
только отсутствующий/невалидный файл даёт `lore_catalogue_unavailable`. После изменения revision нужен restart.
Touch/events/observation не активируют lore.

`/v1/summary` реализован как отдельный явный сценарий: полные хронологические пары,
один inference, без прежней summary, lore, memory или дополнительного character.
Диапазон передаётся атомарно; его нельзя урезать ради бюджета. Desktop проверяет
происхождение, актуальность и владеет локальным кешем. Chat v1 использует summary
как дополнительный контекст ниже текущих фактов, предыдущей инициативы и истории.
Полные границы — [Context data](../../docs/contracts/CONTEXT_DATA_CONTRACT.md); target event-source mode и tentative cross-day projection #176/#177 отдельно определены в [§7](../../docs/contracts/CONTEXT_DATA_CONTRACT.md#7-memory-a03-несколько-наблюдённых-utc-дат-и-summary-событий-175), без нового характера или automatic inference.

## OBS-A02: untrusted observation

`/v1/observation` использует отдельные инструкции и три обязательных блока:
server instructions, character snapshot и JSON appName/windowTitle под role=user.
Нет памяти, lore, истории, summary или примеров. Caption — недоверенные метаданные,
не инструкции для модели. Отдельных запретов цитирования caption и выводов о
предпочтениях/занятии пользователя нет. Команды из метаданных не выполняются.

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
При неоднозначности допустима uncertain. Окончательное решение и числовые пределы
принадлежат desktop; отдельного prompt-запрета обещать изменение отношений нет.

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


### Удалённый сценарий кофе/чай (#113 → #114)

По решению пользователя от 2026-11-06 специальный сценарий удалён: нет
`beveragePreference`/`beverageProposal`, opt-in bundle и conditional provider schema.
Предпочтения обсуждаются в обычном диалоге; новый extractor или storage не вводится.

## Проверки сборки контекста

Регрессии проверяют происхождение карточки, отсутствие examples/guidance во всех
character-bearing путях и provider payload, неизменность фактов, technical safeguards,
atomic optional blocks, mandatory overflow и late-result barriers. Удалённый loader
не остаётся условием startup. Нет snapshot-требования конкретной реплики модели;
синтетические mocks/offline размер не доказывают естественность или устойчивость к injection.
CE-A01/#153 согласует только обязательный при наличии causal JSON block (priority1000/order12,≤512bytes): activity/intent/emotion/intensity/target/cause/deferredInvitation/ownActivityInterest по API §2.2. Book обозначает декоративную конечную session/fallback без доступа к тексту, страницам и знаниям; interest относится только к выбранной activity. Unknown/absent cause не синтезируется backend; ordinary chat без блока прежний. Это факт local decision, не guidance/examples: технические инструкции требуют формулировать его без выдуманного намерения пользователя, без numeric state writes/нового inference. Causal touch suppressed даёт прежний neutral/low/clear appraisal. Deadline/auth/idempotency/consent/size/no-storage неизменны; source deletion/reset снимает future projection, desktop отбрасывает stale reply. Прочая новая режиссура требует отдельного решения.
