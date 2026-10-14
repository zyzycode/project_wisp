# Context/Prompt Engine — первый этап

Поставка [#75](https://github.com/zyzycode/project_wisp/issues/75) расширяет существующий
server prompt flow. [Dispatch](../wisp_backend/api/dispatch.py) строит типизированные
блоки через scenario policy; [HTTPProvider](../wisp_backend/providers/http_provider.py)
отбирает их под активный профиль и передаёт существующему Groq/Gemini formatter.
Один endpoint по-прежнему выполняет не более одного inference без fallback/retry.
Wire v1/v2/v3, text-only touch/events, semantic validation и lifecycle остаются
по [API](../../docs/contracts/BACKEND_API_CONTRACT.md),
[memory §1–5](../../docs/contracts/BACKEND_MEMORY_CONTRACT.md),
[events](../../docs/contracts/AI_EVENTS_CONTRACT.md).

## Блоки и доверие

[ContextBlock](../wisp_backend/completion/context.py) хранит стабильный key, источник,
обязательность, приоритет отбора, порядок сериализации и сообщения. Больший priority
отбирается раньше; порядок отправки задаётся отдельно через order/key.

| Блок / источник | Обязателен | Priority / order | Содержание |
|---|---|---|---|
| Instructions / сервер | Да | 1000 / 0 | Существующие ограничения scenario, locale и правила доверия |
| Profile + state / desktop character | Да | 1000 / 10 | Единый неизменённый character snapshot: personality, needs, relationship, intimacy, tone |
| Memory / desktop selected projection | Для v2/v3 | 1000 / 20 | Вся уже ограниченная projection, включая корректные пустые массивы |
| Examples / сервер | Нет | 10 / 30 | Собственные краткие RU/EN примеры речи, отдельно от реальной истории |
| Previous initiative / desktop-reported AI phrase | Нет | 200 / 40 | Прежняя опубликованная фраза, не доказательство внимания или user fact |
| History pairs / desktop dialogue | Нет | 100 / 50+ | Пары user+assistant, отбор от новых к старым, отправка хронологически |
| Current user или event / desktop | Да | 1000 / 100 | Текущая реплика без обрезки либо actual event/touch variant |

Profile и state сохраняются одним атомарным блоком существующей projection;
отдельной изменяемой серверной личности нет. Bounded memory также атомарна:
backend не переоценивает desktop recall и не выкидывает исправленные facts ради
старой истории. Приоритет фактов остаётся: current explicit correction → current
registry facts → recalled episodes. Actual game outcome важнее старого эпизода.

Только server instructions имеют role=system; конструктор блока запрещает эту роль
любому другому источнику. Данные сериализуются в JSON под role=user, реальные
assistant turns сохраняют роль. Содержимое никогда не вставляется в system template.
Примеры явно помечены synthetic, не становятся реальными turns или памятью;
текущий character/consent важнее примера. Валидация memoryCandidates использует
исключительно исходную текущую user-реплику, не собранный prompt. Это структурные
границы и инструкции для модели, а не доказательство иммунитета LLM к injection.

## Бюджет и ошибка

[Профили оценки](../wisp_backend/providers/context_budget.py) задают локальный
потолок 16384 единицы для Groq `openai/gpt-oss-20b` и обоих существующих Gemini
профилей. Это консервативный рабочий предел Wisp, **не заявление о максимальном
context window провайдера** и не лимит частоты/расхода.

Сначала резервируется фактический output cap: min(server setting, scenario cap),
то есть до 4096 для chat/touch и до 1024 для events. Input allowance = 16384 − cap.
Оценка входа = число UTF-8 bytes сериализованного **итогового provider payload**
(JSON с escaping, roles, model settings и JSON-output format) + 256 + 64 × число
сообщений до объединения Gemini roles. Таким образом учитываются кодировка и
обрамление; wire UTF-16/32KiB caps не называются token count. Один byte считается
одной бюджетной единицей, framing резервируется отдельно. Это завышающая обычный
текст оценка без tokenizer dependency, не точный token count или математическая
гарантия для неизвестного tokenizer/скрытого server template. Изменение поддерживаемой
модели требует пересмотра профиля и тестов; нельзя автоматически выводить окно из
accounting reservation. Live token calibration в этой задаче не выполнялась.

Обязательные блоки резервируются целиком. Затем optional добавляются по priority;
при равенстве — от большего order, далее по key. Для истории первое непоместившееся
звено останавливает отбор более старых пар: сохраняется непрерывный суффикс.
Каждый кандидат проверяется в финальном формате API, а не как изолированный текст.
Ровно на границе блок помещается. Примеры исчезают раньше истории; если их места
достаточно после отказа крупной пары, они могут остаться. Частичного обрезания строк,
уменьшения output reserve или повышения роли нет. Входные объекты не мутируют.

Если обязательная часть не помещается, provider adapter **до HTTP dispatch**
возвращает существующий `503 upstream_unavailable`: валидный wire запрос невозможно
исполнить с серверным профилем. Это не `invalid_request` и не quota exhaustion.
Admission уже произошёл; одна принятая попытка и terminal replay сохраняются, usage
равен точно нулю, поскольку upstream не вызывался. В ошибке нет prompt/model internals.
Уложившийся запрос сохраняет общий deadline; время сборки вычитается из transport
timeout, истёкший deadline не разрешает сеть. Cancellation/shutdown и late usage
остаются в прежнем CompletionService. Payload/prompts не логируются и не сохраняются.

## Изученный источник и лицензия

SillyTavern изучен на commit
[`06bde939fb1e9c4c8d8641d810f0a916b5bce127`](https://github.com/SillyTavern/SillyTavern/commit/06bde939fb1e9c4c8d8641d810f0a916b5bce127)
(package 1.19.0). Документация
[Prompt Manager](https://docs.sillytavern.app/usage/prompts/prompt-manager/) и
[World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/) прочитана
2026-10-14; для алгоритмов источником служит закреплённый код.

| Источник | Переносимый подход / адаптация для Wisp |
|---|---|
| [PromptManager.js L80–163](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/PromptManager.js#L80-L163) | Identity, роль и placement раздельны; собственный immutable Python block добавляет закрытый source и required |
| [openai.js L3976–3986](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/openai.js#L3976-L3986), [L1210–1238](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/openai.js#L1210-L1238) | Context минус response reserve и отдельный framing; Wisp оценивает окончательный payload и не переносит upstream priming=3 как универсальную константу |
| [openai.js L947–955](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/openai.js#L947-L955), [L1070–1074](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/openai.js#L1070-L1074) | Новые сообщения отбираются раньше, рендер хронологический; Wisp удаляет целые пары и сохраняет текущую correction обязательно |
| [world-info.js L4590–4625](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/world-info.js#L4590-L4625), [L4993–5003](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/world-info.js#L4993-L5003) | Приоритет отбора и порядок вывода различны; Wisp использует стабильный source/priority/order вместо пользовательских sticky/source strategies |

Не переносятся JS runtime/UI, arbitrary system/character-card overrides, macros,
extensions, WI probability/recursive activation/sticky/cooldown и ignoreBudget.
Они требуют других источников/доверия, нарушают детерминизм или обходят общий budget.
WI per-class cap не нужен для уже bounded desktop memory. Документированный
constant-first не принят за инвариант pinned WI source: там source strategy и
sticky priority. Lore и summary не реализованы, пустых интерфейсов для них нет.

Upstream [package.json](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/package.json)
указывает [AGPL-3.0](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/LICENSE).
Это не permissive-компонент для копирования в текущий backend. Перенесены описанные
алгоритмические подходы самостоятельной реализацией; исходные строки кода,
prompt text/templates и assets SillyTavern **не копировались**. Поэтому upstream
license notices в runtime не добавлены. Прямой перенос кода потребовал бы отдельного
решения о применении AGPL и сохранения её лицензии/уведомлений; такого переноса нет.

## Приёмка и ограничения

Синтетические [selection tests](../tests/completion/test_context_budget.py) проверяют
равенство/переполнение, UTF-8/escaping, обязательные данные, отдельный порядок отбора,
непрерывность пар и запрет system role. [HTTP scenarios](../tests/api/test_context_prompts.py)
проверяют реальный dispatch всех пяти endpoints, отсутствие network при overflow,
нулевой usage/replay, Unicode history с reserve для Groq/обоих Gemini, adversarial
context и непринятие examples как evidence. Прежние lifecycle/contract/provider tests
продолжают проверять timeout/cancel, versions, actual outcome и text-only validation.
Существующий desktop integration bridge позволяет проверить restart memory и
quiet/reset/dispose/deadline с текущим backend без правки frontend.

Тесты устанавливают структуру и совместимость, не качество ответов реальной LLM.
Платные/provider calls, live оценка стиля, Windows product smoke, lore/summary,
планируемая v4 memory, новое хранение, квоты и routing не входят в поставку.
