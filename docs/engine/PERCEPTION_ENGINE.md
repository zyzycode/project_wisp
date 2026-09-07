# Контракт Perception Engine

Gaze, cursor proximity/freshness и normalized environment observations; без Activity/semantic/motion decisions. Координатные primitives `MonotonicMs`/`WorldPx`/`SourcePx`/`Vector2Dto`/`ScreenBoundsDto` — [Motion §2](MOTION_ENGINE.md#2-координаты-и-базовые-dto).

## 1. Владение

Gaze Engine — pure pupil offset/tracking/neutral/visual freshness, вызываемый Body на RAF. Cursor Proximity (Domain) — normalized distance/range/dwell. Environment adapter (Infrastructure) — OS display geometry → immutable EnvironmentSnapshot.

Body показывает gaze локально и refresh-ит cursor_observed до 10 Hz независимо от RAF ([UI cadence](UI_SPEC.md#63-cadence-и-coalescing)). Application ставит Main receive time; Brain использует proximity для P3 eligibility. [Ownership](README.md#4-матрица-межмодульных-контрактов-кто-от-кого-зависит).

## 2. Поток perception

OS/platform + BodyEventDTO cursor → boundary normalization → EnvironmentSnapshot → proximity → Brain eligibility / Motion support. Body cursor + presentation geometry → gaze → PupilOffset.

Environment — observation, gaze — presentation, proximity — signal; ни один не BehaviorIntent/AnimationIntent и не команда.

## 3. Gaze DTO и контракт взгляда

Типы и конфигурация Gaze Engine определены в [src/domain/behavior/gaze-engine.ts](../../src/domain/behavior/gaze-engine.ts).

- **Допустимые диапазоны смещения зрачка**: $dx, dy \in [-1.0, 1.0]$.
- **Deadzone и clamped circle**: в deadzone desired offset равен $(0, 0)$; вне deadzone результирующий вектор смещения зрачка ограничивается кругом единичного радиуса ($r = \sqrt{(dx/maxOffsetX)^2 + (dy/maxOffsetY)^2} \le 1.0$).
- **Валидация**: `scale`, max offsets и smoothing time $> 0$; остальные значения неотрицательны; `attentionRadiusWorldPx > deadZoneSourcePx × scale`.

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

Gaze не emits Activity/AnimationIntent. При baked-in face Body может не показывать pupil layer, не подавляя отдельный bounded-refresh `cursor_observed` для Brain proximity.

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
AUTO-A09 не вводит постоянную chase: ограниченный cursor interest подчинён
[общему admission/budget](./AUTONOMY_ENGINE.md#13-auto-a09-локальная-жизнь-и-ненавязчивость).

### 6.1. AUTO-A09: bounded cursor interest

Stationary Observe Cursor #23 сохраняет gaze/доступный gesture без default locomotion. Approach внутри `play` в #48 требует freshness/dwell, Character Needs/friendship, cooldown и общий budget. Fatigue может оставить только gaze; P2/AI ownership запрещают новую local Activity.

Эпизод — один run/deadline и максимум одна fixed target на той же достижимой опоре. Samples обновляют gaze/валидность, не retarget/deadline. Approach использует walk с total-distance limit `InitiativeTuning`; chase jumps/traversal/new primitives/переход между опорами запрещены.

Stale/выход курсора из interest area/исчезнувшая или недостижимая цель/user/physics/deadline → completion с cleanup и fresh local выбором. Cursor motion не рестартует эпизод. Gaze-only не тратит budget/не даёт play reward; игра — once-only [Activity outcome](ACTIVITY_ENGINE.md#16-auto-a09-единый-outcome-и-ownership).

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

Window top/floor используют общий behavior/pose selection (walk/observe/sit/rest/sleep); тип опоры не даёт бонуса target selection/отдельной arrival Activity. Геометрия ограничивает routes/walking; move переносит персонажа, support loss вызывает fall.

До трёх edges с разными IDs на окно; immutable full replacement, не delta. `revision` строго возрастает в экземпляре порта, включая unavailable/recovery; меньшие/повторные игнорируются. `capturedAtMs` — Main monotonic **request-start**, не delivery/helper time; cache read timestamp не освежает.

- Windows available только после complete valid sample; пустой массив = нет подходящих окон.
- Startup: `unavailable/initializing`; timeout/parse/API failure/запрещённый bridge: `unavailable/bridge_failed`; TTL: `unavailable/stale`.
- Linux Wayland/X11 и macOS: `unavailable/unsupported`, пустые external surfaces, без Win32; screen-floor/work-area продолжают работать.
- Любой unavailable несёт пустой массив, не заменяет screen capability/не выдумывает geometry. Recovery available не делает auto-reattach.
- Cache read синхронен, subscribe отдаёт full ordered snapshots; Main владеет lifecycle, dispose останавливает helper/sampling/callbacks.

### Filtering и приватность

Только обычные прямоугольные top-level окна текущего interactive desktop. Bridge проверяет `EnumWindows`, `GetAncestor(GA_ROOT)`, `GetWindow(GW_OWNER)`, styles, `IsWindowVisible`, `IsIconic`, DWM attributes.

Исключить:
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

Frame source: `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)` physical pixels; `GetWindowRect` не эквивалентен (DPI virtualization/invisible resize borders). Frame пересекает **ровно один** physical display; spanning исключён. AUTO-V01 допускает body окна за внешним краем desktop, если edge полностью внутри workArea; bounds сохраняются без clipping.

Infrastructure ровно один раз применяет `screen.screenToDipRect(null, rect)`; нельзя делить global x/y на scaleFactor или брать display Wisp вместо display frame. Edge целиком в workArea своего display, clipping с ложной кромкой запрещён. Разные окна могут иметь разный DPI; глобальные DIP согласованы со ScreenBoundsDto. Перед commit Application выбирает bounds того же display и проверяет root/insets.

`display-added/removed/metrics-changed` инвалидируют все external supports и previous follow baseline до нового full sample. Ошибка normalization → unavailable.

### Dependency Review: Win32 bridge (2026-09-06)

**Approved: системный Windows PowerShell 5.1 + собственный C# P/Invoke helper, без новой npm-зависимости.** Это архитектурное разрешение Windows-first observer с fallback, не измерение готовой производительности.

Один child process на lifecycle, не на poll. `Add-Type` только для read-only User32/Dwmapi + lifecycle hook; `child_process.spawn` из Main, bridge/paths/OS branches только в `src/infrastructure/platform/`.

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
