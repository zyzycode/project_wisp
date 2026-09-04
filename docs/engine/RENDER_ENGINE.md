# Контракт Render Engine

`RENDER_ENGINE.md` — source of truth для визуального слоя Project Wisp: манифеста спрайтов, нарезки кадров, таймингов, композиции слоев и fallback-резолвинга.

Документ является архитектурным контрактом ядра. Implementer-агенты не меняют этот contract без Architect review.

## Владение и границы ответственности

Render Engine не принимает решений о поведении персонажа. Он получает уже принятый `AnimationIntent` из Animation Engine и детерминированно превращает его в presentation-ready описание визуальных слоев (`RenderPresentationState`).

```text
Character Engine
  -> AnimationIntent
  -> Animation Controller
  -> Asset/Fallback Resolver
  -> Animation Player
  -> RenderPresentationState
  -> ICharacterRenderer
```

- **Animation Engine:** владеет `AnimationIntent`, `kind`, `category`, `priority`, `interrupt`, `loop`, `emotionalTone`, `expressionHint` и `propHint`.
- **Asset/Fallback Resolver:** выбирает конкретные animation keys из `manifest.json`, строит слои и применяет graceful fallback.
- **Animation Player:** вычисляет активный frame по времени и loop policy на монотонных часах.
- **ICharacterRenderer:** детерминированно отображает `RenderPresentationState`.

Renderer не парсит provider DTO, не вычисляет `Needs`, не меняет FSM, не знает причины выбранного поведения и не импортирует UI-framework hooks, Vite plugins, CSS-framework classes или platform-specific APIs.

---

## 1. Manifest & Asset Metadata

`public/assets/sprites/manifest.json` является реестром доступных визуальных ресурсов.

### 1.1. Идентификаторы и категории

Animation key обязан быть стабильным snake_case идентификатором: `<layer>_<name>[_<variant>]`.

| Layer category | Назначение | Примеры keys | Manifest category |
|---|---|---|---|
| `body` | Базовый силуэт и поза персонажа | `body_idle`, `body_walk`, `body_sleep`, `body_dragged`, `body_land` | `body/<name>` |
| `face` | Полная дорожка лица или мимики | `face_idle`, `face_happy`, `face_sleepy` | `face/<name>` (legacy: `faces/<name>`) |
| `expression` / `emotion` | Частичная мимика и эмоции поверх лица | `expression_blush`, `expression_wink`, `expression_pout` | `expression/<name>` |
| `props` / `prop` | Реквизит и визуальные эффекты | `prop_pillow`, `prop_heart`, `prop_question`, `prop_sparkle` | `props/<name>` (нормализация `fx/*` в `props`) |

Нормативные правила:
- `body_*` используется исключительно для базового слоя тела.
- `face_*` и `expression_*` не могут заменять тело в цепочке fallback.
- `prop_*` используется для физического реквизита и визуальных эффектов.
- Legacy-категория `faces/<name>` нормализуется в `face/<name>`.

### 1.2. Спецификация манифеста и типы

Полная спецификация типов манифеста и ассетов определена в коде: [src/renderer/render-engine/types.ts](../../src/renderer/render-engine/types.ts).

**Выжимка структуры:**
- **4 категории слоёв:** `body`, `face`, `emotion`, `prop`.
- **Поля анимации:** `frames` (пути или дефиниции кадров), `fps`, `loop`, `pivot`, `faceOverlay`, `frameMeta`.
- `emotionalTone` в манифесте использует authoritative `SynthesizedEmotionalTone` из [`CHARACTER_ENGINE.md`](./CHARACTER_ENGINE.md#8-эмоциональный-тон-синтез-настроения).

**Правила валидации:**
- `frames` обязан быть непустым; `framesCount` (при наличии) строго равен `frames.length`.
- `fps` и `durationMs` обязаны быть строго больше `0` (нулевой FPS запрещён).
- `sourceRect` и `canvasSize` обязаны иметь положительные width и height.
- `pivot.x` и `pivot.y` задаются в исходных пикселях канваса (`source-canvas pixels`).
- Пути к файлам должны быть относительными либо от корня `/assets/...`; path traversal (`..`) запрещён.
- Отсутствие `schemaVersion` допустимо для плоского манифеста; загрузчик нормализует его во внутренний реестр `animations`.
- `faceOverlay` — обязательные метаданные для всех анимаций `body_*`.

### 1.3. Frame Timing

Длительность кадра рассчитывается на монотонных часах (`performance.now()`):

```text
frameDurationMs = 1000 / fps
```

Приоритет разрешения: `frame.durationMs -> 1000 / animation.fps -> 1000 / DEFAULT_SPRITE_FPS`.  
Дефолтные значения: `DEFAULT_SPRITE_FPS = 5` (тело), `DEFAULT_FACE_FPS = 3` (лицо).

Animation Player использует elapsed monotonic time. При больших скачках `deltaMs` происходит математический скачок к целевому кадру или завершению без пошагового цикла.

### 1.4. Sprite Slicing

- Отдельные кадры могут быть путями к PNG или вырезками атласа через `SpriteFrameDef.sourceRect`.
- Координаты `sourceRect` задаются относительно верхнего левого угла `source`.
- Разрешение pivot: `frame.pivot -> animation.pivot -> layer default`.
- Default pivot тела — точка контакта персонажа с поверхностью (`{ x: 256, y: 460 }`).
- Не-body слои объявляют явные pivots (`DEFAULT_FACE_PIVOT = { x: 256, y: 180 }`).

### 1.5. Body-to-Face Compatibility (`faceOverlay`)

Каждая запись `body_*` **обязана** объявлять объект `faceOverlay`. Он определяет возможность динамической композиции лица поверх позы тела.

| Режим | Описание | Обязательные поля | Поведение рендера |
|---|---|---|---|
| `overlay` | На спрайте тела отсутствует лицо; накладывается динамический оверлей. | Непустой `allowedFaceKeys`, `anchor: "face"`, `fallback`. | Выбирается запрошенный `face_*`; при его отсутствии используется `fallback` (или скрытие, если `none`). |
| `baked_in` | Лицо врисовано непосредственно в спрайт тела (движение/реакции). | `fallback: "none"`; запрещены `allowedFaceKeys` и `anchor`. | Оверлей полного лица никогда не рисуется. |
| `none` | Поза несовместима с оверлеем лица и не имеет врисованного лица. | `fallback: "none"`; запрещены `allowedFaceKeys` и `anchor`. | Слой лица полностью скрывается. |

**Актуальная спецификация по `manifest.json`:**
- **Режим `overlay`** (`body_idle`, `body_stand_up`, `body_sit`, `body_lie`): лицо отсутствует на спрайте тела и динамически накладывается поверх по якорю `face`. Поддерживаются 13 треков `face_*`: `face_happy`, `face_sad`, `face_shocked`, `face_sleep`, `face_talking`, `face_thinking`, `face_angry`, `face_pout`, `face_winking`, `face_curious`, `face_dizzy`, `face_flirty`, `face_gaze` (`fallback: "face_happy"`).
- **Режим `baked_in`** (`body_walk`, `body_run`, `body_dragged`, `body_fall`, `body_land`, `body_sleep` и др.): лицо врисовано в спрайт движения, оверлей скрыт (`fallback: "none"`).

**Правила валидации:**
- `faceOverlay` обязателен для всех `body_*` и запрещён для `face_*`, `expression_*`, `prop_*`.
- Для `overlay` допустимы только ключи из категории `face/*`; `anchor` обязан ссылаться на объявленный якорь; `fallback` обязан входить в `allowedFaceKeys` либо быть `"none"`.
- Для `baked_in` и `none` запрещены `allowedFaceKeys` и `anchor`, а `fallback` обязан быть `"none"` (защита от случайного «двойного лица» и угадывания позиционирования).
- Запрещён вывод оверлея без объявленного якоря в `defaultAnchors` или `frameMeta`.
- Частичный слой `expression_*` не заменяет полноразмерный трек `face_*`.

### 1.6. Система координат (Face Anchor & Pivot)

Все координаты задаются в исходных пикселях канваса спрайта (`source-canvas pixels`):
- Origin `(0, 0)` — верхний левый угол нерастянутого холста кадра; ось X направлена вправо, ось Y — вниз. Не используются CSS-пиксели и нормализованные проценты.
- **Позиционирование лица:** точка якоря тела `frameMeta[i].anchors[name] ?? defaultAnchors[name]` совмещается с локальной точкой опоры лица `faceFrame.pivot ?? faceAnimation.pivot`. При отсутствии объявленного якоря наложение недопустимо.
- **Body `pivot`:** точка опоры/контакта персонажа с поверхностью в мировых координатах (`frame.pivot ?? animation.pivot ?? DEFAULT_SPRITE_PIVOT`).
- **Тайминг треков:** кадры тела и лица независимы по таймингу и длине; для композиции на каждом тике берутся текущий активный кадр тела и текущий активный кадр оверлея.

### 1.7. Стандарт количества кадров (Frame Count Contract)

> [!IMPORTANT]
> **ПРАВИЛО КОЛИЧЕСТВА КАДРОВ В АНИМАЦИЯХ:**
> 1. **Минимум 4 кадра на анимацию:** Любая анимация персонажа (`body_*`), оверлея лица (`face_*`), изолированных зрачков (`pupils_*`) и эффектов должна содержать **4 или более кадров** (`>= 4 frames`).
> 2. **Запрет 2- и 3-кадровых анимаций:** Короткие 2- и 3-кадровые анимации **не допускаются**, так как они вызывают стробоскопический эффект и визуальные рывки при интерполяции слоёв.
> 3. **Стандартная раскладка спрайт-шитов:**
>    - **4 кадра (базовый стандарт):** 1 горизонтальный ряд × 4 колонки (`1 row × 4 columns wide strip` / файлы `_00.png`..`_03.png`).
>    - **8 кадров (расширенный стандарт, например `body_idle`):** 2 ряда × 4 колонки (`2 rows × 4 columns` / файлы `_00.png`..`_07.png`).
>    - Допускаются более длинные последовательности (>= 4 кадров), если это требуется для плавности сложного перехода или действия.

---

## 2. Layer Ordering & Blend

Разрешённое состояние рендера представляет собой детерминированный стек слоёв.

| Слой | Z-Index | Opacity | Blend Mode | Назначение |
|---|---|---|---|---|
| `body` | 10 | 1.0 | `normal` | Базовый силуэт и поза тела (`base_body`) |
| `face` | 20 | 1.0 | `normal` | Дорожка лица / оверлей (`face`) |
| `emotion` | 30 | 0.9 | `normal` | Мимика, эмоции и процедурный румянец (`expression`, `procedural_blush`) |
| `prop` | 40 | 1.0 | `normal` / `additive` / `screen` | Реквизит и спецэффекты (`prop_*`) |

**Правила композиции:**
- Процедурный румянец использует SVG radial gradient tint поверх щек и не вытесняет спрайтовые слои.
- Оверлеи реквизита позиционируются относительно root pivot персонажа.
- Реквизит с `blendMode: 'additive'` или `blendMode: 'screen'` рендерится без клиппинга базового тела.

---

## 3. Fallback Resolver & Детерминизм

### 3-уровневый Fallback Resolver

1. **Level 1 (Точный арт):**  
   Прямое совпадение `(kind, emotionalTone, hints)` с ключами манифеста. Отрисовывается специализированный спрайт/оверлей.
2. **Level 2 (Базовая поза + независимый оверлей):**  
   Если точный вариант отсутствует (`body_<kind>_<tone>` не найден), выбирается базовая поза категории (`body_<kind> -> body_idle`) с независимым наложением доступного слоя эмоции/реквизита.
3. **Level 3 (Emergency fallback):**  
   Если безопасный арт категории или слоя отсутствует, происходит откат к `body_idle` + `face_idle`. При отсутствии `face_idle` оверлей лица скрывается (`silent degradation`). При отсутствии `body_idle` активируется процедурный плейсхолдер с выводом предупреждения в лог.

### Ключевые инварианты

- **Безопасность выполнения:** Fallback никогда не выбрасывает необработанных исключений во время активного геймплея. Отсутствующие опциональные слои деградируют до отображения базового тела.
- **Сохранение семантики:** Fallback меняет исключительно визуальное представление, но **не переписывает исходный `AnimationIntent` / `BehaviorIntent`** в логике персонажа.
- **Экспрессивность:** Fallback не повышает эмоциональную экспрессивность (при отсутствии `shy` происходит откат к `idle`, а не повышение до `affectionate`).
- **Детерминированность:**
  - Нулевой FPS запрещён (`fps > 0`).
  - Отсутствие асинхронной загрузки посреди тика рендера: все ассеты должны быть загружены заранее; тик рендера синхронен и детерминирован.
  - Одинаковый входной `RenderPresentationState` гарантирует строго идентичный визуальный кадр независимо от частоты тиков.
- **Границы ответственности:** Render Engine исключительно отображает `RenderPresentationState`, не принимает поведенческих решений, не меняет FSM и изолирован от UI-фреймворков и платформенных API.
