# Аудит автономности Wisp и уточнение плана для менеджера

Дата: 2026-09-07. Проверенная база: `1e39e8ae68eed1ede0e74d307ed5133224d3dae5`.
Исходный working tree был чистым. Аудит заказан пользователем в текущем разговоре; GitHub Issue не назначена.

## 1. Вывод и границы проверки

Wisp уже имеет подключённые к Main автономные Explore/Rest, Activity timeline, маршруты по внешним поверхностям, cursor reactions, cooldown и ограниченную историю повторов. Разрабатывать эти подсистемы заново не нужно.
Основной пробел — связь между выбором занятия, его фактическим исполнением и последующим состоянием персонажа. Также отсутствует требуемый пользователем приоритет AI над локальным занятием.

Метод: чтение кода, прослеживание production wiring, чтение тестов и сопоставление с engine contracts. Проверены Domain/Application/Main, необходимые Renderer/Infrastructure boundaries и соответствующие тесты. Это аудит возможностей текущей версии, не review отдельного diff и не полный аудит безопасности проекта.

- `npm run typecheck`: PASSED.
- `npm test`: NOT RUN — AGENTS.md и инструкция reviewer запрещают запуск тестов этой ролью. Наличие теста ниже означает, что изучены его сценарий и assertions, а не подтверждён успешный прогон.
- Desktop-приложение не запускалось. Плавность, длительная стабильность, выразительность спрайтов и реальные OS-сценарии остаются предметом ручной приёмки.
- Продуктовый код, ассеты, конфигурация и внешние скоупы не изменены. Добавлен только этот отчёт.

Статусы: **подключено** — реализация вызывается production runtime; **частично** — есть рабочая часть, но не весь сценарий; **заготовка** — типы/функции есть, сквозной сценарий отсутствует; **не найдено** — реализация не обнаружена в проверенном `src/`. Ни один статус не заменяет desktop-приёмку.

## 2. Фактическая цепочка runtime

[Main composition root](../src/main/index.ts), `initializeShimejiMotionLoop` / `initializeAutonomyComposition`, создаёт Motion, MainAutonomyComposition и CharacterStateService boundary. Motion loop вызывает `autonomyComposition.tick()`; autonomy scheduler независимо планирует возможности выбора. Body input проходит Main validation и попадает в composition.

[AutonomyCoordinator](../src/application/services/autonomy-coordinator.ts) → [AutonomyCharacterEngine](../src/domain/character/autonomy-character-engine.ts) → [BrainActivityRuntime](../src/application/services/brain-activity-runtime.ts) → [ActivityRunner](../src/domain/behavior/activity-runner.ts) → Motion и Brain visual state.

Renderer потребляет Brain episodes; completion спрайта не управляет продвижением Activity. Этот принцип защищён [тестами ownership](../tests/renderer/autonomy-ownership.test.ts). Отдельный renderer-планировщик создавать не следует.

## 3. Матрица исходного плана

| Пункт | Статус и фактически существующая часть | Что действительно осталось |
|---|---|---|
| A: общий путь AI/local | Частично: provider mapper, Character gate и общий исполнитель уже есть; runtime подключает MockAIProvider | Приоритет AI, владение занятием, актуальность цели и безопасное прерывание; не создавать второй pipeline |
| B1: выбор по состоянию | Частично: idle/wander/sleep, vital sleep, needs-aware Explore likelihood и cadence | Полный Utility-арбитраж по контракту, новые допустимые источники локальных занятий, история на уровне выбора intent |
| B2: lifecycle | Подключено: последовательности, monotonic deadlines, locomotion completion, cancellation, stale run protection, cleanup | Расширение арбитража и прерывания по новым правилам; не переписывать Runner |
| B3: спокойное присутствие | Частично: idle и каталог micro motions; позы внутри Explore | Исправить потерю micro-motion выбора; самостоятельные спокойные Activity — отдельное расширение |
| B4: Explore | Подключено: цели, distance/state/surface scoring, inspect, позы, выход, история целей/маршрутов/хореографии | Настройка и desktop-приёмка; lifecycle feedback в Needs; при необходимости отдельный cooldown неудачных целей |
| B5: курсор | Подключено: freshness, зоны, вероятность замечания, gaze/head_tilt/point/reach/greeting, cooldown | Приближение/погоня/потеря интереса как многошаговый эпизод не реализованы; сейчас все Observe Cursor Activity стационарные |
| B6: игра/Zoomies | Частично: Zoomies chain, needs gates, cooldown, ручной/provider play | Локальный trigger выбора, передача gait до Motion, корректный feedback; не создавать Zoomies с нуля |
| B7: отдых/сон | Подключено: выбор места, маршрут, nap с wake, устойчивый sleep, восстановление энергии, click wake, support loss | Автоматический wake по attention отсутствует в tick; проверить замкнутую динамику Needs и параметры восстановления |
| B8: социальная инициатива | Не найден автономный SocialBid. Greeting существует как реакция на курсор при дружбе | Самостоятельная инициатива, ожидание ответа, завершение при игнорировании, budget/cooldown |
| B9: последствия | Частично: click/pet/feed/play/dialogue меняют Needs/Relationship; Motion feedback доставляется с дедупликацией | Результаты Activity не меняют Needs; игровой эффект применяется до admission; drag/landing metadata не меняет Needs |
| B10: характер/повторы | Частично: история Activity/actions/Explore; personality влияет на synthesized tone, friendship — на cursor reactions | Прямые personality factors в выборе занятий, разнообразие семейств, согласованные устойчивые предпочтения |
| B11: присутствие/quiet | Частично: время с последнего взаимодействия с персонажем, pause меню, autonomy enabled | Это не global user idle; нет return-сценария, устойчивого quiet-mode и общего бюджета инициатив |
| C: изменения среды | Подключены Motion/support invalidation, moving windows, cancellation и fallback | Реальная OS-приёмка; поддержка внешних окон Linux/macOS отсутствует; не дублировать существующие recovery paths |
| C: сохранение | Заготовка: ICharacterStateRepository и persisted DTO | Реализация repository, restore/save wiring, версия snapshot и политика времени отсутствия |
| D: диагностика | Частично: bounded decision trace в памяти, debug Needs/logs | Candidate reasons/factors, Activity outcomes, доступ к trace для аудита, session metrics |
| E: AI-тестирование | Частично: request ID/generation, timeout, reset/reload, late response и user/physics protection тестируются | Матрица AI-preemption и владения; target TTL, duplicate admission и возврат после AI-Activity |
| F: реальный AI | Заготовка: IAIProvider, MockAIProvider и работающий dialogue runtime | Реальный адаптер/настройки и контекст поведения; отдельный этап после стабилизации локальной жизни |

## 4. Подтверждённые пробелы и дефекты

### F1. Верхний выбор не реализует заявленный Utility-арбитраж

В `candidateSet()` [coordinator](../src/application/services/autonomy-coordinator.ts) только idle/wander/sleep. [Policy](../src/domain/behavior/autonomous-behavior.ts), `decideNextAutonomousAction`, выбирает по PRNG и nap probability; needs корректируют вероятность Explore. Вход policy не содержит полного контекста history/environment/personality для арбитража, описанного в [Autonomy contract](engine/AUTONOMY_ENGINE.md).

Это ограниченность текущего slice и расхождение с целевым контрактом, не доказательство ошибки самого PRNG. [Тест](../tests/domain/autonomous-behavior.test.ts) явно закрепляет три варианта. Локальный timer не создаёт `play`; cursor path передаёт собственный каталог Observe Cursor, исключая default Zoomies.

Доработка: использовать существующий Character decision owner; подключить согласованные кандидаты, hard gates и scoring. Добавление самостоятельной игры и SocialBid — развитие каталога, а не переписывание Explore/Runner. Проверять причины выбора, влияние history и недопустимость кандидата независимо от score.

### F2. Результаты занятий не замыкают цикл Needs

[BrainActivityRuntime](../src/application/services/brain-activity-runtime.ts), `recordTerminal`, обновляет repetition/cooldowns. [Main onTerminated](../src/main/main-autonomy-composition.ts) управляет сном, visual intent и cadence, но не передаёт результат Explore/Zoomies в Character reducer.

Напротив, [Main input handler](../src/main/index.ts), `handleAcceptedBodyEvent`, сначала вызывает `defaultCharacterInteractionUseCase.execute`, а потом `handleCharacterInteraction`. Поэтому пользовательский `play` снижает play/boredom/energy до проверки допуска Zoomies. Игра может быть отклонена, но эффект уже применён. Например, исходный boredom=80 превращается в 62 после user play, ниже Zoomies gate 75.

[Интеграционный тест Zoomies](../tests/main/autonomy-main-integration.test.ts) вызывает composition напрямую и использует snapshot fixture, поэтому не проверяет этот production-порядок вместе с CharacterStateService.

Доработка: согласовать какие эффекты относятся к самому контакту, а какие — только к выполненной игре; отделить admission от completion, применить outcome один раз. Добавить сквозной регрессионный тест input → CharacterStateService → Activity с отклонённым и завершённым play. Для Explore/Zoomies нужны явно утверждённые outcome-to-stimulus правила, не неявные новые deltas.

### F3. Gait Zoomies теряется на границе Main → movement

[Zoomies definition](../src/domain/behavior/activity-runner.ts) задаёт `gait: 'run'`, и BrainActivityRuntime передаёт его в locomotion request. Но callback `requestLocomotion` в [Main composition](../src/main/main-autonomy-composition.ts) для non-traversal оставляет только targetRootPosition; [coordinator.requestWander](../src/application/services/autonomy-coordinator.ts) всегда использует wanderSpeedPxPerSec.

Следствие: визуальный `run` не означает ускоренное обычное перемещение; в этом пути бег получает скорость прогулки. Текущий Main тест проверяет visual kind и факт вызова движения, а не различие скоростей.

Доработка: сохранить gait или разрешённую скорость через существующий locomotion port; проверить walk/run на уровне фактической команды и displacement, включая timeout и доступное пространство.

### F4. Выбор idle micro-motion не доходит до presentation

[Idle policy](../src/domain/behavior/autonomous-behavior.ts) сохраняет выбор `selectIdleMicroMotion` только в `intent.reason`. [Animation mapper](../src/domain/animation/animation-intent.ts), `mapBehaviorIntentToAnimationIntent`, этот reason не читает и строит output по kind/tone. Idle не имеет Activity в `selectActivityForResolvedIntent`.

Следствие: два micro-motion варианта одного тона дают одинаковые visual props в этом пути. Это конкретная потеря разнообразия до Skin, а не только проблема недостающих спрайтов.

Доработка: передать семантический выбор через согласованный mapping/Activity, не делать Renderer парсером diagnostic reason. Проверить два разных допустимых варианта одного тона до Brain visual state. Отдельно проверить, различимы ли они с реальными ассетами.

### F5. Sleep lifecycle существует, но wake и метаболизм требуют доработки

[Character gate](../src/domain/character/autonomy-character-engine.ts) умеет wake при attention>=90 и energy>=80. Однако [Main tick](../src/main/main-autonomy-composition.ts) сам инициирует wake только по energy; самостоятельного вызова по attention в проверенном runtime нет.

Восстановление во сне подключено через sleepy drift. Но [metabolism](../src/domain/character/metabolism.ts) зависит от tone и времени, не от реально выполняемого Explore/Zoomies. Все awake energy targets выше critical sleep threshold, а исходная energy=85. Без внешних затрат/нового feedback сам обычный дрейф не создаёт цикл «активность истощила до vital sleep».

Это не отсутствие сна: добровольный nap, user sleep и critical sleep с искусственно низкой энергией реализованы. Нужно отличать lifecycle от баланса состояния.

Доработка: подключить канонический attention wake, замкнуть activity feedback, затем проверить длительную динамику и настроить восстановление. Не менять sleep thresholds попутно. Нужен сценарий с настоящим CharacterStateService, а не только ручной заменой `needs.energy = 80` в fixture.

### F6. AI пока не первостепенный источник поведения

[offerDialogueIntent](../src/main/main-autonomy-composition.ts) возвращается без применения намерения при любой active Activity. Есть requestId и interactionGeneration protection, но нет замены локального занятия по AI-приоритету, отложенного admission и владения принятым AI-занятием.

Также `beginDialogueThinking` при свободном персонаже приостанавливает автономный scheduler до ответа, а уже активную Activity не останавливает. Требование «локальная автономность продолжает работать во время ожидания» выполнено лишь частично.

После `endThinking` scheduler возобновляется; source не хранится в Activity runtime. Поэтому нельзя считать реализованной гарантию «local pulse не заменяет AI-Activity». Нужна явная ownership policy.

[DialogueRuntime](../src/application/services/dialogue-loop.service.ts) уже имеет 15-секундный timeout, single-flight, validation, reset/generation и late result protection. Эти механизмы сохранять. [Тесты](../tests/application/dialogue-runtime.test.ts) фиксируют сохранение busy до settlement старого запроса даже после timeout — для реального зависшего провайдера это отдельный вопрос cancellation/recovery.

Доработка: сначала контракт приоритета относительно user/physics/critical needs и правила срока действия; затем тесты AI-during-Explore, safe interruption, local pulse during AI, stale target, duplicate intent и возврат к локальному выбору. Адаптер реального AI для этого не нужен.

### F7. Quiet, инициативы, присутствие и persistence нельзя считать готовыми

У [coordinator](../src/application/services/autonomy-coordinator.ts) есть enabled/menu/suspensions и lastUserActivityAtMs от взаимодействий с питомцем. Нет global idle/return policy или бюджета социальных инициатив. `quiet` существует как intent и [animation mapping](../src/domain/animation/animation-intent.ts), но не как длительный режим подавления инициатив; sleepy quiet даже выбирает визуальный sleep_loop без отдельного semantic sleep transition.

[CharacterStateService](../src/application/services/character-state.service.ts) стартует с default state, хранит состояние в поле класса. [ICharacterStateRepository](../src/application/ports/memory-repository.interface.ts) объявлен, но implementation и restore/save wiring в `src/` не найдены. Истории Activity/Explore и диалога тоже находятся в памяти процесса.

Доработка: отдельные задачи на новые локальные механики и persistence. Не описывать их как «подключить уже готовое сохранение». Сначала минимальный quiet/инициатива, привычки между сессиями — после сохранения и выбора по состоянию.

### F8. Диагностика и платформенные возможности уже есть, но ограничены

[AutonomyTraceEntry](../src/application/services/autonomy-coordinator.ts) содержит sequence/time/candidate kinds/outcome/seed; не содержит per-candidate eligibility, score factors, Activity result и tuning version. [Main debug telemetry](../src/main/index.ts), `getDebugTelemetry`, выдаёт Character/logs без этого trace. Production-потребитель `getDecisionTrace` не найден.

[External-window factory](../src/infrastructure/platform/external-window-surfaces.factory.ts) возвращает UnavailableWindowSurfaces для всех платформ кроме Windows. Геометрия рабочего стола и floor fallback — отдельная существующая возможность; наличие pure motion-тестов не означает поддержку окон Linux/Wayland.

Доработка: расширить внутренний trace вместе с Utility; публичный viewer/export — после согласования boundary. Проверять Linux-first fallback отдельно от Windows window routes. Реализацию Linux/macOS window observation выделять как отдельный платформенный scope, если потребуется.

### F9. Motion feedback доставляется, но часть его семантики теряется

[ShimejiMotionOrchestrator](../src/application/services/shimeji-motion-orchestrator.ts), `emitFeedback`, дедуплицирует события и вызывает mapper. [ShimejiStimulusMapper](../src/application/services/shimeji-stimulus.mapper.ts) передаёт drag и hard landing как user_drag_* / system_event с metadata. [Character reducer](../src/domain/character/stimuli-reducer.ts) нормализует их в `other` и не применяет Needs deltas из landingOutcome/heldMs.

Следствие: физическая и визуальная реакция существуют, но не подтверждают психологических последствий переноса/падения. Контракт swat completion есть, однако producer `swat_cursor_completed` в проверенном runtime не найден.

Доработка: согласовать нужные последствия и довести reducer/producer path; не дублировать уже имеющуюся Motion event deduplication. Отдельно различать дедупликацию одинакового event и ограничение частоты разных click/pet: общего diminishing-return механизма в CharacterStateService нет.

## 5. Что подтверждают существующие тесты

| Тесты | Изученные гарантии | Ограничение |
|---|---|---|
| [AutonomyCoordinator](../tests/application/autonomy-coordinator.test.ts) | Один timer, pause/resume, stale callback после disposal, needs-aware cadence, bounded trace | Не полный Utility и не AI ownership |
| [ActivityRunner](../tests/domain/activity-runner.test.ts) | Deadlines, locomotion completion, stale run/guard, P0/P1 cancellation, cooldown/repetition, Zoomies gate | Unit-контекст не подтверждает production feedback и скорость |
| [Explore](../tests/domain/explore-planner.test.ts) / [Rest](../tests/domain/rest-spot-planner.test.ts) | Target filtering, scoring, history, compatible poses, nap wake, floor fallback | Не desktop-приёмка и не длительный баланс потребностей |
| [Activity → Motion](../tests/application/external-activity-route.test.ts) | Реальные классы Activity/Motion с fake environment: окна, detour, disappearance, cancellation, nap | Не реальные Win32/Wayland окна |
| [Main autonomy](../tests/main/autonomy-main-integration.test.ts) | Wiring composition, sleep, Observe Cursor, Explore/Zoomies, bounded tick, late provider protection | Motion и tickNeeds замоканы; не весь input → reducer → selection цикл |
| [Cursor policy](../tests/domain/cursor-observe-policy.test.ts) / [refresh](../tests/renderer/cursor-observation-refresh.test.ts) | Stationary reactions, cooldown/repetition, freshness, bounded refresh и cleanup | Не реализованы движение к курсору и отдельный эпизод преследования |
| [Dialogue runtime](../tests/application/dialogue-runtime.test.ts) | Invalid input, duplicate/busy, timeout обеих await-стадий, reset/reload/dispose | Не AI-preemption и не реальный провайдер |

## 6. Исправленный порядок для менеджера

Пакеты ниже — предложения по scope, не созданные Issues. Менеджер должен сверить существующий backlog, чтобы не дублировать уже открытые задачи. Новые типы/DTO, source priority и изменения Character semantics требуют architect; локальные исправления по существующим контрактам — Fast-Track developer → reviewer.

1. **Минимальный контракт AI/local и Character feedback.** Закрепить admission/ownership/preemption, outcome semantics, текущие sleep invariants. Не внедрять реального провайдера и не переписывать все engine specs.
2. **Исправления существующих сквозных путей.** Раздельные небольшие задачи: F2 pre-admission play; F3 gait; F4 idle choice; F5 attention wake; F9 feedback semantics по утверждённому scope. Для каждого бага сначала падающий регрессионный тест у разработчика.
3. **Замкнутый локальный цикл.** Character feedback от выполненных занятий, затем Utility и минимальный самостоятельный выбор игры. Сохранить Explore/Rest/Runner. Приёмка с настоящим CharacterStateService: выбор → выполнение → изменённые Needs → иной последующий выбор.
4. **Настройка и наблюдаемость.** Дополнить trace факторами/отказами/результатами, провести детерминированные сценарии и desktop-сеанс. Не объявлять фиксированный seed ошибкой: отделить воспроизводимость тестов от желаемой вариативности сессий.
5. **Новые механики по одному vertical slice.** Самостоятельное спокойное занятие; затем приближение/игра с курсором; затем SocialBid и quiet/budget. Для каждой — admission, completion, cancellation, fallback, cooldown, feedback и доступные спрайты.
6. **Persistence и привычки.** Реализовать существующий repository port и versioned restore/save; не сохранять незавершённые движения, таймеры и AI-владение. После этого — любимые места и межсессионные предпочтения.
7. **Полная матрица AI arbitration.** Использовать существующий mock/runtime, добавить приоритет над Explore и защиту AI Activity от local pulse, TTL/target invalidation, возврат к локальной жизни. Тесты вводить по мере этапов 1–3, здесь закрыть остаток матрицы.
8. **Реальный AI.** Адаптер, настройки и поведенческий контекст. Время и причины запросов — отдельное решение; приоритет ответа не означает вызов модели на каждом pulse.

Не ставить задачами с нуля: ActivityRunner, Explore targets/choreography, RestSpot routing, cursor freshness/cooldown, moving-window attachment и базовый dialogue timeout/stale protection. Для них нужны конкретные доработки либо приёмка, а не повторная реализация.

## 7. Ручная приёмка и графика

Обязательные сценарии после исправлений: спокойный desktop-сеанс; бодрое/уставшее/перегруженное начальное состояние; отказ игры по cooldown; исследование и отдых на полу; Windows moving/disappearing window; Linux fallback; отсутствие и возврат input; поздний AI-result; выключение/включение автономности и меню.

Измерять не только отсутствие crash: время по семействам занятий, повторяемость маршрутов, частоту отмен/инициатив, случаи отсутствия прогресса и фактические изменения Needs. Пороговые значения согласовать в tuning, не выдумывать как уже утверждённые acceptance criteria.

Отдельно принять визуальную выразительность. В [cursor policy](../src/domain/behavior/cursor-observe-policy.ts) head_tilt/point используют thinking_loop, reach/greeting — wave; разные expression props не гарантируют разные жесты тела. [Реестр](art/SPRITE_REQUESTS.md) содержит запросы grab/jump/pull-up/sit-edge, но отдельных cursor-жестов в просмотренной таблице нет. Новые запросы регистрировать при реализации соответствующей задачи; этот аудит ассеты не меняет.

## 8. Передача

TASK: аудит текущей автономности относительно согласованного плана, без Issue ID.
CHANGES: только этот отчёт; продуктовых исправлений нет.
BOUNDARIES: Domain/Application/Main ownership сохранён; внешние скоупы не затронуты.
SPRITES: none — новые ассеты/запросы не создавались.
VERIFICATION: typecheck passed; тесты прочитаны, не запускались по правилам reviewer; desktop NOT RUN.
RECOMMENDED NEXT GATE: architect для новых правил AI/local и feedback; менеджеру — декомпозиция пакетов из раздела 6 с учётом существующего backlog. Аудит завершён, автономность не объявляется полностью готовой.
