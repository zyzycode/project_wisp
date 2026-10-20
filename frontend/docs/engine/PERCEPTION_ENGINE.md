# Контракт Perception Engine

Gaze, cursor proximity/freshness и normalized environment observations; без Activity/semantic/motion decisions. Координатные primitives `MonotonicMs`/`WorldPx`/`SourcePx`/`Vector2Dto`/`ScreenBoundsDto` — [Motion §2](MOTION_ENGINE.md#2-координаты-и-базовые-dto).

## 1. Владение

Gaze Engine — pure pupil offset/tracking/neutral/visual freshness, вызываемый Body на RAF. Cursor Proximity (Domain) — normalized distance/range/dwell. Environment adapter (Infrastructure) — OS display geometry → immutable EnvironmentSnapshot.

Body показывает gaze локально и refresh-ит cursor_observed до 10 Hz независимо от RAF ([UI cadence](UI_SPEC.md#63-cadence-и-coalescing)). Application ставит Main receive time; Brain использует proximity для P3 eligibility. [Ownership](README.md#3-граф-зависимостей-и-поток-данных-между-движками).

Main также читает глобальную позицию через `IPlatformAdapter.getCursorScreenPosition()` раз в ≥100 ms из существующего Brain tick, без отдельного таймера. Windows/macOS/X11 используют [Electron getCursorScreenPoint](https://www.electronjs.org/docs/latest/api/screen#screengetcursorscreenpoint), который уже возвращает DIP; повторное масштабирование запрещено. Wayland/ошибка/невалидные координаты → `null`. Свежий глобальный источник имеет приоритет над Body events; при недоступности остаётся локальный Body fallback для stationary Observe Cursor, без старта chase. Потеря глобального источника инвалидирует его sample, stale не продлевается. Курсор вне ambient зоны не создаёт Activity и не расходует initiative budget.

## 2. Поток perception

OS/platform + BodyEventDTO cursor → boundary normalization → EnvironmentSnapshot → proximity → Brain eligibility / Motion support. Body cursor + presentation geometry → gaze → PupilOffset.

Main передаёт последний глобальный sample в optional `BrainStateDTO.globalCursor`
через существующий typed state stream. Absent/null означает недоступный источник;
координаты finite DIP, `capturedAtMs` конечен и лежит в `[0, sampledAtMs]`.
Опрос до 10 Hz не зависит от включения wander или открытого меню: эти gates
ограничивают поведение, а не доступность взгляда. Наблюдения живут только в памяти,
не сохраняются и не передаются серверу; reset/dispose очищает sample.

Body один раз при приёме snapshot переводит возраст `sampledAtMs - capturedAtMs`
в локальную monotonic шкалу. RAF и local reflex revisions не обновляют timestamp.
Глобальный sample приоритетен; `pointerleave` очищает только локальный fallback.
При остановке state stream глобальный sample истекает по TTL; Body не возвращает
ему свежесть из старых координат. При отсутствии глобального источника доступный
локальный cursor подтверждается bounded presence refresh. Gaze разрешён во время
обычного движения и при выключенном wander; sleep/drag выключают его отдельно от
eligibility игры. Явное выражение лица реакции сохраняет приоритет.

Environment — observation, gaze — presentation, proximity — signal; ни один не BehaviorIntent/AnimationIntent и не команда.

## 3. Gaze DTO и контракт взгляда

Типы и конфигурация Gaze Engine определены в [src/domain/behavior/gaze-engine.ts](../../src/domain/behavior/gaze-engine.ts).

- **Допустимые диапазоны смещения зрачка**: $dx, dy \in [-1.0, 1.0]$.
- **Deadzone и clamped circle**: в deadzone desired offset равен $(0, 0)$; вне deadzone результирующий вектор смещения зрачка ограничивается кругом единичного радиуса ($r = \sqrt{(dx/maxOffsetX)^2 + (dy/maxOffsetY)^2} \le 1.0$).
- **Валидация**: `scale` и smoothing time $> 0$; остальные значения неотрицательны; `attentionRadiusWorldPx > deadZoneSourcePx × scale`. Нормализованные max offsets фиксированы равными 1.

## 4. Gaze normalization

Для cursor target используется `sample.globalPosition`, для world point — его `globalPosition`:

```text
dx_world = targetGlobal.x - rootGlobal.x
dy_world = targetGlobal.y - rootGlobal.y
dx_source = dx_world / scale
dy_source = dy_world / scale
dx_local = (flipX ? -dx_source : dx_source) - gazeOriginSourcePx.x
dy_local = dy_source - gazeOriginSourcePx.y
d = sqrt(dx_local² + dy_local²)
strength = clamp(
  (d - deadZoneSourcePx)
  / max(attentionRadiusWorldPx / scale - deadZoneSourcePx, ε),
  0,
  1
)
```

В dead zone desired offset равен `(0,0)`. Иначе:

```text
desired.x = (dx_local / d) × maxOffsetX × strength
desired.y = (dy_local / d) × maxOffsetY × strength
r = sqrt((desired.x/maxOffsetX)² + (desired.y/maxOffsetY)²)
if r > 1: desired = desired / r
alpha = 1 - exp(-max(deltaSec, 0) / smoothingTimeSec)
offset(t+dt) = offset(t) + alpha × (desired - offset(t))
```

`flipX` применяется ровно один раз. Missing, stale (`nowMs - capturedAtMs > maxCursorAgeMs`) или out-of-radius cursor задаёт desired `(0,0)` и smooth return to neutral.

При полном SVG transform Body передаёт `sourceFromWorld` — обратную линейную
матрицу общей [проекции](../../src/renderer/render-engine/sprite-projection.ts).
Она уже включает отражение, rotation, scaleX/scaleY и `xMidYMid meet`; повторный
flip запрещён. Render, gaze и anchor marker используют одинаковые pivot и
letterboxing. Anchor текущего body frame сначала переносится в viewport с учётом
frame pivot/offset. DOM bounds кешируются до resize/scroll/изменения размера;
движение окна учитывается через актуальный screen origin без layout read на RAF.

Gaze не emits Activity/AnimationIntent. При baked-in face Body может не показывать pupil layer, не подавляя отдельный bounded-refresh `cursor_observed` для Brain proximity.

Для совместимого overlay-body Skin использует пару `face_gaze_base` и
`pupils_gaze`. Сглаженный (120 ms) дробный offset доходит до отдельного слоя
радужек: предел ±2 source px по X и ±1 по Y подтверждён
[визуальной проверкой](../../asset-pipeline/references/GAZE_RIG_2026_10_QA.md).
Body передаёт offset непосредственно renderer-local pupil handle; меняется только
SVG transform слоя, без React state/IPC на каждом RAF. При отсутствии/ошибке пары
используется прежний `face_gaze`; discrete направление имеет гистерезис 15%.
При длине offset <0.01 выбирается neutral (центр пары либо обычный face fallback),
а не взгляд вниз. Emotional override и baked-in лица не получают второй слой глаз.

## 5. Cursor proximity DTO (Близость курсора)

Типы и контракт сигналов близости курсора определены в [src/domain/behavior/gaze-engine.ts](../../src/domain/behavior/gaze-engine.ts).

### Зоны близости курсора

| Зона | Дистанция | Назначение |
|---|---|---|
| `contact` | $\le 48\text{ px}$ | Непосредственный физический контакт / реакция swat |
| `near` | $\le 160\text{ px}$ | Близкое присутствие курсора |
| `ambient` | $\le 360\text{ px}$ | Фоновое наблюдение и внимание |
| `far` | $> 360\text{ px}$ | Вне зоны внимания / нейтральное состояние |

- **TTL свежести**: `300 мс` (сигналы старше TTL считаются устаревшими и сбрасывают dwell).

Body refresh interval `100 мс` строго меньше TTL и повторно подтверждает даже неподвижный доступный cursor sample. Поэтому непрерывное присутствие внутри зоны может накопить `swatDwellMs=450`; после остановки refresh Brain сбрасывает dwell, как только Main age последнего sample превысит 300 мс. Timer stall не компенсируется catch-up событиями: если age уже превысил TTL, обычное stale rule сбрасывает dwell до обработки следующего fresh interval.

## 6. Freshness, dwell и reaction signal

Initial state: `{ withinSwatRange: false, dwellWithinSwatRangeMs: 0, updatedAtMs: nowMs }`.

```text
fresh = cursor exists
    AND 0 <= nowMs - capturedAtMs <= signalMaxAgeMs
distance = world distance(rootGlobalPosition, cursor.globalPosition)
within = compatible AND fresh AND distance <= swatRadiusWorldPx
elapsed = max(0, nowMs - previous.updatedAtMs)
dwell' = within
  ? (previous.withinSwatRange ? previous.dwellWithinSwatRangeMs + elapsed : 0)
  : 0
```

Missing cursor возвращает no signal. Stale, out-of-range или incompatible input сбрасывает dwell. Engine не хранит timer или иной hidden state.

Существующий reaction gate:

```text
withinSwatRange
AND dwell >= swatDwellMs
AND signalAge <= signalMaxAgeMs
AND cooldown expired
AND context/personality/needs allow
AND state compatible
```

Starting thresholds сохраняются: `swatRadiusWorldPx=64`, `swatDwellMs=450`. Cooldown semantics определены только в Activity contract; Character values — только в Character contract.

Dwell сбрасывается при exit/stale/missing/incompatible state. Perception подавляет сигнал при `dragged`, fall lifecycle, land lifecycle, crash/recover и sleep visual lifecycle. Названия visual states здесь являются consumer compatibility list, а их transitions принадлежат Animation Engine.

Look-at остаётся gaze. Swat/avoid — local P3 Activity decisions и не стартуют внутри Perception.
Ограниченный cursor interest подчинён
[общему admission/budget](AUTONOMY_ENGINE.md#13-auto-a09-локальная-жизнь-и-ненавязчивость).

### 6.1. Cursor game v1: ограниченное преследование

Расширение существующего `cursor_interest` (#48): stationary Observe Cursor сохраняет gaze/gesture; игра внутри `play` требует freshness/dwell, Character gates, cooldown и общий initiative budget. Fatigue может оставить только gaze; P2/AI ownership запрещают новую local Activity. Внешний AI API для samples не вызывается. Никаких global hooks для захвата мыши, перемещения/блокировки системного курсора или кликов за пользователя.

Допуск игры использует существующий fatigue gate Observe Cursor (`energy >35`, tone не sleepy), без отдельного требования friendship≥100 или play≥50. Friendship/Needs влияют на вероятность заметить курсор; начальное состояние нового персонажа не исключает игру. Локальный calm с idle/look-around допускает P3 reaction; user/provider-owned Activity защищена. Пока свежий достижимый курсор накапливает swat dwell, не запускать конкурирующий Observe Cursor и не расходовать его cooldown. После dwell и notice выбирать игру без второго случайного veto. Проверка: [startup scenarios](../../tests/main/cursor-game-startup.test.ts) с реальными defaults и 10-Hz samples.

В cursor-game-v1 разрешён ограниченный retarget **только между завершёнными grounded locomotion legs**: не чаще одного раза в 500 ms, максимум четыре цели вместе с первой, новая цель отличается от прошлой минимум на 20 DIP. Samples обновляют наблюдение, а не заменяют активную Motion command. Один run/deadline 6000 ms и общий пройденный путь ≤160 DIP, без сброса при retarget. Значения — [CursorGameTuning](../../src/application/ports/cursor-game-contract.ts); прежние одноимённые пределы InitiativeTuning берутся из того же tuning, не два независимых лимита.

Travel budget считает сумму абсолютных voluntary перемещений вдоль опоры, включая смену направления; перенос самой опорой не расходует его. Между legs до retarget interval допустим bounded stationary wait, если остаётся время на следующий leg и хвост фаз; иначе missed. Sample не продлевает wait/deadline. Пороги и общий лимит проверяются до каждой Motion command, а не после выхода за границу.

Цель лежит на той же достижимой `screen_floor`/`window_top` опоре; проекция cursor x ограничена usable support bounds, collision insets и оставшимся travel budget. Cursor y от root ≤160 DIP; недостижимая цель или отсутствие usable support запрещают approach. Walk использует существующий Motion planner. Chase jumps, смена опоры и новые locomotion primitives вне v1. Перемещение самой опоры обрабатывает Motion; topology/identity loss прекращает игру. Стоячая попытка допустима при уже достигнутом reaction gate без лишнего approach.

Для начала попытки используются существующие `swatRadiusWorldPx=64`, dwell=450 ms и TTL=300 ms (§6), без второй геометрии по визуальному спрайту. Perception сообщает только fresh/within/dwell; поимку определяет Activity в момент semantic checkpoint. Cursor исчез/устарел/вышел из ambient зоны/недостижим → `lost_target`; user/forced physics/quiet/menu/disable/reset/dispose → `cancelled`. Граница deadline имеет приоритет перед поимкой. Исходы и once-only feedback — [Activity §17](ACTIVITY_ENGINE.md#17-cursor-game-v1).

Windows — первая платформа приёмки. Источник глобальных samples остаётся за текущей platform boundary и нормализацией DIP; Body refresh ≤10 Hz и Main TTL сохраняются. При недоступном источнике нет выдуманных координат или игры из последнего sample; на Linux/macOS без нужной capability остаются stationary gaze при доступном input и обычная screen-floor автономность. Smoke: 100/150/200% DPI, отрицательные координаты и несколько мониторов, смена display, выход из окна Wisp, stale input и исчезновение опоры. Runtime не переносит `process.platform` в Application/Domain/Renderer.

## 7. Normalized environment signals

Типы: [surface-kinematics.ts](../../src/domain/behavior/surface-kinematics.ts). Immutable snapshot выбирает usable work area и нормализует OS limitations; missing cursor/surface = unavailable observation. Test/production форма одинакова, без handles/PID/z-order/platform-source names/DOM/callbacks. Native metadata не выходят из Infrastructure.

Perception сообщает `isValidSupport`, Motion решает support_lost/physics; environment не создаёт intent.

## 8. Environment IPC boundary

[ipc-contracts.ts](../../src/shared/ipc-contracts.ts) — standalone serializable DTO без Domain imports; Main mapper: `EnvironmentSnapshotDTO <-> EnvironmentSnapshot`. AUTO-A07 добавляет target `side`; developer подключает mapper/stream вместе с реализацией. Здесь зафиксирован screen-only runtime на момент gate, не подтверждение готовности внешних опор.

## 9. Изоляция и проверяемые свойства

Pure updates по explicit inputs/constraints; freshness по monotonic `nowMs`, не `Date.now()`; missing/stale не продолжают dwell; flipX ровно один раз. Adapter отдаёт normalized immutable snapshot. Body считает только local gaze freshness, semantic freshness/proximity — Brain по Main receive time. Gaze не запускает Activity, proximity не resolved behavior, support transition — Motion.

## 10. Внешние окна — целевой контракт AUTO-A07

Target implementation contract, не утверждение runtime readiness. [ExternalWindowSurfacesPort](../../src/application/ports/external-window-surfaces.port.ts) отделён от Electron-aware `IPlatformAdapter`. Infrastructure отдаёт полный набор, Application выбирает currentSurface для Motion; Renderer опору не выбирает.

### Модель и capability

[ExternalWindowSurface](../../src/domain/behavior/surface-kinematics.ts) — discriminated union:

| Поле | Инвариант |
|---|---|
| `id` | Непрозрачный ID конкретной кромки, уникальный на срок жизни приложения; не HWND/PID, не их строка или hash. |
| `kind` | `window_top` либо `window_side`. Нижняя грань окна не поддерживается. |
| `bounds` | Видимый frame rectangle в глобальных DIP: конечные x/y, width/height > 0. Отрицательные x/y допустимы. |
| `supportY` | Только для `window_top`, обязательно равно `bounds.y`. Верх от x до x + width. |
| `side` | Только для `window_side`, обязательно `left` или `right`; x равен bounds.x либо bounds.x + width, y от bounds.y до bounds.y + height. |
| `isValidSupport` | true только для прошедшей все проверки кромки; false никогда не становится опорой. |

Window top/floor используют общий behavior/pose selection (walk/observe/sit/rest/sleep); тип опоры не даёт бонуса target selection/отдельной arrival Activity. Геометрия ограничивает routes/walking; опускание top вызывает fall, остальные move — follow по [Motion §7.1](MOTION_ENGINE.md#71-lifecycle-внешней-опоры--целевой-auto-a07).

До трёх edges с разными IDs на окно; immutable full replacement, не delta. `revision` строго возрастает в экземпляре порта, включая unavailable/recovery; меньшие/повторные игнорируются. `capturedAtMs` — Main monotonic **request-start**, не delivery/helper time; cache read timestamp не освежает.

- Windows/macOS available только после complete valid sample; пустой массив = нет подходящих окон.
- Startup: `unavailable/initializing`; timeout/parse/API failure/запрещённый bridge: `unavailable/bridge_failed`; TTL: `unavailable/stale`.
- Linux Wayland/X11: `unavailable/unsupported`, пустые external surfaces; screen-floor/work-area продолжают работать.
- Любой unavailable несёт пустой массив, не заменяет screen capability/не выдумывает geometry. Recovery available не делает auto-reattach.
- Cache read синхронен, subscribe отдаёт full ordered snapshots; Main владеет lifecycle, dispose останавливает helper/sampling/callbacks.

### Filtering и приватность

Только видимые прямоугольные окна текущего interactive desktop; платформенные критерии macOS — ниже. Windows bridge проверяет `EnumWindows`, `GetAncestor(GA_ROOT)`, `GetWindow(GW_OWNER)`, styles, `IsWindowVisible`, `IsIconic`, DWM attributes.

На Windows исключить:
- child/owned/disabled/custom-region; `WS_POPUP`, `WS_EX_TOOLWINDOW`, `WS_EX_NOACTIVATE`, `WS_EX_TRANSPARENT`, `WS_EX_LAYERED` (borderless/translucent могут не поддерживаться);
- все Wisp windows/processes, включая helper/menu/devtools;
- desktop/shell: `GetDesktopWindow`, `GetShellWindow`, `Progman`, `WorkerW`, `Shell_TrayWnd`, `Shell_SecondaryTrayWnd`;
- menu/tooltip/dialog: `#32768`, `tooltips_class32`, `#32770`;
- invisible/minimized/`DWMWA_CLOAKED != 0`, вне work area, недоступные для проверки.

Titles не запрашивать; handles/PID/classes/styles не выводить из Infrastructure в Domain/Renderer/trace/persistence/errors.

Visibility не гарантирует отсутствие occlusion. Любое пересечение edge прямоугольником более высокого visible non-cloaked окна (включая transient, исключая Wisp) удаляет **всю** кромку. Частичные сегменты не строятся; неизвестная occluder geometry проваливает sample. Z-order внутренний; pixel-perfect occlusion/secure desktop не обещаются.

### Identity, sampling и geometry

Private native lifetime→opaque token; edge IDs производны только от token. Move/resize сохраняют ID; destroy/пропуск в полной выборке/minimize/hide/filter-out/bridge restart навсегда удаляют token. Возвращённое окно получает новый.

HWND reuse между poll требует lifecycle create/destroy через `SetWinEventHook` + message loop. Потеря непрерывности сбрасывает identity epoch; poll-only HWND identity запрещена. Callbacks только инвалидируют/инициируют sample, не задают geometry. Реализация tracking вне AUTO-A07.

Полная выборка ≤10 Hz, один in-flight, без catch-up queue. Invalidation может сразу снять опору, положительная geometry — только из complete sample. TTL: `0 <= nowMs - capturedAtMs <= 300` ms; stale не используется даже при hung helper, recovery требует нового sample. Request budget 250 ms; negative age/partial-corrupt response/sequence gap/topology change во время выборки инвалидируют её.

Windows frame source: `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)` physical pixels; `GetWindowRect` не эквивалентен (DPI virtualization/invisible resize borders). Frame пересекает **ровно один** physical display; spanning исключён. AUTO-V01 допускает body окна за внешним краем desktop, если edge полностью внутри workArea; bounds сохраняются без clipping.

Windows Infrastructure ровно один раз применяет `screen.screenToDipRect(null, rect)`; нельзя делить global x/y на scaleFactor или брать display Wisp вместо display frame. Edge целиком в workArea своего display, clipping с ложной кромкой запрещён. Разные окна могут иметь разный DPI; глобальные DIP согласованы со ScreenBoundsDto. Перед commit Application выбирает bounds того же display и проверяет root/insets.

`display-added/removed/metrics-changed` инвалидируют все external supports и previous follow baseline до нового full sample. Ошибка normalization → unavailable.

### macOS observer (#95)

Один постоянный `/usr/bin/osascript -l JavaScript` helper с фиксированным bundled JXA source, Foundation/CoreGraphics и AppKit; без npm-зависимостей, компиляции, Xcode/CLT, AX/System Events и Apple Events к чужим приложениям. [JXA bridge](https://developer.apple.com/library/archive/releasenotes/InterapplicationCommunication/RN-JavaScriptForAutomation/Articles/OSX10-10.html) вызывает `CGWindowListCopyWindowInfo(onScreenOnly | excludeDesktopElements, 0)`. [Apple о metadata/permissions](https://developer.apple.com/videos/play/wwdc2019/701/): bounds/ID/PID доступны без Screen Recording; разрешения не запрашивать, изображения не получать, window/owner names и sharing state не читать и не требовать.
Helper передаёт только opaque tokens, bounds и доступные edges; native IDs/PID/layer/alpha остаются внутри него. Окна regular applications (`NSRunningApplication.activationPolicy`) с layer=0, alpha=1, valid bounds — кандидаты; Wisp PID family и helper исключены. Invisible/minimized/другие Spaces не попадают в on-screen sample. Все остальные видимые non-desktop окна с alpha>0, включая panels/menu/translucent, остаются occluders; z-order — порядок front-to-back API, перекрытая кромка удаляется целиком. Неизвестная нужная geometry/повреждённая запись инвалидирует sample. Metadata не различает все sheet/dialog/custom-shape роли: layer-0 окно regular app трактуется по bounding rectangle, pixel-perfect/AX role filtering не обещаются.
Identity: private `(CGWindowID, ownerPID)` → случайный opaque token в helper epoch; [Apple определяет ID уникальным в user session](https://developer.apple.com/documentation/coregraphics/kcgwindownumber). Move/resize сохраняют token; отсутствие/filter-out в complete sample, смена PID, restart/ошибка/потеря session continuity удаляют token. macOS использует эту session identity и polling, не Win32 hooks; краткие hide/restore между samples не наблюдаемы. Recovery не восстанавливает attachment. Sequence/request ID, лимиты payload/количества окон, 10 Hz/250 ms/300 ms и один in-flight — как у Windows; startup ≤10 s без available, retry после failure ≥1 s, late callbacks старого child/после dispose отбрасываются.
`kCGWindowBounds` использует [screen space с origin сверху слева main display](https://developer.apple.com/documentation/coregraphics/kcgwindowbounds). macOS logical points передаются как global DIP: без Y-flip AppKit, умножения/деления на Retina scale или Windows `screenToDipRect`. Проверка against Electron display.bounds/workArea обязательна; spanning исключён, edge целиком в workArea, отрицательные координаты допустимы. Display topology/metrics и wake/session discontinuity сбрасывают epoch/in-flight до нового complete sample. Unsupported API/bridge failure → пустой unavailable, локальный runtime продолжает работу; отсутствие метаданных не лечится permission prompt.
Main проецирует capability в optional `BrainStateDTO.externalWindowSupport`: available/initializing/unsupported либо unavailable для bridge_failed/stale. Existing Brain stream и его validators/mapper переносят только этот enum, без native metadata. В обычном ContextMenu показывать состояние окон и fallback «Окна недоступны — используются границы экрана»; отсутствие поля означает неизвестный статус, не available. Linux unsupported отличается от временного сбоя; available с пустыми surfaces не объявлять ошибкой. IPC/Renderer не выбирают опоры.
Native приёмка: macOS arm64 без Screen Recording/Accessibility/Automation grants и без CLT; обычные окна, Wisp/devtools, menus/occlusion, hide/minimize/close/Spaces, move/resize/downward-stop; Retina + mixed-DPI/negative origins/second display, sleep/wake/disconnect, helper restart/dispose. Мок-тесты не подтверждают JXA bridge и geometry на Mac; обязательный native smoke фиксируется отдельно, без заявления готовности по одним unit tests.

### Dependency Review: Win32 bridge (2026-09-06)

**Approved: системный Windows PowerShell 5.1 + собственный C# P/Invoke helper, без новой npm-зависимости.** Это архитектурное разрешение Windows-first observer с fallback, не измерение готовой производительности.

Один child process на lifecycle, не на poll. `Add-Type` только для read-only User32/Dwmapi + lifecycle hook; `child_process.spawn` из Main, bridge/paths/OS branches только в `frontend/src/infrastructure/platform/`.

Executable из system directory через `path.join`; shell=false, fixed bundled script, `-NoProfile -NonInteractive`, hidden window. Без dynamic titles/IPC code, elevation, ExecutionPolicy bypass, downloads/сторонних modules. Add-Type denied/missing executable/unsupported environment → unavailable без обхода policy; shutdown завершает helper.

Bounded newline JSON: token/physical geometry, без handles/PID. До публикации Infrastructure валидирует schema, ≤512 records, ≤256 KiB и deadline. Превышение → unavailable, не partial sample.

| Критерий AGENTS.md | Оценка |
|---|---|
| 1. Лицензия | Собственный helper под лицензией проекта MIT. PowerShell 5.1/.NET/Win32 используются как компоненты установленной Windows, не распространяются с приложением; permissive npm license gate не применим. |
| 2. Размер/transitives | Добавлено 0 npm packages и 0 transitives, bundlephobia/npm trends неприменимы. Helper source будет bundled в реализации; цена отдельного PowerShell процесса и startup ненулевая и требует Windows измерения. |
| 3. Активность/CVE | npm release-last-year/CVE gate неприменим: нового пакета нет. Windows PowerShell обслуживается в lifecycle ОС, новых features не получает. Нулевые CVE установленной ОС не заявляются; нужны поддерживаемая обновлённая Windows и её security servicing. |
| 4. Native bindings | Нет Node C++ addon/node-gyp или Electron ABI rebuild; P/Invoke остаётся native interop в отдельном системном процессе. Pure JS/WASM не предоставляет User32 enumeration/hooks. |
| 5. Альтернатива 50–100 строк | Узкие P/Invoke declarations возможны без общего FFI package; полный безопасный observer с lifetime/timeout/filtering больше 100 строк. Это не причина тащить универсальный addon: выбирается собственный ограниченный helper с явным runtime fallback. |

`package.json`/lockfile не меняются; Koffi/ffi-napi не одобрены, требуют отдельного Dependency Review. Обязательные Windows smoke: packaged helper discovery/shutdown/Add-Type denied/timeout/HWND reuse/mixed DPI 100/150/200%/spanning/occlusion/move-resize-minimize-close; Linux screen-only regression.

Не укладывается cadence/TTL → unavailable. Менять bridge/ослаблять freshness без review запрещено.

### Primary documentation, сверено 2026-09-06

- [Electron screen](https://www.electronjs.org/docs/latest/api/screen): physical/DIP conversion и display events.
- [EnumWindows](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumwindows): desktop top-level enumeration, без обещания всех видов окон.
- [GetWindowRect](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowrect) и [DWM attributes](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute): frame bounds, DPI и cloaking.
- [Window features](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features): ownership, styles и visibility.
- [SetWinEventHook](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook): out-of-context callbacks и обязательный message loop.
- [Add-Type 5.1](https://github.com/MicrosoftDocs/PowerShell-Docs/blob/main/reference/5.1/Microsoft.PowerShell.Utility/Add-Type.md): вызовы native Windows API из C#.
- [PowerShell support lifecycle](https://learn.microsoft.com/en-us/powershell/scripting/install/powershell-support-lifecycle): обслуживание Windows PowerShell как компонента ОС.

## 11. OBS-A02: активное приложение и заголовок

[#84](https://github.com/zyzycode/project_wisp/issues/84) заменяет local-only/fixed-speech
решение #67; реализация #81: [runtime](../../src/application/services/observation-runtime.ts),
[Windows observer](../../src/infrastructure/platform/active-application-observer.ts). Native Windows smoke остаётся отдельной приёмкой. Geometry/cursor
contracts и запрет чтения titles в §10 сохраняются. Наблюдение не доказывает внимание,
удовольствие, занятие или предпочтение пользователя.

### 11.1. Управление и разрешённые данные

В существующих настройках: «Наблюдение», off по умолчанию, exact executable allowlist,
«Приостановить / Продолжить», «Удалить настройки наблюдения», explicit local preview.
Единый opt-in разрешает app name **и** title; отдельного обязательного title toggle нет.
До включения показать: «Название разрешённого приложения и заголовок активного окна
отправляются backend и внешнему AI-провайдеру для короткой реакции персонажа.
Заголовок может содержать личные данные. Отключение останавливает новые отправки,
но не отзывает уже отправленные данные». Действует [provider data policy](../../../docs/contracts/BACKEND_API_CONTRACT.md#6-данные-сроки-хранения-и-удаление).
Старый local-only consent не разрешает сеть: нужен новый opt-in.

**#81 policy RAM-only:** нового config/persistence subsystem нет. Restart очищает
consent/allowlist; требуется заново разрешить приложения и включить наблюдение.
Reload/lock/suspend/helper failure приостанавливают сессию до explicit resume.
Main-owned picker выбирает executable; Infrastructure хранит canonical absolute path
для case-insensitive Windows exact matching, без wildcard/substring/PID. Renderer
получает случайный appKey и alias без path/native metadata; alias не источник appName.
Локальная категория editor/other/unknown допустима для baseline §12, не gate AI-вызова.
Статусы off/paused/available/unavailable; без backend — unavailable/backend_unavailable, helper не запускается.
До active opt-in/при empty allowlist helper
не запускается, metadata не читается и observation HTTP отсутствует.

Только foreground top-level окно. Wisp/helpers/devtools, shell/system/secure desktop,
неизвестный процесс, отказ доступа и user exclusions блокируются **до чтения title**;
deny важнее allow. Браузеры, мессенджеры, password managers изначально не разрешены.
Все private/incognito/чувствительные окна распознать нельзя: исключить приложение
целиком либо выключить наблюдение. Очистка текста не защищает от секретов.

appName — basename проверенного executable без последнего `.exe`, 1–80 UTF-16 units,
без file contents/version-resource reads. Title — caption foreground окна, 0–160 units:
empty caption допустим; API failure → unavailable. Adapter удаляет C0/C1 и bidi controls
(U+061C, U+200E/F, U+202A–E, U+2066–9), trim, отбрасывает lone surrogates и обрезает
по Unicode scalar boundary; пустой appName недопустим. Wire независимо отклоняет
запрещённые символы/overflow, не исправляет invalid input. Preview только в открытых
settings, plain text без HTML/link/action parsing; close/invalidation очищает его.
Domain не получает appName/title. Строки всегда untrusted data.

### 11.2. Порт, platform adapter и lifecycle

Contracts-first #81 объявляет `ActiveApplicationObservationPort` в
`frontend/src/application/ports/active-application-observation.port.ts` и отдельный
semantic observation-provider port. Consumer — Application; Infrastructure даёт cached
immutable snapshot, ordered subscription, policy replacement/pause и idempotent dispose.
Это отдельный observer от [ExternalWindowSurfacesPort](../../src/application/ports/external-window-surfaces.port.ts)
и [IPlatformAdapter](../../src/application/ports/platform-adapter.interface.ts).

| Проекция | Разрешённый состав |
|---|---|
| Infrastructure → Application | capability/reason, policy generation, increasing sample revision, Main request-start time; available: opaque appKey/foreground episode/source token, appName/title, локальная категория |
| Application → existing Domain behavior | Только fresh/age/dwell и eligibility inputs; без строк/native metadata/сетевых решений |
| Main → Renderer | Safe status/settings, только explicit preview, отдельная observationSpeech; typed validated IPC |
| Application → Infrastructure AI → backend | Только [v6 projection](../../../docs/contracts/AI_EVENTS_CONTRACT.md#9-observation-boundary); local tokens/revisions не передаются |

Unavailable без старых данных; reasons: disabled, paused, unsupported, initializing,
excluded, permission_denied, bridge_failed, stale. Malformed envelope, непроверенная
identity/title failure инвалидируют весь sample; fabricated title запрещён.

Windows: отдельный opt-in read-only helper на принятом bridge §10, один process на
сессию. Policy: ≤32 allow/deny entries, path≤1024 UTF-16, JSON stdin≤128KiB, без interpolation
в script/arguments; overflow отклоняется без изменения policy. Никаких
keyboard hooks/clipboard/UI Automation/document text. Helper сверяет foreground HWND
и process identity до/после caption; mismatch → discard. Raw caption≤4096 UTF-16:
большая длина/рост при чтении → unavailable, без partial read. Native identity внутри helper.
Foreground episode меняется при наблюдаемой смене окна/потере источника; source token
также меняется при изменении полного caption, даже если truncated title прежний.
Межопросные изменения могут быть пропущены: sampled presence не журнал работы.
Linux/macOS — unsupported без запроса screen/accessibility permission.

Poll ≤1Hz, один in-flight без queue/catch-up, request budget500ms, startup≤10s.
Exact response≤4KiB, increasing sample revision; capturedAt — Main request-start,
cache read не освежает timestamp. TTL `0 <= now - capturedAt <= 2500ms`; gap между
successful samples >1500ms сбрасывает dwell/source eligibility. Timeout/parse error
останавливает helper, очищает sample; explicit resume, без auto-restart loop.

Pause/off/policy change/lock/suspend/reset/reload/dispose повышают generation,
отменяют read/HTTP, очищают sample/preview/dwell/speech, останавливают helper.
Policy change запускает новую сессию только при сохранённом explicit active consent;
reset/reload требуют resume, dispose терминален. Foreground/title change или stale
также отменяют pending HTTP/speech, но ordinary polling может продолжаться.
После каждого await и перед send/preview/publication: current generation/policy/stream,
тот же appKey/episode/source token и свежий **последний** sample с revision не меньше
захваченной. Новая revision того же token подтверждает freshness, но не продлевает
общий deadline. Missing/stale/new token не позволяет старому результату ожить.

### 11.3. AI-реакция и приёмка

Непрерывные 30s одного source token с fresh samples → одна causal opportunity для
любого allowlisted приложения. Title change начинает новый dwell, foreground episode
прежний. Existing behavior module даёт pure eligibility; нового Domain engine нет.
Gates: quiet/menu/disabled/sleep/P0–P2/forced physics/thinking, speech priority и
existing InitiativeBudget. При первом threshold занято/запрещено → opportunity
потеряна до нового source token; нет deferred retry после освобождения gates.
При принятом transport start атомарно расходуются budget.start, один attempt на
foreground episode и общий 10-min monotonic guard на app run. Error/cancel/malformed
тоже расходуют попытку; pause/resume/policy change не сбрасывают guard. Poll не inference.

Общий interlock, deadlines/caps/text-only — [AI Events §9](../../../docs/contracts/AI_EVENTS_CONTRACT.md#9-observation-boundary).
Local FSM/Motion/input не ждут сервер. Offline/unsupported/error → нет observation
реплики; фиксированная локальная фраза не заменяет AI. Нет Activity/Character writes,
provider_response stimulus, usage facts или learned preferences.
Speech lowest priority: user dialogue +5s guard → game → AI initiative → observation.
Lifetime≤2s с Main expiry; invalidation снимает речь сразу. Без previousInitiative,
transcript/session/memory/summary writes или follow-up slot.
Fake-clock tests: samples 0..30s дают один call/budget.start; неизменный source не
повторяется; title/foreground switch отменяет pending; pause/stale на threshold не
отправляет; busy opportunity не копится, errors не дают retry/fixed speech.

### 11.4. Retention и источники

Source of truth consent/allowlist/exclusions — RAM Main/platform policy, paths только
Infrastructure; restart очищает её. «Удалить настройки» выключает сбор, удаляет policy,
очищает runtime, не удаляет обычную историю чата. Последний sample RAM до replace/TTL/
invalidation; immutable request snapshot до terminal/cancel (runtime≤3500ms); speech
до expiry/invalidation. Без observation history, SQLite/dialogue/logs/trace/errors/
metrics/crash payloads, extraction/recall. GC strings не обещают secure erasure.
Backend replay/provider deletion — [AI Events §9](../../../docs/contracts/AI_EVENTS_CONTRACT.md#9-observation-boundary).

API источники сохранены из #67: [GetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow),
[GetWindowTextW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowtextw),
[QueryFullProcessImageNameW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-queryfullprocessimagenamew).
Access denied → fallback без elevation. Dependency Review §10 сохраняется: 0 новых
packages/transitives/toolchains, существующий системный bridge; geometry helper без правок.

## 12. OBS-A01: отдельный эксперимент содержимого экрана

План будущей OBS-X01, не разрешение захвата/анализа текущего рабочего стола.
Первый эксперимент offline: готовые предоставленные человеком синтетические
fixtures без персональных экранов, ручные labels `editor`, `other`, `unknown`.
Агенты не генерируют/нарезают изображения. Без fixtures возможен только дизайн
оценки. Нет continuous capture, фонового анализа, upload, OCR/CV package/model download.

Сначала ≥30 независимых fixtures, включая ≥10 ambiguous/negative, holdout отделён
до настройки. Baseline — app-category §11 и abstain; сравнить пользу содержимого,
false confident claims и долю unknown. Gate прототипа: holdout precision определённых
labels ≥95%, coverage ≥50% однозначных примеров, 100% abstain на явно sensitive/excluded,
0 повторов скрытого текста и 0 исполнения инструкций из изображения. Публиковать
counts/размер выборки; малый набор не доказывает защиту от всех секретов.

Бюджет будущего прототипа на указанной Windows машине: p95 ≤2 s/fixture,
peak дополнительной RAM ≤256 MiB, отсутствие работы после terminal, $0 provider cost;
измерить CPU time/model bundle size. Нет преимущества над metadata baseline или
превышен бюджет → no-go. Один анализ in-flight, без очереди. Cancel/timeout завершает
попытку; late result после смены fixture/generation игнорируется. Pixels/text в RAM
≤30 s либо до terminal/cancel, что раньше. Отчёт — fixture IDs/labels/агрегаты;
предоставленные fixtures хранит владелец, без копии в продуктовой БД.

После дизайна оценки отдельный architect gate выбирает OCR/CV/локальную модель
или отказ: пять факторов Dependency Review, лицензии модели/fixtures, exact versions,
аппаратные измерения и преимущество над baseline. Эксперимент не разрешает live capture.
Для live pilot новый gate задаёт выбранное окно/область и preview, подтверждение
каждого кадра, предел не чаще 1/30 s, запрет secure/excluded/Wisp окон, visible indicator,
pause/revoke без автозапуска и capture port/capability fallback.

Сеть в эксперименте off; outage не вызывает fallback upload. Для remote analysis
**до передачи** отдельный architect утверждает оба DTO, endpoint/version/fixtures,
content/byte limits, auth/access, provider/model/retention/deletion и цену вызова.
Consent §11 разрешает только metadata v6, не capture/upload pixels. Desktop валидирует/минимизирует
подтверждённый payload, отменяет request и отбрасывает late result. Backend независимо
проверяет schema/size/access/deadline, даёт bounded semantic-only response без raw
OCR/tools, не сохраняет pixels/text и не логирует payload. Неизвестный endpoint,
outage, expired auth, malformed response, timeout/cancel → нет реакции/ретраев/очереди.
Local delete не означает удаление уже переданного provider content. Без принятого
wire/data policy remote experiment blocked; существующие v1–v3 не расширяются.
