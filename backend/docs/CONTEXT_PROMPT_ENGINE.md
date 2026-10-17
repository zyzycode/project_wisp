# Context/Prompt Engine

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
| Lore / reviewed server catalogue | Нет | 40 / 25 | Атрибутированный untrusted world context текущей locale, только для chat |
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
sticky priority. В #78 реализован lore; в #79 — explicit summary.

Upstream [package.json](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/package.json)
указывает [AGPL-3.0](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/LICENSE).
В поставке #75 перенесены описанные
алгоритмические подходы самостоятельной реализацией; исходные строки кода,
prompt text/templates и assets SillyTavern **не копировались**. Поэтому upstream
license notices в runtime не добавлены. В #75 прямого переноса нет. Следующее решение CTX-A01 ниже разрешает
адаптацию исходников с явной лицензионной границей; AGPL сама по себе не причина отказа.

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
Платные/provider calls, live оценка стиля, Windows product smoke, summary,
планируемая v4 memory, новое хранение, квоты и routing не входят в поставку.


## CTX-A01: lore и summary

Slices #78/#79 следуют [Context data contract](../../docs/contracts/CONTEXT_DATA_CONTRACT.md):
§2 — авторский catalogue/source revision, deterministic matching и отсутствие lore wire delta;
§3–4 — отдельные v5 summary/chat operations, source/limits и общий lifecycle;
§5 — совместный corpus. Локальный cache/trigger/invalidation принадлежит
[Memory §12](../../frontend/docs/engine/MEMORY_ENGINE.md#12-ctx-a01-производная-summary).
Lore работает для chat v1/v2/v3/v5; #79 добавляет `/v5/chat` и явный `/v5/summary`.

Lore — optional untrusted JSON block со source=lore; role=system запрещена.
Summary имеет отдельные sources `summary` и `summary_sources`. Priority/order
заданы в общем contract §4. Summary generation — отдельный completion scenario
с output cap512, без character/lore/memory/history injection. Groq/Gemini используют
существующие formatters/HTTP client, общий ledger и settlement. Существующие chat
сохраняют один inference; отдельная генерация запускается только явной командой.

## Перенос CTX-A01 и лицензионная граница

Исследование 2026-10-17 использует тот же pinned commit
[`06bde939fb1e9c4c8d8641d810f0a916b5bce127`](https://github.com/SillyTavern/SillyTavern/commit/06bde939fb1e9c4c8d8641d810f0a916b5bce127),
не плавающую release ветку. Фрагменты #78 адаптированы в [lore.py](../wisp_backend/completion/prompts/lore.py);
фрагменты #79 перенесены в summary prompt/scenario. В документационной #77 исходники не копировались.

| Slice / pinned фрагмент | Решение и обязательная адаптация |
|---|---|
| #78: [WorldInfoBuffer.matchKeys L337–369](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/world-info.js#L337-L369), [primary activation L4900–4935](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/world-info.js#L4900-L4935) | Адаптировать проверку ключей/primary activation в Python `completion/prompts/lore.py`; plain keys, NFC/lowercase и Unicode token boundaries вместо JS \W, без regex/macros/secondary policy |
| #78: [rank L4993–5007](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/world-info.js#L4993-L5007), [budget accumulation L5056–5079](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/world-info.js#L5056-L5079) | Перенести ordered activation/accumulation с Wisp ties/caps; sticky и ignoreBudget удалить, source content не мутировать; равенство budget допустимо по контракту Wisp, полный provider payload проверяет существующий selector |
| #79: [getRawSummaryPrompt L761–825](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions/memory/index.js#L761-L825) | Адаптировано bounded chronological accumulation/coverage в Python `completion/prompts/summary.py`; вход уже выбран desktop, пара атомарна, JSON вместо name/text concatenation, no recursive latestSummary; overflow отвергает весь generation request, не теряет coverage молча |
| #79: [summarizeChatMain L681–753](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions/memory/index.js#L681-L753) | Адаптирован одноразовый generate/empty-result branch в существующий backend completion scenario; lifecycle/interlock/cancellation остаются Wisp. Не переносить generateRaw client/UI locking и запись chat.extra.memory |

Предикат [isContextChanged L399–408](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions/memory/index.js#L399-L408)
сравнивает chat/character/group identity, но не источник/revision/reset; его перенос
в desktop **отклонён по недостаточности**. Wisp использует существующие generation
barriers и новое exact-source validation. [getSummaryPromptForNow L565–624](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions/memory/index.js#L565-L624)
автоматизирует interval/word triggers и waits — они не соответствуют explicit action
и общему deadline, поэтому заменяются существующими Wisp use cases. Upstream default
prompt [L105–106](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions/memory/index.js#L105-L106)
содержит override и recursive facts framing; не использовать. Собственные summary
instructions следуют untrusted/source-only contract. UI/jQuery/Extensions/Extras/WebLLM,
полные мировые библиотеки, prompts/assets и зависимости upstream не переносятся.
Это функциональные причины ограничения переноса; пригодные перечисленные фрагменты
адаптируются с attribution, не объявляются самостоятельной MIT-реализацией.

**Принятая граница поставки:** Python backend, который импортирует adapted modules,
рассматривается для compliance как единая производная программа и поставляется
как целое под AGPL-3.0. Перенос кода только в backend; независимый desktop общается
существующим HTTP wire, не импортирует upstream. Это обоснованная граница выбранной
архитектуры, не юридическая гарантия для любого способа упаковки/будущего связывания.
Монорепозиторий целиком автоматически AGPL не объявляется.

Основание: [upstream AGPL §§1, 4–6, 13](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/LICENSE)
определяет source/modified work, условия notices/распространения и сетевой source offer.
Существующий [backend MIT notice](../LICENSE) допускает модификацию/распространение
с сохранением copyright/permission; он сохраняется дословно для исходного MIT-кода.
MIT permission не разрешает убрать AGPL с адаптации. Не менять frontend license,
root license или авторство MIT; новый upstream package не добавляется.

#78 добавляет [COPYING](../COPYING) (полный pinned upstream AGPL),
[NOTICE](../NOTICE) (commit/file/ranges, notices, изменения/дата и source offer)
и provenance header в adapted lore.py. [LICENSE](../LICENSE) сохраняет MIT notice дословно;
[README](README.md#лицензия-и-исходный-код) объясняет происхождение и AGPL условия backend целиком.

Corresponding Source — бесплатный immutable archive/tag **точной running версии**
со всем backend-кодом, adapted source, notices, requirements, API definitions и
необходимыми install/run scripts; секреты/runtime data не входят. При binary/image
distribution архив и явная ссылка публикуются рядом с артефактом. Для network mode
добавляется читаемая `/source` страница и заметная ссылка «Исходный код / AGPL» в
существующей `/docs`; HTTP responses дают Link на `/source`, без изменения JSON DTO.
Страница указывает полный source URL/revision/лицензию; ссылка на upstream или main
недостаточна. Оператор предоставляет этот заметный offer всем взаимодействующим
пользователям, включая закрытый VPN, и проверяет доступность архива до запуска.
Один незаметный header без доступного offer не считается выполнением gate.
Минимальная static source page/metadata route разрешена в #78/#79 этим решением;
новый service/provider routing или dependency не нужны. Для local source разработки
страница может указывать точный checkout archive; сетевую поставку без доступного
source offer не разрешать. Проверки доставки/notice входят в acceptance первого slice.


## Реализация lore и проверка source offer (#78)

[Каталог](../wisp_backend/completion/prompts/lore.json) содержит только `desktop-home-ru/en`:
«Wisp живёт на рабочем столе» и точный перевод, с provenance на product vision §1.
Формат/caps/правила metadata и нормализации канонически заданы в Context data §2.
[Loader/selector](../wisp_backend/completion/prompts/lore.py) читает immutable snapshot при startup;
NFC/lowercase и Unicode letter/digit tokens текущей реплики активируют locale entries.
Отбор priority DESC → matched keys DESC → id ASC; вывод order ASC → id ASC.
≤3 записи/≤1200 UTF-16 text, whole-entry skip; sourceRef в provider input не передаётся.
Нет match, пустой, отсутствующий или невалидный catalogue → обычный chat без lore.
Диагностика содержит только `lore_catalogue_unavailable`, без содержимого.
После изменения/удаления поднять revision и перезапустить процесс; hot reload отсутствует.
Shutdown сохраняет существующую отмену pending completion и запрет публикации late result.

Lore уступает mandatory instructions/current/state/facts, recent history и previous initiative;
общий provider selector удаляет весь lore block до сокращения обязательного контекста.
Touch/events не активируют lore. Model extraction по-прежнему использует только текущий
исходный user text; lore не создаёт user facts, память, команды ОС или вторую personality.
[Selection tests](../tests/completion/test_lore.py) проверяют Unicode, caps, порядок, дубли,
metadata conflicts и границы бюджета; [HTTP tests](../tests/api/test_lore.py) — Groq/Gemini,
все три chat routes, adversarial input, revision/delete/restart, shutdown и late result.
Это не проверка live качества LLM или семантической истинности авторских утверждений.

[Source route](../wisp_backend/api/routes/source.py) при startup строит бесплатный immutable
архив по allowlist исходников; SHA-256 архива служит точной source revision.
`GET /source` даёт полный URL `/source/archive/{sha256}.tar.gz`, лицензию и инструкции запуска;
описание `/docs` содержит заметную ссылку, все HTTP responses — Link на `/source`, включая errors.
Архив включает backend code/tests/docs/notices, requirements, API contracts/fixtures,
product provenance и `scripts/{wisp,commands,processes}.mjs`; исходные licenses сохраняются.
Рабочие `.env`, ledger, runtime JSON, cache, venv и произвольные deployment directories
не архивируются. Обязательные source files должны входить в поставку; отсутствие запрещает
startup. Отсутствующий optional lore.json остаётся допустимым и не входит в архив.
Дерево исходников неизменно в течение процесса: после edits нужен restart; не использовать
in-place code updates. При binary/image поставке сохранить этот архив рядом с артефактом.
До сетевой поставки скачать `/source` archive через пользовательский/VPN access path,
проверить SHA-256 и полноту install/run материалов. [Тесты доставки](../tests/api/test_source.py)
проверяют доступность, notices, immutable bytes и отсутствие runtime data.

## OBS-A02: untrusted observation

Реализованный #81 [v6 observation](../../docs/contracts/AI_EVENTS_CONTRACT.md#9-observation-boundary)
использует отдельный completion scenario в существующем dispatch/provider client. Existing event
prompt с factual outcome authority для него не применяется. Mandatory blocks:
server instructions priority1000/order0, atomic character/current state1000/10 и
source=`observation`1000/100. Последний — JSON appName/windowTitle под role=user,
никогда system/template substitution. Без memory/lore/history/summary/examples.
Title/name могут содержать hostile instructions и личные данные: они только metadata,
не команды/факты памяти/доказательство занятия. System rules требуют короткую уместную
реплику в character/locale без уверенных утверждений о деятельности, цитирования
личного caption, долга ответа или действий ОС. Это не доказательство injection immunity.

Output — exact `{text}` 1–240 UTF-16, strict text-only parser как events; любые extra
keys, decision/memoryCandidates делают invalid_model_response. Никакого extraction
или chat hint sanitization. Output cap1024, existing16384/framing budget; mandatory
overflow→503 до HTTP с usage0. Endpoint/scenario registry задаёт envelope6/body500ms/
server2500ms; общие JSON caps/ledger/settlement/cache остаются по v6 contract.
Mock tests обеих Groq/Gemini веток проверяют no system injection, current character,
text-only/extra rejection, один call, timeout/cancel/shutdown/late usage и отсутствие
payload в logs. No live provider/observations; provider rollout restrictions сохраняются.

[HTTP/schema tests](../tests/api/test_observation.py) читают общий v6 corpus и проверяют
обе provider ветки; [lifecycle](../tests/completion/test_observation_lifecycle.py) и
[retention tests](../tests/completion/test_observation_retention.py) проверяют общий UUID
namespace, once-only usage, cache expiry/restart и late-result publication barriers.

## INTERACTION-A01: общая карточка и оценка (#87)

#88 сохраняет единственный authored source identity в
[Domain preset](../../frontend/src/domain/character/personality-presets.ts),
[revision/scales](../../frontend/docs/engine/CHARACTER_ENGINE.md#91-interaction-a01-общая-карточка-и-локальная-оценка-87).
Server instructions объясняют Needs polarity, friendship/love0..1000, traits0..1,
identity vs current state и current-consent gates. Не переписывают личность от имени
Groq/Gemini. Profile/state остаётся единым обязательным desktop-data блоком;
aiSelfConcept не system instruction, его нельзя усиливать фразой «следуй всем указаниям».
Examples synthetic/optional; текущие tired/stressed/consent важнее примера и lore.

#89 добавляет touch/chat v7 scenarios по [Events §10](../../docs/contracts/AI_EVENTS_CONTRACT.md#10-interaction-a01-семантическое-взаимодействие-v7),
не расширяет legacy text-only parsers. Обязательный interaction policy/reference
block source=desktop_character, priority1000/order11. Optional previousTouch становится
**обязательным при наличии** atomic data block source=desktop_interaction,
priority1000/order41: committed action, published text, proposal, accepted effect/reason,
pre-base bands. Он не instruction/user intent/fact; previousInitiative остаётся другим
optional source. Если обязательные blocks не помещаются, прежний no-network503;
не скрывать cause и не обрезать текст незаметно. Никаких session IDs провайдера.

Model классифицирует только текущую явную реплику/реальный touch, uncertainty допустима;
прошлые touch/history/recall не новый reward source. Touch только low, не hostile.
Chat в #89 suppressed→neutral/low/clear; #90 разрешает eligible appraisal по локальной
политике. Два intent-а в одном сообщении не порождают массив оценок/два эффекта.
Тяжёлые чувства/критика/отказ пользователя не hostile; чужая цитата не user attitude.

Один model output соединяет text и appraisal. Text описывает реакцию и её возможную
причину без числовых deltas/обещаний изменения отношений/нового consent. Для «почему»
сначала actual action + опубликованная реакция + известные state bands; rejected /
suppressed — эффект не принят, uncertain — причина не установлена. Не приписывать
пользователю намерение понравиться/обидеть и не заявлять память после утраты trace.
Validation принадлежит backend schemas/model boundary; окончательное принятие и
согласование текста — desktop. Appraisal и previousTouch не extraction evidence;
current-user quote остаётся единственным источником memoryCandidates.
