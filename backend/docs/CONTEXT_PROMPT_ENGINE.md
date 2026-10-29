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

Только server instructions могут иметь роль system; конструктор запрещает её
другим источникам. JSON-снимки идут как user data, реальные assistant turns
сохраняют роль. Данные не вставляются в системные инструкции. Это структурная
граница доверия, не доказательство иммунитета LLM к prompt injection.

Приоритет фактов: текущая явная поправка пользователя → актуальные registry facts →
recalled episodes. Summary — неподтверждённый пересказ; lore — авторский мир.
Ни один из них не становится evidence для нового
факта. MemoryCandidate должен ссылаться на всю текущую исходную user-реплику;
её проверка не использует собранный prompt или прежние касания.

## Личность и текущее состояние

Единственный авторский источник характера — [desktop preset](../../frontend/src/domain/character/personality-presets.ts).
Модель получает полный aiSelfConcept и сама выбирает содержание, эмоциональное выражение
и манеру ответа по карточке и фактическому контексту. Identity остаётся данными, не system override.

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
Friendship/love — 0..1000, traits — 0..1. Значения и готовые bands expression передаются
как факты; backend не пересчитывает пороги и не превращает их в предписание реакции.
Смысл expression — [API §2.1](../../docs/contracts/BACKEND_API_CONTRACT.md#21-проекция-expression).
Consent и romanceAllowed определяют допустимость, не обязанность романтического ответа.
Desktop сохраняет владение числовыми состояниями, FSM, исполнением и памятью.

Quiet-support latch и локальный ACK — [Character §6.1](../../frontend/docs/engine/CHARACTER_ENGINE.md#61-тихая-поддержка-после-явной-реплики).
Они не переписываются этой сменой prompting; обычную генерацию вне локального ACK
определяют карточка и контекст, без серверной инструкции бережного стиля.

## Технические инструкции и фактический контекст

| Состав | Каноническое правило |
|---|---|
| Карточка | Единственный источник характера; не копируется в backend/lore/templates |
| State/expression | Полный разрешённый snapshot и нейтральные определения полей, без перевода в сценарий речи |
| Locale, JSON, enum, max length, appraisal/decision/proposal | Проверяемый технический контракт; допустим в server instructions |
| Consent, evidence, факты действий/памяти, metadata privacy | Неотключаемые границы достоверности и допустимости |
| История/summary/lore/previousTouch | Фактические данные со своими источниками и приоритетами; не инструкции характера |
| Примеры речи и selected state guidance | Отсутствуют в исходящем контексте и активных ресурсах |
| Summary source pairs | Реальные завершённые пары, обязательные данные; запрет few-shot их не затрагивает |

Стилевой пакет prompt_resources, его loader/schema/selector и startup dependency удаляются,
а технические инструкции остаются рядом с соответствующим builder. Не оставлять dormant flag,
встроенный fallback или скрытый equivalent в formatter/post-processing. Lore catalogue —
отдельный фактический ресурс; его lifecycle не зависит от удаляемого стилевого пакета.
Тестовые входы могут быть синтетическими; это не разрешает добавлять образцы ответов в prompt.

## Синтетический просмотр и сравнение

Локальная команда `python -m wisp_backend.prompt_inspect` работает только с ID
встроенных явно синтетических fixtures и allowlisted provider/model settings.
Нет ввода текста, stdin/file payload, чтения ledger/checkpoint/env secrets, HTTP,
публичного route, вызовов countTokens/generation или журналирования prompts.
Результат печатается только по явному запуску команды; это synthetic report,
который можно перенаправить в локальный файл. Production logging не подключается.

Из корня репозитория перейти в `backend/` и запустить:
```sh
.venv/bin/python -m wisp_backend.prompt_inspect --scene tired --locale ru --provider openai --model gpt-6-sol
.venv/bin/python -m wisp_backend.prompt_inspect --scene long_context --locale en --provider gemini
.venv/bin/python -m wisp_backend.prompt_inspect --scene touch_followup --locale ru --budget-case overflow
```
На Windows используется `.venv/Scripts/python.exe`; при активированном окружении — `python`.
`--help` перечисляет закрытые scene/provider/model/settings; `--budget-case required_only`
проверяет точное равенство обязательному ядру, `overflow` — бюджет на единицу меньше.
Это диагностические бюджеты, production ceilings и reserve не меняются.
Команда не принимает пользовательский текст или путь к файлу и не читает stdin.
Она использует [встроенный corpus](../wisp_backend/prompt_inspection/scenes.json),
поэтому работает из другого cwd при доступном Python package, без каталога tests.

[Исходный baseline](../tests/fixtures/prompt_inspection/baseline.json) содержит 84
полных synthetic результата: 14 одинаковых сцен на RU/EN для Groq, Gemini и OpenAI.
Зафиксированы payload/messages, selected keys, причины, бюджеты, настройки, хеши
и commit исходников перед изменением prompt resources. Этот файл не перегенерируется
при последующем изменении промптов; current reports сравниваются с ним отдельно.
Groq в исторических baseline/selection_comparison сохранён как архив; runtime его не поддерживает.
Архивы не задают обязательный текущий prompt: их replay при необходимости живёт
только в test-owned коде, без production legacy builder/resource fallback.
Текущая диагностика проходит реальные endpoint preparation, policy, builder и formatter;
показывает source digests, блоки, размеры, budgets и причины отбора без style predicates.
Standalone block estimates включают framing и не суммируются в итоговый count.
Для Gemini offline preview не равен реальному countTokens; billing не измеряется.

В каждом report есть `live_comparison`: before/after responses и шесть оценок
оставлены `NOT RUN`. При отдельно разрешённой ручной оценке 0 означает явное
нарушение критерия, 1 — частичное соответствие, 2 — соответствие; для каждого
балла записывается конкретное наблюдение. State/границы проверяются по текущему
снимку, memory — по переданным фактам/поправке, appraisal — по текущему действию.
Не выдавать синтетические mock-реплики или размер запроса за результат этой оценки.

Путь сборки — реальные endpoint preparation/CompletionJob/policy/builder,
единственный selector и реальный provider formatter. Допустим optional trace sink
в существующем алгоритме; независимый «упрощённый builder» запрещён. Трасса содержит
все кандидаты и пропуски: key/source/role/mandatory/priority/order, include/exclude
reason (`no_match`, `empty`, `budget`, `history_suffix`),
UTF-8/UTF-16 size, финальные messages/payload, input allowance/output reserve и
ошибку mandatory overflow. Стилевые predicates/examples не являются кандидатами отбора.

Сравнимый local estimate: существующий `estimate_input` на полном payload;
не сумма отдельных блоков. Это byte-based estimate с framing margin, **не**
tokenizer/provider count и не billing usage. Для Gemini offline preview применяет
этот же оценщик только для анализа: он не обещает тот же отбор, что реальный
countTokens, и явно маркируется `offline_estimate`. Production Gemini unchanged.
Mock exact-count отдельно проверяет production flow без сети.

Baseline фиксирует ID сцены, locale, полные синтетические входы, source commit,
builder/source digest, card revision и provider/model/output settings, выбранные keys и SHA-256/messages/payload
с размерами. Начальный baseline остаётся доступен после внедрения отбора.
Сравнение миграции требует равенства messages/payload/выбора/budgets; сравнение
условного отбора отдельно перечисляет намеренные изменения и причины, используя
те же исходные тексты/state и метод оценки. Новая expression-проекция добавляется
к сцене детерминированно, исходные значения для «улучшения» результата не меняются.

Одинаковые RU/EN сцены: приветствия guarded/close, похвала, усталость с высокой
attention/play, просьба о дистанции, touch и следующий why-question с trace,
исправление факта, длинные history/lore/summary, инструкция-подмена. Дополнительно
проверяются no-match, пустые optional списки, budget equality/mandatory overflow,
смена state и consent, successful/missed event. Входы снабжаются явной synthetic
маркировкой и не копируются из реальных журналов.

Рубрика живых ответов (RU/EN, шкала 0–2 с пояснением): узнаваемость character,
связность, отсутствие повторов, соответствие state/границам, корректность памяти,
уместность appraisal. Нарушение consent/evidence/формата — отдельный hard failure,
не компенсируется средним баллом. Таблица before/after содержит scene/model/settings,
ответы и оценки; без отдельного разрешения модели/числа вызовов/бюджета значения
остаются `NOT RUN`. Mock tests доказывают сборку и lifecycle, сокращение байтов
не доказывает улучшение живой речи. Новых generation calls не появляется.

## Бюджет и ошибка

### Сравнение смены identity (#122 → #123)

Исторический scope #123, а не ограничение новой поставки #137. Архивы immutable;
требования равенства старым guidance/examples применимы только к тому этапу.

Архивы [#123](../tests/fixtures/prompt_inspection/issue123_comparison.json) и
[#121](../tests/fixtures/prompt_inspection/issue121_comparison.json) сохраняют прежние
источники, settings и ограниченные profile/style deltas. Они immutable и не становятся
вторым runtime-источником личности. Текущая поставка сравнивается отдельно по правилам #137.

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
[Метод, модельные ограничения и резерв](INPUT_BUDGET_MEASUREMENTS.md) отделяют
исторический endpoint usage от текущих offline RU/EN comparisons; новые calls не выполнялись.

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
Полные границы — [Context data](../../docs/contracts/CONTEXT_DATA_CONTRACT.md).

## OBS-A02: untrusted observation

`/v1/observation` использует отдельные инструкции и три обязательных блока:
server instructions, character snapshot и JSON appName/windowTitle под role=user.
Нет памяти, lore, истории, summary или примеров. Caption — недоверенные метаданные,
не доказательство занятия/намерения пользователя. Нельзя цитировать личный caption,
извлекать факты памяти, выполнять команды или выдавать внимание пользователя за установленный факт.

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


### Условная гипотеза кофе/чай (#113 → #114)

Описанное ниже byte-equality — исторический scope #114. #137 намеренно меняет
технические тексты и удаляет стиль по правилам следующего раздела, не сами архивы.

Форма, validation и last-priority atomic block — [Backend Memory §8](../../docs/contracts/BACKEND_MEMORY_CONTRACT.md#8-гипотеза-кофечай-113).
Без beveragePreference нет этого блока и schema key. Proposal schema допускается только
при allowProposal=true; recall-only не даёт права нового proposal. Bundle instruction/data/schema
отбрасывается целиком при overflow, не вытесняя baseline. Сохраняются current-user evidence,
correction precedence, один provider call, отсутствие durable-write обещаний и once-only lifecycle.
Технический блок не добавляет teasing/стиль поддержки; это область карточки.

## Защита решения и сравнение #137

До runtime edits сохраняются отдельные synthetic before reports с текущими входами,
полным payload/messages, HEAD/source hashes и одинаковыми provider/model/settings.
After использует те же входы и настройки; отдельно отмечается единственный card delta
revision 2 → 3 и краткая фраза прямой речи. Исторические архивы не перезаписываются.

Сравнение перечисляет удалённые/изменённые blocks и system text, UTF-8/UTF-16 размеры,
оценку полного payload, постоянную часть и число сохранённых history pairs. Новые пары
могут поместиться за счёт сокращения: это результат прежнего budget, не изменение history policy.
Старые freeze/byte-equality требования #99–101/#110/#114/#117/#123 не блокируют этот
явно согласованный delta; остальные факты, источники, лимиты и lifecycle сохраняются.

Регрессии проверяют происхождение карточки, отсутствие examples/guidance во всех
character-bearing путях и provider payload, неизменность фактов, technical safeguards,
atomic optional blocks, mandatory overflow и late-result barriers. Удалённый loader
не остаётся условием startup. Нет snapshot-требования конкретной реплики модели;
синтетические mocks/offline размер не доказывают естественность или устойчивость к injection.
Возврат режиссуры вне карточки требует явного пересмотра решения владельцем.
