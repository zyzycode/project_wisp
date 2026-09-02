# Контракт Character Engine

`CHARACTER_ENGINE.md` — source of truth для модели персонажа Wisp, его витальных потребностей, шкал отношений, личностных осей, пластичности характера, романтического состояния и предпочтений. Персонаж управляется чистой доменной логикой (Domain Layer) и служит психологическим контекстом как для выбора автономного поведения, так и для AI Provider.

Документ является архитектурным контрактом ядра. Implementer-агенты не меняют этот contract без Architect review.

## Владение

- **Domain Layer (`src/domain/models/`, `src/domain/behavior/`):** полностью владеет структурой `CharacterState`, расчетом метаболизма потребностей (`Needs`), шкал отношений (`Relationship`), осей личности (`Personality`), динамическим синтезом эмоционального тона, гейтингом романтики (`IntimacyState`) и semantic acceptance входного `BehaviorIntent`.
- **Application Layer:** нормализует provider/user/timer/system input в candidate `BehaviorIntent`, передает внешние стимулы в Character Engine и формирует актуальный `CharacterSnapshot`; mapper не принимает behavior decision.
- **Renderer / UI:** получает presentation-ready срез состояния через IPC (эмоциональный статус, уровни шкал для карточки питомца, доступные визуальные темы), но не вычисляет формулы и не меняет состояние напрямую.
- **AI Provider:** получает сериализованный `CharacterSnapshot` и контекстные подсказки из пресета, но не имеет прямого доступа к мутабельным объектам домена.

## Поток ответственности

```text
Provider hint / user, timer or system event
  -> Application mapper
  -> Candidate BehaviorIntent
  -> Character Engine (gating / acceptance)
  -> Resolved BehaviorIntent
  -> Behavior Brain (Activity selection, если требуется)
  -> Activity Runner
  -> AnimationIntent -> Animation Controller -> Render Engine
```

Character Engine — единственный owner semantic gating и resolved behavior, но не выбирает Activity, physics outcome, animation clip или frame. `Candidate` и `Resolved` — статусы одной формы `BehaviorIntent`, не новые DTO. Полная ownership-матрица и forced-motion исключение находятся в [`BEHAVIOR_INTENTS.md`](./BEHAVIOR_INTENTS.md#поток-ответственности); связь с Activity и Motion Engine — в [`SHIMEJI_SPEC.md`](./SHIMEJI_SPEC.md#1-границы-и-поток-данных).

---

## 1. Главная идея

Wisp должен ощущаться живым. Не как таблица статов, а как персонаж с характером, настроением, потребностями, привязанностью, стеснением, памятью и постепенно меняющимися реакциями.

Система спроектирована так, чтобы AI читал эти параметры как глубокий психологический контекст:
- почему Wisp сейчас молчит;
- почему смущается;
- почему держит дистанцию;
- почему хочет внимания;
- почему стал теплее после доверительных разговоров;
- почему понравился или не понравился фильм/игра/сцена.

---

## 2. Needs (Витальные потребности)

`Needs` — текущие потребности персонажа. Для AI и поведения используется формат `unmet need` (чем выше значение, тем сильнее дефицит/потребность).

Исключение — `energy`: это ресурс, где 100 — бодрость, а 0 — истощение.

```typescript
export interface Needs {
  /** 0-100, бодрость (ресурс: 100 = бодр, 0 = истощен) */
  energy: number;
  /** 0-100, потребность во внимании (unmet need: 100 = сильное одиночество) */
  attention: number;
  /** 0-100, потребность в игре/стимуляции (unmet need: 100 = скука) */
  play: number;
  /** 0-100, потребность в покое/уюте (unmet need: 100 = сенсорный перегруз) */
  comfort: number;
}
```

### Интерпретация:
- `energy <= 20`: Wisp устал, отвечает короче, чаще садится или засыпает.
- `attention >= 80`: Wisp хочет контакта, смотрит на пользователя, подходит ближе, мягко намекает.
- `play >= 75`: Wisp скучает, ищет движение или реакцию на курсор.
- `comfort >= 80`: Wisp перегружен, стремится к тишине, покою и спокойному idle.

### 2.1. Каноническая семантика сна и пробуждения

Character Engine — единственный source of truth для semantic sleep state, правил принятия `sleep` / `wake` и их порогов. Соседние движки получают уже resolved behavior и не повторяют эти условия.

| Термин | Семантика и owner |
|---|---|
| `sleep` | `BehaviorIntentKind`, который Character Engine принимает или инициирует для входа в semantic sleep state. |
| `quiet` | Отдельный `BehaviorIntentKind`: подавляет навязчивые автономные действия и реплики, но сам по себе не означает сон и не запускает sleep lifecycle. |
| `wake` | `BehaviorIntentKind`, который Character Engine принимает или инициирует для выхода из semantic sleep state. |
| `sleep_start` / `sleep_loop` / `wake_up` | Только visual lifecycle kinds Animation Engine; они не принимают behavior decision и не задают пороги. |

Канонические правила:

- `energy <= 20` **или** `comfort >= 80` инициирует deterministic P2 `sleep` после P0 forced physics и P1 direct user interaction;
- прямой click, `attention >= 90` или восстановление `energy >= 80` разрешает `wake`;
- прямой drag имеет P1 authority: он завершает активный сон через resolved `drag` и visual `dragged -> land -> settle`, не требуя отдельного `wake_up`;
- provider-origin `respond`, `think`, `play`, `react_happy` и `react_confused`, а также timer-only `idle` / `wander`, сами по себе не создают `wake`;
- если после выхода из сна условие входа всё ещё истинно, Character Engine может снова разрешить `sleep` после завершения более приоритетного interaction flow.

Эти значения являются существующим runtime tuning contract: данный раздел не вводит новый DTO, state field или настройку.

---

## 3. Relationship (Система отношений)

Отношения делятся на две независимые шкалы:

```typescript
export interface Relationship {
  /** 0-1000, базовое доверие, комфорт и привыкание */
  friendship: number;
  /** 0-1000, глубокая эмоциональная/романтическая связь */
  love: number;
  /** Флаг разблокировки шкалы любви */
  loveUnlocked: boolean;
}
```

### Правила прогрессии:
- `friendship` растет от регулярного взаимодействия, доброты, игр, разговоров и совместного времени.
- `love` заблокирован на старте (`loveUnlocked: false`) и открывается только при достижении порога дружбы (по умолчанию `friendship >= 400`). Не растет от спам-кликов; требует доверия, заботы, эмоциональной близости и уважения границ.
- **Принцип отсутствия чувства вины:** Wisp не наказывает пользователя за отсутствие. Допустим мягкий `soft decay` без драматических штрафов и сообщений с укором.

---

## 4. Personality (Оси личности)

Личность определяется 7 числовыми шкалами:

```typescript
export type PersonalityAxis =
  | 'openness'
  | 'extraversion'
  | 'agreeableness'
  | 'sensitivity'
  | 'playfulness'
  | 'boldness'
  | 'independence';
```

### Значение шкал:
- `openness`: любопытство, фантазия, интерес к новому.
- `extraversion`: социальная энергия, готовность первой инициировать контакт.
- `agreeableness`: мягкость, забота, уступчивость.
- `sensitivity`: эмоциональная чувствительность, глубина реакции на тон и события.
- `playfulness`: игривость, юмор, тяга к шалостям и играм.
- `boldness`: раскрепощенность, смелость, прямота выражения чувств.
- `independence`: способность комфортно быть рядом без постоянного внимания.

### Синтез производных черт:
Производные черты (например, `shyness`) вычисляются динамически:

```typescript
export function calculateShyness(axes: Record<PersonalityAxis, AxisValue>): number {
  return (
    axes.sensitivity.current * 0.45 +
    (1 - axes.boldness.current) * 0.35 +
    (1 - axes.extraversion.current) * 0.2
  );
}
```

---

## 5. Soft Lock / Hard Lock и пластичность

Каждая ось личности имеет коридор допустимых изменений:

```typescript
export interface AxisValue {
  /** 0-1, ядро личности */
  base: number;
  /** 0-1, текущее динамическое значение */
  current: number;
  /** Комфортная нижняя граница */
  softMin: number;
  /** Комфортная верхняя граница */
  softMax: number;
  /** Абсолютный минимум */
  hardMin: number;
  /** Абсолютный максимум */
  hardMax: number;
  /** 0-1, скорость/легкость адаптации шкалы */
  plasticity: number;
}
```

- `soft lock`: персонаж может выходить за пределы комфортной зоны только временно и при сильных стимулах.
- `hard lock`: персонаж никогда не ломает базовую идентичность (стеснительная Wisp не станет наглой или вульгарной даже при максимуме любви).

---

## 6. Стартовый архетип: Shy Dream Girl

Базовый образ Wisp: **аниме-девушка-мечта — нежная, застенчивая, медленно привязывающаяся, сохраняющая смущение даже при глубоких отношениях.**

### Динамика раскрытия:
1. **Начало:** осторожность, краткие мягкие ответы, частое смущение, тихое созерцание издалека.
2. **Развитая дружба:** сокращение дистанции, охотные игры, легкое дружеское поддразнивание, самостоятельная инициатива.
3. **Развитая любовь:** глубокая нежность и забота, тонкий флирт через смущение (*blush, паузы, отвод взгляда, тихие реплики*).

---

## 7. Intimacy & Romantic Charge

Внутреннее состояние романтического напряжения:

```typescript
export interface IntimacyState {
  /** 0-100, проявленный флирт / кокетство */
  flirtiness: number;
  /** 0-100, внутреннее романтическое напряжение */
  romanticCharge: number;
  /** Пользовательский флаг согласия на романтический контент */
  userConsentEnabled: boolean;
  /** Границы пользователя установлены и понятны */
  boundariesKnown: boolean;
}
```

### Пороги и константы гейтинга флирта:

```typescript
export const DEFAULT_INTIMACY_THRESHOLDS = {
  FRIENDSHIP_FLIRT_THRESHOLD: 500,
  MIN_FLIRT_ENERGY: 30,
  MAX_COMFORT_NEED: 60,
  LOVE_UNLOCK_FRIENDSHIP_THRESHOLD: 400,
} as const;

export function canExpressFlirt(
  state: CharacterState,
  thresholds = DEFAULT_INTIMACY_THRESHOLDS
): boolean {
  return (
    state.intimacy.userConsentEnabled &&
    state.relationship.loveUnlocked &&
    state.relationship.friendship >= thresholds.FRIENDSHIP_FLIRT_THRESHOLD &&
    state.needs.energy >= thresholds.MIN_FLIRT_ENERGY &&
    state.needs.comfort <= thresholds.MAX_COMFORT_NEED
  );
}
```

---

## 8. Эмоциональный тон (Синтез настроения)

Вместо плоского статического поля `mood` эмоциональное состояние синтезируется динамически на основе потребностей, характера и отношений:

Этот раздел — единственный authoritative contract словаря и синтеза `SynthesizedEmotionalTone`. Consumer contracts ссылаются на тип и не переопределяют его значения.

```typescript
export type SynthesizedEmotionalTone =
  | 'shy'
  | 'sleepy'
  | 'playful'
  | 'curious'
  | 'neutral'
  | 'affectionate'
  | 'flustered';
```

### Матрица синтеза:
- `energy <= 20` или `comfort >= 80` -> `'sleepy'`
- `shyness >= 0.65` при `relationship.friendship < 400` -> `'shy'`
- `relationship.love >= 500` при высоком доверии -> `'affectionate'`
- `play >= 70` при нормальной энергии -> `'playful'`
- Иначе -> `'neutral'` или `'curious'`

---

## 9. Taste & Preferences (Вкусы и предпочтения)

Формируются на основе пережитого опыта:

```typescript
export interface PreferenceTrack {
  /** -100..100, оценка темы/жанра */
  value: number;
  /** 0-1, уверенность в оценке */
  confidence: number;
  /** Число контактов с темой */
  samples: number;
}
```

Повторяющийся опыт повышает `confidence`. Wisp способна перенимать интересы пользователя из эмпатии и привязанности.

---

## 10. Config Presets

```typescript
export interface PersonalityPreset {
  id: string;
  displayName: string;
  aiSelfConcept: string;
  axes: Record<PersonalityAxis, AxisValue>;
}

export const shyDreamGirlPreset: PersonalityPreset = {
  id: 'shyDreamGirl',
  displayName: 'Shy Dream Girl',
  aiSelfConcept:
    'Wisp is a shy, gentle, emotionally sensitive anime-like companion. She is slow to attach, easily flustered, and hides her feelings at first. With trust, she becomes warmer, more playful, and more affectionate, but never loses her shy core.',
  axes: {
    openness: { base: 0.55, current: 0.55, softMin: 0.35, softMax: 0.75, hardMin: 0.2, hardMax: 0.9, plasticity: 0.3 },
    extraversion: { base: 0.28, current: 0.28, softMin: 0.15, softMax: 0.5, hardMin: 0.05, hardMax: 0.7, plasticity: 0.25 },
    agreeableness: { base: 0.86, current: 0.86, softMin: 0.65, softMax: 0.96, hardMin: 0.45, hardMax: 1.0, plasticity: 0.2 },
    sensitivity: { base: 0.88, current: 0.88, softMin: 0.68, softMax: 0.98, hardMin: 0.5, hardMax: 1.0, plasticity: 0.18 },
    playfulness: { base: 0.42, current: 0.42, softMin: 0.25, softMax: 0.7, hardMin: 0.1, hardMax: 0.85, plasticity: 0.35 },
    boldness: { base: 0.18, current: 0.18, softMin: 0.08, softMax: 0.38, hardMin: 0.02, hardMax: 0.58, plasticity: 0.22 },
    independence: { base: 0.58, current: 0.58, softMin: 0.35, softMax: 0.82, hardMin: 0.2, hardMax: 0.95, plasticity: 0.25 },
  },
};
```

---

## 11. Сводная модель CharacterState v2

```typescript
export interface CharacterState {
  needs: Needs;
  relationship: Relationship;
  personality: PersonalityPreset;
  intimacy: IntimacyState;
  preferences: Record<string, PreferenceTrack>;
  lastUpdated: number;
}
```

---

## Запрещённые знания Character Engine

Character Engine не знает и не содержит:
- React components, JSX, хуки и Zustand UI-хранилища;
- DOM-элементы, CSS-стили, координаты пикселей экрана;
- Пути к ассетам, названия спрайт-листов, индексы кадров и тайминги анимаций;
- Electron BrowserWindow, IPC каналы и platform-специфичные API;
- Сетевые вызовы к сторонним AI SDK (OpenAI, Anthropic, Gemini);
- Прямые SQL-запросы (персистентность идет только через порты репозиториев в Application layer).
