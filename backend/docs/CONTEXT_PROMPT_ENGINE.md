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
| [prompts/prompt_resources.json](../wisp_backend/completion/prompts/prompt_resources.json) | Редактируемые пояснения и собственные RU/EN примеры желаемой речи |
| [prompts/resources.py](../wisp_backend/completion/prompts/resources.py) | Строгая загрузка immutable snapshot ресурсов до запуска runtime |
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
| Selected state guidance | Дополнительно | 20 / 1 | Chat, touch, events |
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
Числовые пороги принадлежат
[Character Engine](../../frontend/docs/engine/CHARACTER_ENGINE.md), не backend.

Сервер использует готовые semantic значения проекции `character.expression`
из [API §2.1](../../docs/contracts/BACKEND_API_CONTRACT.md#21-проекция-expression).
Серверные инструкции и selector не вычисляют числовые пороги; их единственный
владелец — Domain Character. `romanceAllowed` ограничивает речь, не разрешает эффект или действие.

Целевой профиль #122/rollout #123 — [Character §6](../../frontend/docs/engine/CHARACTER_ENGINE.md#6-авторский-профиль-wisp-revision-2-gate-122), `curiousStubbornGirl/2`. До rollout действует `shyDreamGirl/1`. Backend guidance и ресурс expression интерпретируют card/state без требования reserve/quiet pride/shy core. Examples сохраняются побайтно: робость допустима как ситуативная сцена, но пример не устанавливает core/хобби/биографию и уступает текущей card. Смена profile требует новой resource revision; `guarded` означает знакомство, не робость. Примеры уступают текущему состоянию, могут исчезнуть из бюджета и не являются обязательной фразой. Ошибки допустимы в безобидном разговоре, не в consent/evidence/фактах действий; поправка признаётся без реткона и квоты ошибок.
Quiet-support ACK/gate принадлежит desktop [Character §6.1](../../frontend/docs/engine/CHARACTER_ENGINE.md#61-тихая-поддержка-после-явной-реплики), без новых response fields/LLM classifier. Для иных формулировок guidance допускает короткое признание неудачной поддержки без очередной шутки/допроса; полнота распознавания не гарантируется.

## Проверяемые ресурсы промптов

Поставка состоит из одного server-owned JSON-пакета в `completion/prompts/`.
Это обычный tracked файл, поставляемый вместе с Python-пакетом; внешний путь, URL,
request-поле выбора пресета, env override и горячая перезагрузка не поддерживаются.
Автор меняет ресурс, запускает validation и baseline comparison, затем перезапускает
backend. Один проверенный immutable snapshot живёт до завершения процесса; запрос не читает диск.
Отсутствующий, повреждённый, слишком большой или невалидный пакет останавливает
startup до provider lifecycle/admission; наружу только `prompt_resources_unavailable`,
без содержимого и пути ресурса, исходного validation/OSError dump или частично загруженных ресурсов. Silent
fallback на встроенные копии текста запрещён. Обновление работающего файла не меняет
активный snapshot. Диагностика принимает тот же установленный пакет.
`get_prompt_resources()` использует process-wide cache, заранее прогретый первым
действием application lifespan. Несколько app в одном процессе разделяют snapshot;
пересоздание app не является reload. Файл определяется относительно модуля, не cwd.
Для применения правки нужен restart Python-процесса. Поставка исходного Python
package включает JSON рядом с loader; tests или внешняя конфигурация не требуются.

| Состав | Владелец и изменение |
|---|---|
| Формат JSON-ответа, enum, appraisal/evidence, trust/consent/no-guilt, разрешённые эффекты | Неотключаемые code-owned правила; ресурс не задаёт роль, mandatory, priority или budget |
| Авторская identity, reference/revision | Только desktop preset; ресурс не содержит копии aiSelfConcept/биографии |
| Словесное пояснение шкал и стиля, scenario introductions | Проверяемые текстовые фрагменты; fixed composition в коде удерживает обязательные ограничения |
| RU/EN synthetic examples | Данные стиля в пакете; не история, факты или инструкции |
| State, memory, history, lore, summary, previousTouch | Отдельные untrusted входы прежних владельцев; никогда не template variables в system |

Минимальная схема: `format=1`, непустой `revision` (≤64 ASCII identifier chars),
закрытый набор именованных текстовых фрагментов и конечный каталог примеров RU/EN.
Формат ресурса не является wire-version. Файл ≤64 KiB UTF-8; неизвестные ключи,
дубли JSON keys/entry IDs, неверные типы, null, неподдерживаемый format, отсутствующий
обязательный fragment/locale/scenario, пустой или whitespace-only fragment запрещены.
Валидный fragment не trim-ится: ведущие/замыкающие пробелы и newlines сохраняются.
Текст fragment ≤12000 UTF-16; один example ≤1200 UTF-16 суммарного текста;
≤32 examples, ≤2 alternatives на example. Контролы кроме newline/tab запрещены.
Каждый example имеет стабильный ID, locale, scenario и текстовые поля нынешнего
формата (`state`, `user`/`situation`, `alternatives` либо `wisp`). Метаданные ID/условий
не сериализуются в payload. Empty optional list допустим и не создаёт пустой блок.

Allowlist `texts`: `chat_intro`, `touch_intro`, `event_intro`, `expression`, `gentle`,
`company`, `play`, `trust`, `variation`; все девять обязательны. Scenario introductions
заканчиваются до правил JSON/длины ответа. Character fragments содержат только
пояснения манеры речи, не утверждения о шкалах/authority или consent-пороги:
«Adapt phrasing naturally…», «favors short, gentle…», «high attention permits a soft
bid for company», «High play/boredom invites light curiosity or play», «Low trust
allows polite distance; high trust allows warmer familiarity», «Answer the actual
message/contact; vary wording and initiative». Остальные ограничения и соединительные
знаки остаются в fixed composition. Required example fields фиксируются loader-схемой,
не самим пакетом. `CHARACTER_GUIDANCE`/scenario prose делятся по границе смысла:
неотключаемые запреты остаются в коде, редактируемые пояснения — в ресурсах.
На первом шаге их конкатенация и serialization должны воспроизвести исходный текст,
whitespace, порядок и состав блоков **побайтно**; метаданные диагностики исключаются
из этого сравнения. Динамические enum по-прежнему берутся из Python validators.
Неиспользуемые константы и запасные копии удаляются. Нет eval, regex predicates,
macros, шаблонизатора, импорта Python или интерполяции пользовательских данных.

Для неизменяющей поведение ресурсной миграции требуется побайтное сравнение сообщений.
Текущий `test_prompt_inspect.py` проверяет сохранность исходных state/text/блоков и
бюджетов после включения отбора; намеренные prompt deltas видны в сравнении ниже.
`test_prompt_resources.py` и `test_prompt_resource_lifecycle.py` проверяют ошибки
пакета, неизменяемость и fresh-process restart. Редактирование examples не меняет
identity, поля ответа или ограничения в Python; это проверяемые данные стиля.

## Условный выбор guidance и примеров

Selector получает только locale, scenario, готовую expression,
boolean userConsentEnabled и реальный event kind/outcome. Он не анализирует слова
пользователя, историю/summary/previousTouch для consent и не вычисляет числовые bands.
Для каждой записи пакет задаёт только ID заранее объявленного в коде predicate;
неизвестный/чужой для сценария predicate или дубль locale/scenario/predicate — ошибка
загрузки. Каталог не задаёт собственные пороги.

| Example predicate | Все условия включения |
|---|---|
| `chat_guarded` | chat; pace=normal; trust=guarded; consent=false |
| `chat_playful_close` | chat; pace=normal; trust=close; play=high; consent=false |
| `chat_tired_company` | chat; pace=gentle; attention=high; consent=false |
| `touch_familiar` | touch; pace=normal; trust=familiar или close; consent=false |
| `touch_gentle` | touch; pace=gentle; consent=false |
| `event_missed` | event; cursor_game_completed с фактическим outcome=missed |

Сначала exact locale/scenario, затем predicate. Примеры в этой таблице взаимно
исключаются внутри сценария; выбирается максимум один. No-match (включая иное
сочетание state/consent или успешную игру) означает отсутствие examples, без
подстановки нерелевантного примера. Текст существующих примеров сохраняется;
правка авторского голоса не является частью отбора.

Редактируемые guidance: gentle → короткая спокойная речь; company → мягкое предложение
компании; play → лёгкая игра; guarded/close → соответствующая степень знакомства.
Выбор по одноимённым expression-полям; play подавляется при gentle, company может
сосуществовать с gentle. Trust=familiar не требует trust guidance. Максимум три
guidance: gentle, company, play, trust в этом фиксированном порядке; разные ID
не дублируют один текст. Из прежнего текста выделяются подходящие пояснения без
добавления новой personality, consent-политики или обязательной реплики.

Обязательное system-ядро содержит неизменяемые правила формата/доверия/шкал,
приоритет текущей identity/state, запрет романтики при romanceAllowed=false,
no-guilt и все прежние appraisal/memory/effect ограничения. Выбранные explanations
становятся отдельными optional блоками source=server_instructions, role=system,
priority20/order1; examples остаются user-data priority10/order30. Среди guidance
использовать устойчивые ключи с указанным порядком. Никакие данные пользователя
не получают system role. Общий budget selector и его history/lore/summary приоритеты
не меняются; mandatory overflow по-прежнему завершает запрос безопасной ошибкой.
При малом бюджете можно убрать все guidance/examples, но не обязательное ядро.
Каждый следующий запрос собирается из свежего snapshot; selection не кешируется
между запросами и не влияет на локальное применение appraisal или consent.

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
Регрессии сравнивают OpenAI/Gemini с явными model/settings из baseline, независимо от текущих default.
Regression test `tests/completion/test_prompt_inspect.py` проверяет неизменность
исходных данных вне expression, прежних memory/history/lore/summary/trace блоков,
бюджетов и отсутствие HTTP/logs. Контент примеров — подмножество исходного baseline.
`source_digests` позволяет отличить смену ресурсов от смены formatter/selector.
`resources.revision/sha256` идентифицирует активный immutable snapshot; source digests
описывают файлы на диске в момент явно запущенной диагностики, не hot reload.
`source_commit` относится к происхождению исходного корпуса, а не текущей реализации.
`resource_selection` показывает каждый predicate, semantic eligibility и итоговый
include/exclude reason после budget selection, включая locale/scenario mismatch.
Ресурс `wisp-prompts-2` содержит самостоятельную пунктуацию мягких guidance;
обязательное ядро использует semantic expression вместо numeric thresholds.

[Сравнение 84 сцен](../tests/fixtures/prompt_inspection/selection_comparison.json)
сохраняет before/after estimate, выбранные блоки, причины и отдельный byte overhead
проекции в том же payload. `python -m pytest -q tests/completion/test_prompt_comparison.py`
воспроизводит artifact без сети и перезаписи baseline. Некоторые запросы становятся
длиннее из-за проекции и framing дополнительных system blocks; это явно отражено.
Standalone block estimates включают своё framing и **не суммируются** в итоговый count.
Для Gemini результат — только offline estimate, возможны отличия production отбора
с настоящим countTokens. Точное число токенов и billing здесь не измеряются.

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
reason (`no_match`, `empty`, `budget`, `history_suffix` либо выбранный predicate),
UTF-8/UTF-16 size, финальные messages/payload, input allowance/output reserve и
ошибку mandatory overflow. После введения predicates показывать также причины
невключения записей каталога, которые не стали ContextBlock.

Сравнимый local estimate: существующий `estimate_input` на полном payload;
не сумма отдельных блоков. Это byte-based estimate с framing margin, **не**
tokenizer/provider count и не billing usage. Для Gemini offline preview применяет
этот же оценщик только для анализа: он не обещает тот же отбор, что реальный
countTokens, и явно маркируется `offline_estimate`. Production Gemini unchanged.
Mock exact-count отдельно проверяет production flow без сети.

Baseline фиксирует ID сцены, locale, полные синтетические входы, source commit,
builder/source digest, resource revision/hash (до миграции — digest исходных
констант), provider/model/output settings, выбранные keys и SHA-256/messages/payload
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

Архивы #99–101/#117 (`baseline.json`, `selection_comparison.json` и historical source hashes) immutable. До runtime/resource edits #123 фиксирует **отдельный** before через существующий inspector: текущая целостная shyDreamGirl/1 на source commit/hashes/settings; восемь synthetic RU/EN сцен #108 добавляются в тот же corpus/SCENE_IDS, с парным before/after profile variant. Хеш старой карточки в frozen corpus проверяется по pinned историческому source, не по новому live preset. Новый профиль проверяется отдельно по live source hash; отсутствие старой identity в live-файле не повод переписать архив. Никакого второго authored runtime source или независимого builder.
Profile delta явно ограничен card id/revision/aiSelfConcept, соответствующими axes/derived traits/tone/expression, identity-зависимыми строками guidance/resource expression и resource revision/hash. Каждый изменённый key/text/path и before/after hash перечисляется в новом сравнении; blanket ignore system instructions запрещён. Examples, lore/history tuning и изменения #118–121 исключены из delta и остаются побайтно прежними. Если конкретный пример нельзя подчинить новой card/state без противоречия, зафиксировать его key как blocker для отдельной #121, не менять молча в #123. Вне allowlist равны user history/state (кроме profile-derived значений), memory, consent, events, model/settings и budget policy. Byte/selection differences из-за изменённой длины identity фиксируются с trace, не скрываются и не компенсируются изменением лимитов/истории. Freeze #116/#117 продолжает защищать все остальные блоки; #110 без dialogueTopic не становится поводом их изменить.
Документация #122 не пересоздаёт baseline и не меняет runtime. Offline сравнение подтверждает projection/boundaries, не качество речи; ответы/шесть оценок живых моделей остаются `NOT RUN` без отдельного разрешения provider/model/числа вызовов/бюджета. Сцены 5–7 дополнительно проверяются lifecycle-тестами silence/admission/late callback, а не только текстом ACK.

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


### Условная гипотеза кофе/чай (#113 → #114)

Форма/лимиты/validation и last-priority atomic block — [Backend Memory §8](../../docs/contracts/BACKEND_MEMORY_CONTRACT.md#8-гипотеза-кофечай-113). Это независимый optional ordinary-chat block только при `beveragePreference`; его отсутствие не добавляет instruction/data/schema guidance и сохраняет текущую #123 no-hypothesis baseline побайтно. Новый optional response schema key может объявляться только при allowProposal=true в enabled provider schema; recall-only allowProposal=false не включает proposal instructions/schema; required поля и disabled schema остаются прежними. Один provider call, никакого summary как evidence и продвижения гипотезы в факт. Current user correction приоритетна; профиль, quiet support, topic block/eligibility и frozen resources не меняются.

До runtime edits #114 сохранить отдельный offline before текущего #123 source/settings/hashes, затем after для тех же no-field сцен и enabled synthetic RU/EN вариантов. No-field reports должны совпасть по messages/payload/settings/selected blocks/budgets; для enabled варианта допустим только conditional beverage bundle/provider schema delta и trace его последнего приоритета. #117 архивы/source hashes и профильный delta #123 не переписывать и не расширять; исходники и новый comparison фиксируются отдельно. Structural lifecycle tests не доказывают качество semantic inference/речи; реальные calls не разрешены этим gate.
