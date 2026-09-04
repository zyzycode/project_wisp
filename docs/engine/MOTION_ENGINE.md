# Контракт Motion Engine

`MOTION_ENGINE.md` — source of truth для физических расчётов (drag, throw, fall, collision, crawl/support kinematics), правил авторитета позиции и границ применения перемещения окна.

Motion Engine фиксирует **физические факты** и принудительную позицию, но не выбирает автономное поведение персонажа. Архитектурное обоснование lightweight solver для native window вынесено в [`ADR-014`](../adr/ADR-014-native-window-motion.md). Доменные типы определены в [`motion-engine.ts`](../../src/domain/behavior/motion-engine.ts) и [`surface-kinematics.ts`](../../src/domain/behavior/surface-kinematics.ts).

## 1. Владение и поток

```mermaid
flowchart LR
  R[Renderer pointer input] -->|typed IPC| O[Main/Application orchestrator]
  E[Environment adapter] -->|normalized snapshot| O
  C[Main monotonic clock] --> O
  O --> M[Motion Engine]
  O --> S[Surface Kinematics]
  M --> P[PetPositionService]
  S --> P
  P --> PP[PetPositionPort]
  PP --> W[Electron window adapter]
  M -->|MotionEvent| A[Animation FSM]
  O -->|presentation snapshot| R
```

- **Motion Engine (Domain):** чистый физический солвер (drag, airborne, grounded, crawl/support), расчёт скоростей, коллизий и фактов посадки. Не управляет таймерами, окнами ОС и не принимает решений по поведению.
- **Surface Kinematics (Domain):** кинематика поверхностей опоры (wall climb, ceiling hang/crawl) и отрыв.
- **Main / Application Orchestrator:** агрегат состояния, интеграция по времени (fixed-step accumulator), валидация drag-сессий, диспатчеризация `MotionEvent`.
- **Infrastructure:** платформенные адаптеры экранов и реализация `PetPositionPort` (перемещение BrowserWindow).
- **Renderer:** пассивный рендеринг и захват событий указателя мыши. Не владеет физикой и авторитетной позицией.

Приоритеты P0–P5 определены в [`AUTONOMY_ENGINE.md`](./AUTONOMY_ENGINE.md); визуальные анимации — в [`ANIMATION_ENGINE.md`](./ANIMATION_ENGINE.md).

## 2. Координаты и базовые DTO

- **Единицы**: координаты — `WorldPx` (логический пиксель экрана / DIP, origin сверху слева, $x$ вправо, $y$ вниз); скорость — `WorldPx/s`; ускорение — `WorldPx/s²`; время/таймстемпы — monotonic ms.
- **Опорная точка (`rootPosition`)**: базовый контактный pivot персонажа (подошвы/центр опоры). Смещения рендерера и спрайтов вычисляются относительно него и не влияют на физический pivot.
- Типы данных (`Vector2Dto`, `ScreenBoundsDto`, `CollisionInsets`, `MotionState`, `MotionEvent`) импортируются напрямую из [`src/domain/behavior/motion-engine.ts`](../../src/domain/behavior/motion-engine.ts).

## 3. Физические состояния

Физический цикл движения разделяется на четыре базовых состояния:

```mermaid
stateDiagram-v2
  [*] --> grounded
  grounded --> dragged: drag_started (pointer grab)
  grounded --> airborne: voluntary_jump / support_lost
  grounded --> crawl: startWallClimb / startCeilingHang
  crawl --> airborne: support_lost
  dragged --> airborne: released (throw_release)
  airborne --> airborne: collision (bounce)
  airborne --> grounded: landed (settle criteria met)
```

1. **`drag` (`dragged`)**: Принудительное перемещение курсором пользователя. Персонаж привязан к pivot курсора с постоянным grab offset. Скорость обнулена, гравитация отключена. Немедленно отменяет текущую активность (P1 safety).
2. **`fall` (`airborne`)**: Свободный полёт/падение под действием гравитации и демпфирования. Возникает по трём причинам (`AirborneCause`):
   - `throw_release`: бросок пользователем после отпускания drag;
   - `support_lost`: потеря твердой поверхности (полка/окно исчезли или персонаж выполз за пределы);
   - `voluntary_jump`: санкционированный прыжок системы автономности.
3. **`land` (фаза стабилизации и приземления)**: Контакт с нижней поверхностью (`screen_floor` / границы экрана). Включает отскоки (`bounce`) и тангенциальное трение до выполнения критериев затухания (`settle`). Завершается исходом `soft_landing`, `stumble` или `crash_landing`.
4. **`crawl` (`climbing_wall`, `hanging_ceiling`)**: Кинематика движения по поверхностям ([`surface-kinematics.ts`](../../src/domain/behavior/surface-kinematics.ts)):
   - Движение по вертикальной стене (`climbing_wall`) со скоростью $v_{\text{vertical}}$;
   - Ползание по верхней кромке стороннего окна (`hanging_ceiling`) со скоростью $v_{\text{crawl}}$. При выходе за границу поверхности генерируется `support_lost` и персонаж переходит в `fall`.

## 4. Sliding-window throw vector

Оценка вектора скорости броска при отпускании драга использует взвешенную линейную регрессию выборки последних положений за окно `windowMs` (по умолчанию 100 мс, макс. 8 сэмплов):

```text
τ_i = (t_i - t_(n-1)) / 1000;  w_i = i + 1
τ̄ = Σ(w_i τ_i) / Σw_i;  x̄ = Σ(w_i x_i) / Σw_i;  ȳ = Σ(w_i y_i) / Σw_i
vx_raw = Σ[w_i(τ_i - τ̄)(x_i - x̄)] / Σ[w_i(τ_i - τ̄)²]
vy_raw = Σ[w_i(τ_i - τ̄)(y_i - ȳ)] / Σ[w_i(τ_i - τ̄)²]
s = sqrt(vx_raw² + vy_raw²);  k = min(1, maxThrowSpeed / max(s, ε))
vx = vx_raw × k;  vy = vy_raw × k
```

- Если количество сэмплов $< 2$ или span $< \text{minSpanMs}$ (24 мс), скорость броска принимается равной $(0, 0)$.
- Запрещено использовать мгновенную скорость по двум точкам или сырые дельты мыши (`movementX/Y`).

## 5. Интеграция физики (Fixed-step integration)

Интеграция выполняется фиксированным шагом $h$ (`fixedStepSec = 1/120` с) по схеме полунеявного метода Эйлера с экспоненциальным демпфированием:

```text
vy_accel = vy(t) + gravity × h
vx(t+h) = vx(t) × exp(-linearDampingX × h)
vy(t+h) = vy_accel × exp(-linearDampingY × h)
speed = sqrt(vx(t+h)² + vy(t+h)²)
velocity = velocity × min(1, maxSpeed / max(speed, ε))
x(t+h) = x(t) + vx(t+h) × h
y(t+h) = y(t) + vy(t+h) × h
```

Константы по умолчанию: $g = 1800\text{ px/s}^2$, $d_x = 0.35\text{ s}^{-1}$, $d_y = 0.08\text{ s}^{-1}$, $v_{\text{maxSpeed}} = 2400\text{ px/s}$.
Motion Engine является чистой функцией: при одинаковых входных данных результат строго детерминирован и не зависит от FPS рендера.

## 6. Коллизии, отскок и приземление

Эффективные границы рассчитываются с учётом отступов персонажа (`collisionInsets`):
```text
minX = bounds.x + insets.left;  maxX = bounds.x + bounds.width - insets.right
minY = bounds.y + insets.top;   maxY = bounds.y + bounds.height - insets.bottom
```

Отражение скорости при ударе:
- Стены (left/right): $v_{x,\text{after}} = -\text{wallRestitution} \times v_{x,\text{before}} \quad (\text{restitution} = 0.45)$
- Потолок (top): $v_{y,\text{after}} = -\text{ceilingRestitution} \times v_{y,\text{before}} \quad (\text{restitution} = 0.30)$
- Пол (bottom): $v_{y,\text{after}} = -\text{floorRestitution} \times v_{y,\text{before}}, \quad v_{x,\text{after}} = \text{floorTangentialRetention} \times v_{x,\text{before}} \quad (0.30, \; 0.72)$

Тяжесть удара (Impact severity) и пиковая нагрузка:
```text
normalImpact = max(0, vy_before); tangentialImpact = abs(vx_before)
impactSeverity = sqrt(normalImpact² + 0.25 × tangentialImpact²)
peak = max(previousPeak, impactSeverity)
```

### Критерий перехода в grounded (Settle)
Отскок происходит, если нормальная скорость удара $\text{normalImpact} > \text{minBounceNormalSpeed}$ (160 px/s). Иначе персонаж остаётся на полу, а тангенциальная скорость гасится. Переход в `grounded` наступает при соблюдении всех трёх условий:
```text
normalImpact <= settleNormalSpeed (120 px/s)
AND abs(vx_after) <= settleTangentialSpeed (90 px/s)
AND abs(y - maxY) <= ε
```

После этого скорость обнуляется и единожды генерируется событие приземления:
- $\text{peak} \le 420 \implies \text{soft\_landing}$
- $\text{peak} \le 950 \implies \text{stumble}$
- $\text{peak} > 950 \implies \text{crash\_landing}$

## 7. Кинематика поверхностей (Surfaces и crawl)

Управление движением по поверхностям изолировано в [`surface-kinematics.ts`](../../src/domain/behavior/surface-kinematics.ts). Модуль принимает нормализованный снимок окружения (`EnvironmentSnapshot`), не выполняя прямого обращения к OS API.

- **Стена (`climbing_wall`)**: $x = x_{\text{wall}}, \quad y(t+\Delta t) = y(t) + v_{\text{vertical}} \cdot \Delta t$.
- **Потолок/кромка окна (`hanging_ceiling` / crawl)**: $y = y_{\text{support}}, \quad x(t+\Delta t) = x(t) + v_{\text{crawl}} \cdot \Delta t$.
- **Валидация опоры**: при $x \notin [x_{\min}, x_{\max}]$ опоры, удалении окна или невалидности флага `isValidSupport` немедленно инициируется отрыв: `beginAirborne(..., cause: 'support_lost')`.

## 8. Авторитет позиции: кто двигает окно

```mermaid
flowchart TD
  subgraph Input
    UI[Pointer input] -->|IPC| MO[Main Orchestrator]
  end

  subgraph Physics & Authority
    MO -->|forced drag/fall/land| ME[MotionEngine]
    MO -->|voluntary walk/crawl| BE[Behavior & Surface Engine]
    ME -->|authoritative rootPosition| PPS[PetPositionService]
    BE -->|authoritative rootPosition| PPS
  end

  subgraph Native Window Commit
    PPS -->|commitRootPosition| Port[PetPositionPort]
    Port --> Adapter[ElectronPetPositionAdapter]
    Adapter -->|Math.round root - pivotOffset| NativePos[Native X, Y]
    NativePos -->|if changed| Win[BrowserWindow.setPosition]
  end
```

### Правила авторитета (Authority Rules)
1. **Renderer никогда не двигает окно**: окно не перемещается из Renderer-процесса и не имеет прямого доступа к окну Electron. Renderer лишь захватывает pointer events и отправляет их в Main через типизированный IPC.
2. **Forced vs Voluntary Motion**:
   - **Forced motion (P1/P0)**: при возникновении drag, throw release или support loss управление позицией монопольно захватывается Motion Engine. Текущие Activity немедленно отменяются. Никакие автономные команды перемещения не применяются.
   - **Voluntary motion**: возвращается персонажу **только** после полного завершения приземления, когда состояние стало `grounded` и FSM вошёл в стабильное состояние `settle`.
3. **Единая точка коммита позиции окна**:
   - Логический центр контакта `rootPosition` передаётся через интерфейс [`PetPositionPort`](../../src/application/ports/pet-position-port.ts).
   - Инфраструктурный адаптер [`ElectronPetPositionAdapter`](../../src/infrastructure/adapters/electron-pet-position-adapter.ts) переводит контактный pivot в верхний левый угол окна:
     $$x_{\text{native}} = \text{round}(\text{clamp}(x_{\text{root}} - \text{offset}_x, \dots)), \quad y_{\text{native}} = \text{round}(\text{clamp}(y_{\text{root}} - \text{offset}_y, \dots))$$
   - `BrowserWindow.setPosition` вызывается **строго при изменении целочисленных координат**, исключая спам IPC и дергание окна.

## 9. Оркестрация (ShimejiMotionOrchestrator)

Главный координатор в Application-слое ([`shimeji-motion-orchestrator.ts`](../../src/application/services/shimeji-motion-orchestrator.ts)) управляет жизненным циклом физического цикла:
- Владеет монотонными часами Main-процесса, аккумулятором времени и текущей drag-сессией.
- На каждом такте накапливает $\Delta t$ кадра (с отсечкой `maxFrameDeltaSec = 0.25`), исполняет дискретные шаги `fixedStepSec` и передаёт результат в [`PetPositionPort`](../../src/application/ports/pet-position-port.ts).
- Публикует для Renderer ровно один снимок состояния презентации (`PetPresentationStateDTO`) на коммит транзакции.

## 10. Граница IPC (Typed IPC Boundary)

Взаимодействие между процессами строится через контракт [`ipc-contracts.ts`](../../src/shared/ipc-contracts.ts):
- **События Drag**: Renderer посылает `beginPetDrag`, `movePetDrag`, `releasePetDrag` с монотонно возрастающим номером `sequence` и экранными координатами курсора. Main-процесс валидирует идентификатор сессии и отбрасывает устаревшие или чужие сообщения.
- **Состояние представления**: Main рассылает `PetPresentationStateDTO` с монотонным номером ревизии, текущей фазой движения (`dragged` / `airborne` / `grounded`), типом авторитета (`forced` / `voluntary`) и визуальным состоянием анимации.
- Контракты IPC являются независимым листом зависимостей и не содержат дескрипторов ОС, классов рендеринга или прямых ссылок на Electron.

## 11. Изоляция и проверяемые свойства

- **Независимость домена**: математика движения в [`MotionEngine`](../../src/domain/behavior/motion-engine.ts) и [`SurfaceKinematics`](../../src/domain/behavior/surface-kinematics.ts) не зависит от Electron, DOM, таймеров Node.js и файловой системы.
- **Детерминизм**: одинаковый входной снимок и констрейнты дают строго идентичное положение и события независимо от FPS рендера.
- **Безопасность авторитета**: окно Electron двигается только через адаптер [`PetPositionPort`](../../src/application/ports/pet-position-port.ts); race conditions и параллельное перемещение окна несколькими источниками исключены.
