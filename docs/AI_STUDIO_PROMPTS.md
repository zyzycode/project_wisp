# AI Studio & GPT Image Generation Prompts — Project Wisp

> [!IMPORTANT]
> **ЖЁСТКИЙ СТАНДАРТ КАДРОВ И ПРАВИЛА ПРОЕКТА:**
> 1. **СТРОГО 4 КАДРА В СТРОКУ (1 row × 4 columns):** В проекте **ЗАПРЕЩЕНЫ 2-кадровые и 3-кадровые анимации**. Все тела, оверлеи лиц, зрачки и эффекты строго генерируются и нарезаются ровно по **4 кадра** (`_00.png`, `_01.png`, `_02.png`, `_03.png`). Единственное исключение — базовый `body_idle` на **8 кадров** (сетка `2 rows × 4 columns`).
> 2. **Широкий отступ между кадрами (Wide Spacing & Padding):** Между кадрами должно быть щедрое свободное прозрачное пространство. Каждый персонаж или оверлей строго центрирован в своей квадратной ячейке, чтобы спрайты не слипались при автоматической нарезке.
> 3. **Разделение режимов наложения (`overlay` vs `baked_in`):**
>    - **Диалоговые базовые позы (`overlay`, БЕЗ ЛИЦА):** `body_idle` (основная стойка) и `body_sit` (сидение) — персонаж находится в длительном статическом контакте с пользователем. Лицо **полностью чистое (blank smooth skin)** для процедурного наложения эмоций диалога (`face_*`), моргания (`face_blink`), разговора (`face_talking`) и взгляда зрачков за курсором (`pupils_*`).
>    - **Контекстные, кинематические и сюжетные позы (`baked_in`, С ГОТОВЫМ ЛИЦОМ):** Все остальные позы генерируются **С ГОТОВЫМ ЗАПЕЧЁННЫМ ЛИЦОМ**, идеально передающим эмоцию действия:
>      - *Реакции:* `body_petting` (блаженство/румянец от поглаживания), `body_wave` (приветливая улыбка), `body_bored` (скучающий вздох), `body_celebrate` (триумф/радость), `body_scared` (испуг/дрожь), `body_thinking` (палец у подбородка).
>      - *Физика и перемещение Shimeji:* `body_dragged` (подхват мышью), `body_fall` (испуг при падении), `body_land` (зажмуривание при ударе), `body_recover` (потирает шишку), `body_jump` (радостный прыжок), `body_ceiling_hang` (висение на потолке), `body_crash_splat` (шлёпок о пол 'x_x'), `body_walk` (ходьба в 3/4), `body_run` (быстрый бег в 3/4), `body_climb_wall` (ползание по стене), `body_sleep` / `body_sleep_trans` (сон), `body_lie` (отдых на животе).
> 4. **Нативная поддержка альфа-канала:** Все файлы генерируются и сохраняются как PNG-32 с истинной прозрачностью.

---

## 🎯 План первоочередных задач генерации

### 🔥 Очередь 1: Диалоговые позы тела БЕЗ ЛИЦА (Faceless Base Body)
> [!NOTE]
> Только 2 позы требуют генерации без лица — на них персонаж общается с пользователем через чат-бокс и следит за курсором!

1. 🔄 `B00. body_idle` — без лица (**8 кадров**, `2x4`) — *основная стойка 80% времени*
2. ⏳ `B12. body_sit` — без лица (**4 кадра**, `1x4`) — *сидение на панели задач / окнах*
3. ⏳ `B13. body_stand_up` — без лица или нейтральная (**4 кадра**, `1x4`) — *вставание из сидения*

---

### 🏃 Очередь 2: Новые физические позы Shimeji С ГОТОВЫМ ЛИЦОМ (`baked_in`, строго 4 кадра)
> [!NOTE]
> Лицо рисуется прямо в кадре под конкретную анимацию и ракурс.

1. ⏳ `B14. body_lie` — **С ЛИЦОМ** (**4 кадра**, `1x4`) — *лежит на животике, качает ножками, смотрит снизу вверх*
2. ⏳ `B15. body_run` — **С ЛИЦОМ** (**4 кадра**, `1x4`) — *быстрый бег в профиль 3/4*
3. ⏳ `B16. body_fall` — **С ЛИЦОМ** (**4 кадра**, `1x4`) — *паническое падение в воздухе с кричащим ротиком*
4. ⏳ `B17. body_crash_splat` — **С ЛИЦОМ** (**4 кадра**, `1x4`) — *комичный шлёпок о пол 'x_x'*
5. ⏳ `B18. body_recover` — **С ЛИЦОМ** (**4 кадра**, `1x4`) — *подъём с пола, потирает шишку на голове*
6. ⏳ `B19. body_climb_wall` — **С ЛИЦОМ** (**4 кадра**, `1x4`) — *карабканье по стене в профиль*
7. ⏳ `B20. body_ceiling_hang` — **С ЛИЦОМ** (**4 кадра**, `1x4`) — *висение на кромке экрана, смотрит вниз*
8. ⏳ `B21. body_jump` — **С ЛИЦОМ** (**4 кадра**, `1x4`) — *радостный подскок «Хопа!»*

*(Уже полностью готовы на диске с запечённым лицом: `body_petting`, `body_wave`, `body_bored`, `body_land`, `body_dragged`, `body_walk`, `body_thinking`, `body_sleep`, `body_sleep_trans`, `body_celebrate`, `body_scared`)*.

---

### 🎭 Очередь 3: Оверлеи лиц и зрачков для `body_idle` и `body_sit` (СТРОГО 4 кадра на прозрачном фоне)
> [!IMPORTANT]
> Все оверлеи эмоций и зрачков накладываются на `body_idle` и `body_sit` и содержат ровно 4 кадра (`_00`..`_03`).

* `F01. face_curious` (**4 кадра**) — интерес и любопытство
* `F07. pupils_normal` (**4 кадра**) — изолированные зрачки со сменой бликов (для слежения за курсором)
* `F08. pupils_directional` (**4 кадра**) — изолированные зрачки (L, R, U, D)
* `F09. face_blink` (**4 кадра**) — моргание в idle
* `F10. face_smug` (**4 кадра**) — ухмылка
* `F11. face_crying` (**4 кадра**) — аниме-слёзки
* `F12` (`happy`), `F13` (`sad`), `F14` (`angry`), `F15` (`sleep`), `F16` (`thinking`), `F17` (`talking`), `F02` (`dizzy`), `F03` (`shocked`), `F04` (`flirty`), `F05` (`winking`), `F06` (`pout`).

---

## 🏗️ Архитектура слоёв (Layer Stacking Architecture)

```text
┌─────────────────────────────────────────────────────────────┐
│  Z-Index 40..43:  Props & FX (prop_pillow, prop_heart, etc) │
│  Z-Index 30:      Procedural Blush (SVG radial cheek tint)  │
│  Z-Index 25:      Pupils Layer (pupils_normal, tracking)   │
│  Z-Index 20:      Face Overlay (face_happy, curious, etc)   │
│  Z-Index 10:      Base Body (Faceless body sprite)          │
│  Z-Index 0:       Shadows / Ground props                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 📋 Сводная матрица поз тела

| ID | Ключ анимации | Описание позы | Ракурс | Режим в движке | Кадров | Текущий статус |
|---|---|---|---|---|---|---|
| **B00** | `body_idle` | Базовая стойка (дыхание) | Анфас | `overlay` (без лица) | 8 (2x4) | 🔄 **Перегенерировать БЕЗ ЛИЦА** |
| **B01** | `body_walk` | Шаги / Ходьба | Профиль 3/4 | `baked_in` (с лицом) | 4 (1x4) | ✅ **Готово (Запечённое лицо)** |
| **B02** | `body_thinking` | Размышление / Мысли | Анфас/3/4 | `baked_in` (с лицом) | 4 (1x4) | ✅ **Готово (Запечённое лицо)** |
| **B03** | `body_dragged` | Перетаскивание мышью | Анфас | `baked_in` (с лицом) | 4 (1x4) | ✅ **Готово (Запечённое лицо)** |
| **B04** | `body_land` | Приземление (зажмуривание) | Анфас | `baked_in` (с лицом) | 4 (1x4) | ✅ **Готово (Запечённое лицо)** |
| **B05** | `body_petting` | Реакция на поглаживание | Анфас | `baked_in` (с лицом) | 4 (1x4) | ✅ **Готово (Запечённое лицо)** |
| **B06** | `body_sleep` | Поза сна на полу | Профиль | `baked_in` (с лицом) | 4 (1x4) | ✅ **Готово (Запечённое лицо)** |
| **B07** | `body_sleep_trans` | Укладывание спать | Профиль | `baked_in` (с лицом) | 4 (1x4) | ✅ **Готово (Запечённое лицо)** |
| **B08** | `body_wave` | Взмах ручкой (приветствие) | Анфас | `baked_in` (с лицом) | 4 (1x4) | ✅ **Готово (Запечённое лицо)** |
| **B09** | `body_celebrate` | Празднование / Радость | Анфас | `baked_in` (с лицом) | 4 (1x4) | ✅ **Готово (Запечённое лицо)** |
| **B10** | `body_scared` | Дрожь / Испуг тела | Анфас | `baked_in` (с лицом) | 4 (1x4) | ✅ **Готово (Запечённое лицо)** |
| **B11** | `body_bored` | Скука / Вздох | Анфас | `baked_in` (с лицом) | 4 (1x4) | ✅ **Готово (Запечённое лицо)** |
| **B12** | `body_sit` | Сидит на полу / окне | Анфас | `overlay` (без лица) | 4 (1x4) | ⏳ **В очереди (БЕЗ ЛИЦА)** |
| **B13** | `body_stand_up` | Вставание на ноги | Анфас | `overlay` (без лица) | 4 (1x4) | ⏳ **В очереди (БЕЗ ЛИЦА)** |
| **B14** | `body_lie` | Лежит на животе | Анфас/3/4 | `baked_in` (с лицом) | 4 (1x4) | ⏳ **В очереди (С ГОТОВЫМ ЛИЦОМ)** |
| **B15** | `body_run` | Быстрый бег | Профиль 3/4 | `baked_in` (с лицом) | 4 (1x4) | ⏳ **В очереди (С ГОТОВЫМ ЛИЦОМ)** |
| **B16** | `body_fall` | Паническое падение | Анфас | `baked_in` (с лицом) | 4 (1x4) | ⏳ **В очереди (С ГОТОВЫМ ЛИЦОМ)** |
| **B17** | `body_crash_splat` | Шлёпок о пол 'x_x' | Анфас | `baked_in` (с лицом) | 4 (1x4) | ⏳ **В очереди (С ГОТОВЫМ ЛИЦОМ)** |
| **B18** | `body_recover` | Подъём (трёт шишку) | Анфас | `baked_in` (с лицом) | 4 (1x4) | ⏳ **В очереди (С ГОТОВЫМ ЛИЦОМ)** |
| **B19** | `body_climb_wall` | Ползание по краю экрана | Профиль | `baked_in` (с лицом) | 4 (1x4) | ⏳ **В очереди (С ГОТОВЫМ ЛИЦОМ)** |
| **B20** | `body_ceiling_hang` | Висение на потолке | Анфас | `baked_in` (с лицом) | 4 (1x4) | ⏳ **В очереди (С ГОТОВЫМ ЛИЦОМ)** |
| **B21** | `body_jump` | Радостный подскок | Анфас | `baked_in` (с лицом) | 4 (1x4) | ⏳ **В очереди (С ГОТОВЫМ ЛИЦОМ)** |

---

# 🏃 БЛОК 1: Промпты поз тела (Base Body Prompts)

---

### B00. `body_idle` | Базовое стояние / Дыхание (8 кадров, 2 строки × 4 колонки)
* **Ракурс:** Анфас | **Тип:** Модульная (`overlay`) | **Статус:** 🔄 **Требуется перегенерация БЕЗ ЛИЦА**
* **Папка:** `public/assets/sprites/body/idle/` | **Файлы:** `body_idle_00.png` — `body_idle_07.png`

```text
Using the EXACT character design, hair style, chibi body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 8 equal square frames arranged in a 2 ROWS × 4 COLUMNS grid, read left-to-right, top-to-bottom as Frames 0 to 7.

SPACING & PADDING (CRITICAL):
- Ensure generous empty transparent spacing and wide margins between all frames.
- Each character must be strictly centered within its own square cell with ample transparent padding around it.
- Absolutely NO overlapping, crowding, or touching between adjacent frames (hair, limbs, and dress must stay strictly inside each cell).

CRITICAL FACELESS RULE:
- The head silhouette, long hair, bangs, hair accessories, dress, and limbs must be fully rendered facing front toward viewer.
- THE FACE AREA ON THE HEAD MUST BE COMPLETELY BLANK SMOOTH SKIN COLOR (ABSOLUTELY NO EYES, NO EYEBROWS, NO NOSE, NO MOUTH). This body sprite is designed to have modular face overlays rendered on top.

Stability rules:
- Character keeps identical scale (height 385-390px), line art thickness, and outfit across all 8 frames.
- Centered horizontally in each cell (X=256 relative to cell).
- Feet firmly on the floor baseline (Y=460 relative to cell).
- 100% transparent background alpha (no backdrop, no floor shadow, no white boxes).

Animation Breakdown (Gentle Breathing Loop):
- Frame 0: Natural standing pose, weight balanced on both feet, hands at sides.
- Frame 1: Inhale start, chest and shoulders rise +1px, dress hem and hair tips lift subtly.
- Frame 2: Inhale peak, torso lifted +2px, gentle airy float of hair strands.
- Frame 3: Exhale transition, body softly lowering back down.
- Frame 4: Rest at bottom baseline, relaxed stance.
- Frame 5: Second subtle micro-sway, slight weight shift to left leg (+1px sway).
- Frame 6: Centering posture, hands relaxing.
- Frame 7: Settling back smoothly into Frame 0 position for seamless loop.
```

---

### B01. `body_walk` | Шаги / Ходьба (4 кадра, 1 строка × 4 колонки)
* **Ракурс:** Профиль 3/4 | **Тип:** Законченная (`baked_in`) | **Статус:** ✅ **Готово (Запечённое лицо)**
* **Папка:** `public/assets/sprites/body/walk/` | **Файлы:** `body_walk_00.png` — `body_walk_03.png`

---

### B02. `body_thinking` | Поза размышления (4 кадра, 1 строка × 4 колонки)
* **Ракурс:** Анфас/3/4 | **Тип:** Законченная (`baked_in`) | **Статус:** ✅ **Готово (Запечённое лицо)**
* **Папка:** `public/assets/sprites/body/thinking/` | **Файлы:** `body_thinking_00.png` — `body_thinking_03.png`

---

### B03. `body_dragged` | Перетаскивание мышью (4 кадра, 1 строка × 4 колонки)
* **Ракурс:** Анфас | **Тип:** Законченная (`baked_in`) | **Статус:** ✅ **Готово (Запечённое лицо)**
* **Папка:** `public/assets/sprites/body/dragged/` | **Файлы:** `body_dragged_00.png` — `body_dragged_03.png`

---

### B04. `body_land` | Приземление на пол (4 кадра, 1 строка × 4 колонки)
* **Ракурс:** Анфас | **Тип:** Законченная (`baked_in`) | **Статус:** ✅ **Готово (Запечённое лицо)**
* **Папка:** `public/assets/sprites/body/land/` | **Файлы:** `body_land_00.png` — `body_land_03.png`

---

### B05. `body_petting` | Реакция на поглаживание (4 кадра, 1 строка × 4 колонки)
* **Ракурс:** Анфас | **Тип:** Законченная (`baked_in`) | **Статус:** ✅ **Готово (Запечённое лицо)**
* **Папка:** `public/assets/sprites/body/petting/` | **Файлы:** `body_petting_00.png` — `body_petting_03.png`

---

### B06. `body_sleep` | Поза сна на полу (4 кадра, 1 строка × 4 колонки)
* **Ракурс:** Профиль | **Тип:** Законченная (`baked_in`) | **Статус:** ✅ **Готово (Запечённое лицо)**
* **Папка:** `public/assets/sprites/body/sleep/` | **Файлы:** `body_sleep_00.png` — `body_sleep_03.png`

---

### B07. `body_sleep_trans` | Укладывание спать (4 кадра, 1 строка × 4 колонки)
* **Ракурс:** Профиль | **Тип:** Законченная (`baked_in`) | **Статус:** ✅ **Готово (Запечённое лицо)**
* **Папка:** `public/assets/sprites/body/sleep_transition/` | **Файлы:** `body_sleep_trans_00.png` — `body_sleep_trans_03.png`

---

### B08. `body_wave` | Взмах ручкой / Приветствие (4 кадра, 1 строка × 4 колонки)
* **Ракурс:** Анфас | **Тип:** Законченная (`baked_in`) | **Статус:** ✅ **Готово (Запечённое лицо)**
* **Папка:** `public/assets/sprites/body/wave/` | **Файлы:** `body_wave_00.png` — `body_wave_03.png`

---

### B09. `body_celebrate` | Празднование / Радость (4 кадра, 1 строка × 4 колонки)
* **Ракурс:** Анфас | **Тип:** Законченная (`baked_in`) | **Статус:** ✅ **Готово (Запечённое лицо)**
* **Папка:** `public/assets/sprites/body/celebrate/` | **Файлы:** `body_celebrate_00.png` — `body_celebrate_03.png`

---

### B10. `body_scared` | Дрожь тела / Испуг (4 кадра, 1 строка × 4 колонки)
* **Ракурс:** Анфас | **Тип:** Законченная (`baked_in`) | **Статус:** ✅ **Готово (Запечённое лицо)**
* **Папка:** `public/assets/sprites/body/scared/` | **Файлы:** `body_scared_00.png` — `body_scared_03.png`

---

### B11. `body_bored` | Скука / Вздох (4 кадра, 1 строка × 4 колонки)
* **Ракурс:** Анфас | **Тип:** Законченная (`baked_in`) | **Статус:** ✅ **Готово (Запечённое лицо)**
* **Папка:** `public/assets/sprites/body/bored/` | **Файлы:** `body_bored_00.png` — `body_bored_03.png`

---

### B12. `body_sit` | Сидит на полу / окне (4 кадра, 1 строка × 4 колонки)
* **Ракурс:** Анфас | **Тип:** Модульная (`overlay`) | **Статус:** ⏳ **В очереди на генерацию (БЕЗ ЛИЦА)**
* **Папка:** `public/assets/sprites/body/sit/` | **Файлы:** `body_sit_00.png` — `body_sit_03.png`

```text
Using the EXACT character design, hair style, chibi body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous empty transparent spacing and wide margins between all frames.
- Seated character centered in each cell with clear empty padding.

CRITICAL FACELESS RULE:
- Character facing front.
- The face area on the head MUST BE COMPLETELY BLANK SMOOTH SKIN COLOR (NO EYES, NO NOSE, NO MOUTH) for modular dialog overlays.

Animation Breakdown:
- Frame 1: Sits comfortably on the ground facing forward, hands resting softly on knees, legs folded cutely.
- Frame 2: Inhale start, chest and shoulders rise slightly (+2px), hair tips float subtly.
- Frame 3: Gentle weight shift to one side, leaning slightly on one hand, hair resting.
- Frame 4: Exhale and settle smoothly back into Frame 1 position.
```

---

### B13. `body_stand_up` | Вставание на ноги (4 кадра, 1 строка × 4 колонки)
* **Ракурс:** Анфас | **Тип:** Модульная (`overlay`) | **Статус:** ⏳ **В очереди на генерацию (БЕЗ ЛИЦА)**
* **Папка:** `public/assets/sprites/body/stand_up/` | **Файлы:** `body_stand_up_00.png` — `body_stand_up_03.png`

```text
Using the EXACT character design, hair style, chibi body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous empty transparent spacing and wide margins between all frames.

CRITICAL FACELESS RULE:
- Character facing front.
- The face area on the head MUST BE COMPLETELY BLANK SMOOTH SKIN COLOR (NO EYES, NO NOSE, NO MOUTH).

Animation Breakdown:
- Frame 1: Seated posture, hands placed on the floor for support.
- Frame 2: Pushes up from floor onto knees and balls of feet (half-crouch).
- Frame 3: Straightening legs, standing up tall, hands swinging naturally to sides.
- Frame 4: Standard upright standing idle posture, fully balanced on feet.
```

---

### B14. `body_lie` | Лежит на животе / боку (4 кадра, 1 строка × 4 колонки)
* **Ракурс:** Анфас / 3/4 | **Тип:** Законченная (`baked_in`) | **Статус:** ⏳ **В очереди на генерацию (С ГОТОВЫМ ЛИЦОМ)**
* **Папка:** `public/assets/sprites/body/lie/` | **Файлы:** `body_lie_00.png` — `body_lie_03.png`

```text
Using the EXACT character design, hair style, chibi body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous empty transparent spacing and wide margins between all frames.
- Horizontally lying body must fit cleanly inside each square cell without touching edges.

EXPRESSIVE LYING POSE WITH BAKED-IN FACE (CRITICAL):
- Face turned toward viewer with cute expressive anime face (warm eyes looking up at viewer, sweet smile).
- Character lying cute and cozy on the floor baseline (Y=460).

Animation Breakdown (Lying on stomach with cute kicking feet):
- Frame 1: Lying on tummy/side resting on elbows, legs slightly raised behind, cute sweet smile looking toward viewer.
- Frame 2: Gentle leg sway, one foot kicks up cutely in the air, playful cheerful expression.
- Frame 3: Other foot kicks up, chest rises slightly with gentle breathing, peaceful happy face.
- Frame 4: Feet lower softly, returning smoothly to Frame 1.
```

---

### B15. `body_run` | Быстрый бег (4 кадра, 1 строка × 4 колонки)
* **Ракурс:** Профиль 3/4 | **Тип:** Законченная (`baked_in`) | **Статус:** ⏳ **В очереди на генерацию (С ГОТОВЫМ ЛИЦОМ)**
* **Папка:** `public/assets/sprites/body/run/` | **Файлы:** `body_run_00.png` — `body_run_03.png`

```text
Using the EXACT character design, hair style, chibi body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous empty transparent spacing and wide margins between all frames.
- Running strides and trailing hair must stay strictly inside each square cell.

Animation Breakdown (Fast Run in 3/4 Profile with Determined Energetic Eyes):
- Frame 1 (Left Leg Contact): Left leg takes a long forward running stride, right leg trailing back, right arm forward, hair flying backward with inertia.
- Frame 2 (Passing Flight): Both feet off the floor, body lifted (+6px) in airborne phase, legs passing each other.
- Frame 3 (Right Leg Contact): Right foot takes a long forward running stride, left leg trailing back, left arm forward, hair flowing backward.
- Frame 4 (Second Flight): Both feet off the floor, body lifted in airborne phase, ready to loop into Frame 1.
```

---

### B16. `body_fall` | Паническое падение в воздухе (4 кадра, 1 строка × 4 колонки)
* **Ракурс:** Анфас | **Тип:** Законченная (`baked_in`) | **Статус:** ⏳ **В очереди на генерацию (С ГОТОВЫМ ЛИЦОМ)**
* **Папка:** `public/assets/sprites/body/fall/` | **Файлы:** `body_fall_00.png` — `body_fall_03.png`

```text
Using the EXACT character design, hair style, chibi body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous empty transparent spacing and wide margins between all frames.
- Upward billowing hair and dress must not touch top or side boundaries of the cell.

Animation Breakdown (Panicked Airborne Fall with Expressive Face):
- Frame 1: Falling pose, wide startled eyes (O_O), shouting open mouth, arms reaching upward, legs dangling slightly, hair billowing up.
- Frame 2: Flails left arm and kicks right leg, frightened expression with tear glints, hair swaying left.
- Frame 3: Flails right arm and kicks left leg, wide gasping mouth, hair swaying right.
- Frame 4: Arms spread out for wind balance, wide frightened eyes, hair billowing high, loops back to Frame 1.
```

---

### B17. `body_crash_splat` | Шлёпок о пол / Расплющивание (4 кадра, 1 строка × 4 колонки)
* **Ракурс:** Анфас | **Тип:** Законченная (`baked_in`) | **Статус:** ⏳ **В очереди на генерацию (С ГОТОВЫМ ЛИЦОМ 'x_x')**
* **Папка:** `public/assets/sprites/body/crash_splat/` | **Файлы:** `body_crash_splat_00.png` — `body_crash_splat_03.png`

```text
Using the EXACT character design, hair style, chibi body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous empty transparent spacing and wide margins between all frames.
- Fully flattened pancake pose must remain centered in each square cell without touching borders.

Animation Breakdown (Hard Impact with Comical Flat Face):
- Frame 1 (Anticipation): Just 10px above floor, toes pointed down, bracing for impact with squeezed shut eyes.
- Frame 2 (Hard Impact): Extreme squashed pose flat on the floor, knees bent wide, hair and dress splayed outward, dazed spiral eyes (@_@).
- Frame 3 (Flat Splat): Comical flat pancake starfish pose completely flat on the floor baseline, arms and legs spread out wide, flat 'x_x' face with tongue out.
- Frame 4 (Squished Wobble): Flat on floor, slight dazed jiggle vibration.
```

---

### B18. `body_recover` | Подъём и отряхивание / Потирает шишку (4 кадра, 1 строка × 4 колонки)
* **Ракурс:** Анфас | **Тип:** Законченная (`baked_in`) | **Статус:** ⏳ **В очереди на генерацию (С ГОТОВЫМ ЛИЦОМ)**
* **Папка:** `public/assets/sprites/body/recover/` | **Файлы:** `body_recover_00.png` — `body_recover_03.png`

```text
Using the EXACT character design, hair style, chibi body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous empty transparent spacing and wide margins between all frames.

Animation Breakdown (Recovering with Cute Pout Face):
- Frame 1: Pushes upper body off the floor on hands, knees still on ground, dizzy half-closed eyes.
- Frame 2: Gets onto knees, rubs bump/head with one hand, cute grumpy pout face (>_<).
- Frame 3: Steps up onto one foot, rising upward, dusting off dress with other hand.
- Frame 4: Stands tall on both feet, quick final shake/dust-off, proud cute determined smile, transitioning back to idle.
```

---

### B19. `body_climb_wall` | Ползание по краю экрана (4 кадра, 1 строка × 4 колонки)
* **Ракурс:** Профиль | **Тип:** Законченная (`baked_in`) | **Статус:** ⏳ **В очереди на генерацию (С ГОТОВЫМ ЛИЦОМ)**
* **Папка:** `public/assets/sprites/body/climb_wall/` | **Файлы:** `body_climb_wall_00.png` — `body_climb_wall_03.png`

```text
Using the EXACT character design, hair style, chibi body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous empty transparent spacing between all frames.

Animation Breakdown (Climbing wall vertically in side profile with focused eyes looking up):
- Frame 1: Right hand reaches high up the wall, left knee bent grabbing wall lower, body close to wall, focused eyes looking up.
- Frame 2: Pulls body upward with right arm, left foot pushes off.
- Frame 3: Left hand reaches high up to next grab point, right foot steps up.
- Frame 4: Pulls body up with left arm, transitioning smoothly back to Frame 1.
```

---

### B20. `body_ceiling_hang` | Висение на верхнем краю (4 кадра, 1 строка × 4 колонки)
* **Ракурс:** Анфас | **Тип:** Законченная (`baked_in`) | **Статус:** ⏳ **В очереди на генерацию (С ГОТОВЫМ ЛИЦОМ)**
* **Папка:** `public/assets/sprites/body/ceiling_hang/` | **Файлы:** `body_ceiling_hang_00.png` — `body_ceiling_hang_03.png`

```text
Using the EXACT character design, hair style, chibi body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous empty transparent spacing between all frames.

Animation Breakdown (Hanging from ceiling with cute strained/curious face):
- Frame 1: Hanging straight down gripping ceiling, curious eyes looking down at desktop, legs dangling together.
- Frame 2: Gentle sway to the left, legs swing slightly to left side, cute small smile.
- Frame 3: Centered hang, slight pull-up bend in elbows (+4px lift), cute concentrated look.
- Frame 4: Gentle sway to the right, legs swing slightly to right side.
```

---

### B21. `body_jump` | Радостный прыжок / Подскок (4 кадра, 1 строка × 4 колонки)
* **Ракурс:** Анфас | **Тип:** Законченная (`baked_in`) | **Статус:** ⏳ **В очереди на генерацию (С ГОТОВЫМ ЛИЦОМ)**
* **Папка:** `public/assets/sprites/body/jump/` | **Файлы:** `body_jump_00.png` — `body_jump_03.png`

```text
Using the EXACT character design, hair style, chibi body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous empty transparent spacing and wide margins between all frames.

Animation Breakdown (Joyful Jump with Cheerful Face):
- Frame 1 (Crouch Prep): Knees bent low (crouch), arms swinging back, happy excited smile.
- Frame 2 (Ascent Launch): Pushes hard off the ground, body launching upward into the air (+40px), laughing open mouth.
- Frame 3 (Apex Flight): High airborne pose, arms spread out happily, dress and hair floating in mid-air, bright sparkling happy eyes.
- Frame 4 (Landing Cushion): Feet contact floor baseline, knees bending to absorb the jump landing, satisfied warm smile.
```

---

# 🎭 БЛОК 2: Промпты оверлеев лиц и зрачков (Face Overlays, СТРОГО 4 кадра)

> [!IMPORTANT]
> **ПРАВИЛО ОВЕРЛЕЕВ ЛИЦ:**
> Генерируются **только черты лица** (глаза, брови, нос, рот).
> **Строго запрещено рисовать контур головы, волосы, уши, шею и овал лица!**
> **Отступы:** каждая группа черт лица строго центрирована в своей ячейке с широкими прозрачными полями вокруг.

---

### F01. `face_curious` | Любопытство / Интерес (4 кадра, 1 строка × 4 колонки)
* **Папка:** `public/assets/sprites/faces/curious/` | **Файлы:** `face_curious_00.png` — `face_curious_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a clean 2D facial feature overlay sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous transparent empty padding between all 4 cells.
- Each face feature set must be strictly centered in its respective square cell (facial zone X:176-336, Y:110-220 within 512x512 canvas).
- No bleeding, touching, or crowding between adjacent frames.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth, and small expression FX.
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- The entire background and area around the eyes and mouth must be 100% transparent alpha (no solid color, no background box, no fake checkerboard pattern).

Animation Breakdown:
- Frame 1: One eyebrow slightly raised, eyes looking slightly up-left, small cute closed mouth.
- Frame 2: Curious head-tilt expression, eyes looking further to upper-left, soft pleasant mouth.
- Frame 3: Wonder and realization, sparkling wide curious eyes with small star glints, tiny "o" mouth.
- Frame 4: Satisfied warm smile, eyes relaxed and centering back.
```

---

### F02. `face_dizzy` | Спиральки в глазах / Головокружение (4 кадра, 1 строка × 4 колонки)
* **Папка:** `public/assets/sprites/faces/dizzy/` | **Файлы:** `face_dizzy_00.png` — `face_dizzy_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a clean 2D facial feature overlay sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous transparent empty padding between all 4 cells.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth, and small expression FX (sweat drops, stars).
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- 100% transparent background alpha.

Animation Breakdown:
- Frame 1: Spiral swirl pupils starting to spin, wavy wobbly mouth (~), tiny anime sweat droplet.
- Frame 2: Large white-and-dark spiral swirl eyes, wavy open mouth, dizzy pink blush cheeks.
- Frame 3: Dizzy spiral eyes rotated 180 degrees, funny tongue-out wobbly mouth, spinning stars near cheeks.
- Frame 4: Recovering half-closed dizzy eyes, small dazed "o" mouth.
```

---

### F03. `face_shocked` | Испуг / Шок (4 кадра, 1 строка × 4 колонки)
* **Папка:** `public/assets/sprites/faces/shocked/` | **Файлы:** `face_shocked_00.png` — `face_shocked_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a clean 2D facial feature overlay sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous transparent empty padding between all 4 cells.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth, and small expression FX (sweat drops).
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- 100% transparent background alpha.

Animation Breakdown:
- Frame 1: High raised eyebrows, wide rounded eyes with focused pupils, tiny "o" mouth.
- Frame 2: High arched startled brows, wide round eyes with tiny dot pupils, open oval gasp mouth (O), tiny sweat drop near temple.
- Frame 3: Wide sparkling surprised eyes, raised brows, open cute mouth.
- Frame 4: Calming down, eyes slightly relaxing, mouth closing to a soft "o".
```

---

### F04. `face_flirty` | Смущение / Нежный румянец / Флирт (4 кадра, 1 строка × 4 колонки)
* **Папка:** `public/assets/sprites/faces/flirty/` | **Файлы:** `face_flirty_00.png` — `face_flirty_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a clean 2D facial feature overlay sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous transparent empty padding between all 4 cells.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth, and pink blush with cute diagonal blush hatch lines.
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- 100% transparent background alpha.

Animation Breakdown:
- Frame 1: Shy downward-sideways glance, soft light rosy blush on cheeks, timid small mouth line.
- Frame 2: Deeper rosy blush with cute diagonal blush hatching lines, sideways bashful glance, shy smile.
- Frame 3: Flustered closed curved anime eyes (^ ^), bright red blush cheeks, embarrassed wavy mouth.
- Frame 4: Shy peek, one eye softly peeking, bright blush, timid sweet smile.
```

---

### F05. `face_winking` | Игривое подмигивание (4 кадра, 1 строка × 4 колонки)
* **Папка:** `public/assets/sprites/faces/winking/` | **Файлы:** `face_winking_00.png` — `face_winking_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a clean 2D facial feature overlay sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous transparent empty padding between all 4 cells.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth, and small sparkle FX.
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- 100% transparent background alpha.

Animation Breakdown:
- Frame 1: Cheerful open sparkling eyes, bright smile.
- Frame 2: Left eye closing into a sharp wink curve with a tiny yellow star glint, right eye wide and open, cheeky grin.
- Frame 3: Full wink hold, left eye closed in a clean lash curve with sparkle accent, right eye wide, happy open smile with blush.
- Frame 4: Left eye reopening smoothly, cheerful relaxed smile.
```

---

### F06. `face_pout` | Надутые щёчки / Милая обида (4 кадра, 1 строка × 4 колонки)
* **Папка:** `public/assets/sprites/faces/pout/` | **Файлы:** `face_pout_00.png` — `face_pout_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a clean 2D facial feature overlay sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous transparent empty padding between all 4 cells.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth, and puffed cheek blush.
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- 100% transparent background alpha.

Animation Breakdown:
- Frame 1: Mild annoyance, slightly furrowed brows, side glance, small cute protruded pout mouth (3).
- Frame 2: Puffed cheeks start, cheeks expanding with rosy blush, annoyed side-glance, puffed '3' mouth.
- Frame 3: Full cute pout, cheeks fully puffed with blush and cute puff outline curves, furrowed brows, turned-away eyes, grumpy-cute '3' mouth.
- Frame 4: Stubborn cute pout hold, eyes glancing back toward viewer.
```

---

### F07. `pupils_normal` | Изолированные зрачки (Центральный взгляд для Gaze Tracking, 4 кадра)
* **Папка:** `public/assets/sprites/faces/pupils/` | **Файлы:** `pupils_normal_00.png` — `pupils_normal_03.png`

```text
Using the EXACT eye color, iris gradient, pupil core, specular highlights, and eye-spacing from the ATTACHED REFERENCE IMAGE, generate an isolated pair of pupils for procedural eye tracking as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames arranged side-by-side in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous transparent empty padding between all 4 cells.
- Each pupil pair must be strictly centered horizontally and vertically at the proper eye coordinate in each square frame.

CRITICAL RULES:
- ONLY draw the isolated pair of pupils and irises (left pupil and right pupil).
- DO NOT draw eyelashes, eyelids, sclera (white of eye), skin, eyebrows, head, or body.
- 100% transparent background alpha.

Breakdown:
- Frame 1: Standard isolated pupil pair looking straight forward with specular highlights.
- Frame 2: Same isolated pupil pair with an extra subtle star glint highlight.
- Frame 3: Slightly enlarged soft pupils with warm gentle specular reflection.
- Frame 4: Normal focused pupil pair ready to loop back to Frame 1.
```

---

### F08. `pupils_directional` | Направленный взгляд зрачков (Влево, Вправо, Вверх, Вниз, 4 кадра)
* **Папка:** `public/assets/sprites/faces/pupils/` | **Файлы:** `pupils_directional_00.png` — `pupils_directional_03.png`

```text
Using the EXACT eye color, iris gradient, pupil core, specular highlights, and eye-spacing from the ATTACHED REFERENCE IMAGE, generate a set of isolated pupil pairs looking in 4 distinct cardinal directions as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames arranged side-by-side in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous transparent empty padding between all 4 cells.

CRITICAL RULES:
- ONLY draw the isolated pair of pupils and irises (left pupil and right pupil).
- DO NOT draw eyelashes, eyelids, sclera (white of eye), skin, eyebrows, head, or body.
- Maintain the exact eye-spacing distance matching the reference image.
- 100% transparent alpha background.

Directional Breakdown:
- Frame 1 (Looking Left): Both pupils and irises shifted toward the left side of the eye zone.
- Frame 2 (Looking Right): Both pupils and irises shifted toward the right side of the eye zone.
- Frame 3 (Looking Up): Both pupils and irises shifted upward (looking up toward cursor or sky).
- Frame 4 (Looking Down): Both pupils and irises shifted downward (looking down at floor).
```

---

### F09. `face_blink` | Цикл моргания глазами (для живого Idle, 4 кадра)
* **Папка:** `public/assets/sprites/faces/blink/` | **Файлы:** `face_blink_00.png` — `face_blink_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a natural 4-frame eye blink animation overlay sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous transparent empty padding between all 4 cells.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyelashes, eyebrows, nose, and mouth.
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- 100% transparent background alpha.

Animation Breakdown (Natural Blink):
- Frame 1: Fully open calm eyes, relaxed gentle smile.
- Frame 2: Half-closed eyelids descending (50% closed), eyelashes lowering.
- Frame 3: Fully closed eyes in cute clean curved eyelash lines (^_^) with relaxed eyebrows and smile.
- Frame 4: Eyes reopening back to 70% open, ready to smoothly return to Frame 1.
```

---

### F10. `face_smug` | Довольная ухмылка / Хитрая моська (4 кадра, 1 строка × 4 колонки)
* **Папка:** `public/assets/sprites/faces/smug/` | **Файлы:** `face_smug_00.png` — `face_smug_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a cute anime smug / cheeky facial feature overlay sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous transparent empty padding between all 4 cells.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth, and cheek blush.
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- 100% transparent background alpha.

Animation Breakdown:
- Frame 1: Playful side-glance, confident arched eyebrows, small playful smirk mouth.
- Frame 2: Half-lidded proud eyes looking at viewer, smug cat-like ':3' mouth, slight blush.
- Frame 3: Cheerful closed curved eyes (^ω^), wide proud cheeky grin, small blush accents.
- Frame 4: Reopening eyes with sparkling confident glint, satisfied cute smile.
```

---

### F11. `face_crying` | Сильное огорчение / Аниме-слёзки (4 кадра, 1 строка × 4 колонки)
* **Папка:** `public/assets/sprites/faces/crying/` | **Файлы:** `face_crying_00.png` — `face_crying_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a comical / dramatic cute crying face overlay sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous transparent empty padding between all 4 cells.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth, and translucent blue anime tear streams.
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- 100% transparent background alpha.

Animation Breakdown:
- Frame 1: Big watery wobbly eyes full of tears, quivering sad mouth, furrowed distressed brows.
- Frame 2: Tear drops welling up and spilling from corner of eyes, open crying mouth (D:).
- Frame 3: Comical stream of anime waterfall tears flowing from eyes, wide wailing mouth, blush.
- Frame 4: Sniffling, half-closed teary eyes with cute cheek teardrops, trembling small pout mouth.
```

---

### F12. `face_happy` | Радостная улыбка (4 кадра, 1 строка × 4 колонки)
* **Папка:** `public/assets/sprites/faces/happy/` | **Файлы:** `face_happy_00.png` — `face_happy_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a cheerful happy facial feature overlay sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous transparent empty padding between all 4 cells.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth, and gentle blush.
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- 100% transparent background alpha.

Animation Breakdown:
- Frame 1: Warm pleasant open eyes, gentle open smile.
- Frame 2: Eyes squinting with pure joy, bright open smile, soft pink blush.
- Frame 3: Happy curved anime eyes (^^), big laughing smile, rosy cheeks.
- Frame 4: Eyes opening softly, calm happy smile.
```

---

### F13. `face_sad` | Грусть / Печаль (4 кадра, 1 строка × 4 колонки)
* **Папка:** `public/assets/sprites/faces/sad/` | **Файлы:** `face_sad_00.png` — `face_sad_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a sad / melancholy facial feature overlay sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous transparent empty padding between all 4 cells.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth.
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- 100% transparent background alpha.

Animation Breakdown:
- Frame 1: Drooping eyebrows, slightly lowered downcast eyes, small gentle sad mouth curve.
- Frame 2: Downcast eyes looking down-left, small trembling mouth.
- Frame 3: Half-closed sorrowful eyes, slight quiver in mouth line.
- Frame 4: Soft sigh, eyes slowly lifting slightly back to Frame 1.
```

---

### F14. `face_angry` | Раздражение / Злость (4 кадра, 1 строка × 4 колонки)
* **Папка:** `public/assets/sprites/faces/angry/` | **Файлы:** `face_angry_00.png` — `face_angry_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate an annoyed / angry facial feature overlay sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous transparent empty padding between all 4 cells.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth.
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- 100% transparent background alpha.

Animation Breakdown:
- Frame 1: Furrowed slanted sharp eyebrows, focused stern eyes, small firm straight mouth.
- Frame 2: Sharper scowl brows, narrowed annoyed eyes, small open shouting mouth.
- Frame 3: Intense grumpy glare, teeth-grit mouth line, intense sharp eyebrows.
- Frame 4: Stern breath out, returning to controlled irritated expression.
```

---

### F15. `face_sleep` | Спящее лицо (4 кадра, 1 строка × 4 колонки)
* **Папка:** `public/assets/sprites/faces/sleep/` | **Файлы:** `face_sleep_00.png` — `face_sleep_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a peaceful sleeping facial feature overlay sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous transparent empty padding between all 4 cells.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: closed eyelashes, relaxed eyebrows, small sleeping mouth.
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- 100% transparent background alpha.

Animation Breakdown:
- Frame 1: Peaceful closed downward eyelash curves, completely relaxed brows, soft closed mouth.
- Frame 2: Sleeping inhale, mouth softly opens to a tiny round "o", eyelashes resting.
- Frame 3: Deep cozy sleep, tiny gentle smile on closed mouth, soft pink cheek blush.
- Frame 4: Sleeping exhale, mouth softly relaxing back to Frame 1.
```

---

### F16. `face_thinking` | Задумчивость / Сомнение (4 кадра, 1 строка × 4 колонки)
* **Папка:** `public/assets/sprites/faces/thinking/` | **Файлы:** `face_thinking_00.png` — `face_thinking_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a thoughtful thinking facial feature overlay sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous transparent empty padding between all 4 cells.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth.
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- 100% transparent background alpha.

Animation Breakdown:
- Frame 1: Eyes looking upward-right in contemplation, one brow slightly arched, small straight mouth.
- Frame 2: Eyes darting slightly further to top corner, slight puzzled mouth curve.
- Frame 3: Thoughtful squint, pondering deeply with focused eyes.
- Frame 4: Soft realization, eyes recentering with a gentle calm expression.
```

---

### F17. `face_talking` | Движение рта / Разговор (4 кадра, 1 строка × 4 колонки)
* **Папка:** `public/assets/sprites/faces/talking/` | **Файлы:** `face_talking_00.png` — `face_talking_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate an animated talking / speech facial feature overlay sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

SPACING & PADDING (CRITICAL):
- Ensure generous transparent empty padding between all 4 cells.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, and animated speaking mouth shapes.
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- 100% transparent background alpha.

Animation Breakdown:
- Frame 1: Attentive open eyes, mouth closed in a soft line (M/B resting phoneme).
- Frame 2: Expressive animated eyes, mouth open in medium oval shape (A/O vowel phoneme).
- Frame 3: Sparkle in eyes, mouth open in wide smile talking shape (E/I vowel phoneme).
- Frame 4: Friendly eyes, mouth in small relaxed speaking curve (U/O phoneme).
```

---

# 🎁 БЛОК 3: Промпты для реквизита и спецэффектов (Props & FX, 4 кадра)

---

### P01. `props_pack` | Базовый пак предметов (4 предмета)
* **Папка:** `public/assets/sprites/props/` | **Файлы:** `prop_pillow.png`, `prop_heart.png`, `prop_question.png`, `prop_sparkle.png`

```text
Using the EXACT pastel cute anime art style and color palette from the ATTACHED REFERENCE IMAGE, generate a clean 2D game props and FX sheet on a transparent background PNG.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns).

SPACING & PADDING (CRITICAL):
- Ensure generous transparent empty spacing between each prop icon. Each item centered in its cell.

Items breakdown:
- Cell 1 (prop_pillow): A small, soft cozy pastel sleeping pillow with subtle creases.
- Cell 2 (prop_heart): A cute floating anime heart icon with soft sparkle highlights.
- Cell 3 (prop_question): A cute question mark "?" icon with a subtle exclamation mark sparkle.
- Cell 4 (prop_sparkle): A magical twinkling star sparkle effect.

Rules:
- 100% transparent background (true alpha PNG).
- No solid background boxes, no fake checkerboards, no characters, no scenery.
```

---

### P02. `fx_emotes_pack` | Дополнительные иконки эмоций (4 предмета)
* **Папка:** `public/assets/sprites/props/` | **Файлы:** `prop_sweat.png`, `prop_zzz.png`, `prop_anger.png`, `prop_music.png`

```text
Using the EXACT pastel cute anime art style and color palette from the ATTACHED REFERENCE IMAGE, generate a set of 4 floating anime emotion icons as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns).

SPACING & PADDING (CRITICAL):
- Ensure generous transparent empty spacing between each emote icon. Each item centered in its cell.

Items breakdown:
- Cell 1 (prop_sweat): A big cute cartoon anime sweat drop (💦) with soft specular shine.
- Cell 2 (prop_zzz): Three floating cozy sleeping letters "Z z z" in cute rounded bubble font with sparkles.
- Cell 3 (prop_anger): A cute red anime anger / irritation vein pop icon (💢).
- Cell 4 (prop_music): A pair of cute cheerful anime musical notes (🎵 🎶) with pastel sparkle accents.

Rules:
- 100% transparent background (true alpha PNG).
- Crisp vector-like outlines, no shadows, no backgrounds.
```
