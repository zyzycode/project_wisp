# AI Studio & GPT Image Generation Prompts — Project Wisp

> [!NOTE]
> Документ содержит эталонные промпты для генерации спрайт-листов Project Wisp (AI Studio / GPT / DALL-E) с **нативной поддержкой прозрачности (PNG-32 true alpha)**.
> **Единый стандарт проекта:** **4 кадра** в один горизонтальный ряд (`1 row × 4 columns wide strip` / `_00.png`..`_03.png`) для всех анимаций (и `2 × 4` на 8 кадров для `body_idle`).

---

## 📋 Сводная таблица наличия ассетов в `public/`

### 🎭 Блок 1: Оверлеи лиц и зрачков

| ID | Ключ анимации | Описание | Сетка промпта | Путь в public/ | Статус в `public/` |
|---|---|---|---|---|---|
| **F01** | `face_curious` | Любопытство / Интерес | 1 row × 4 cols | `faces/curious/` | ✅ **Есть в public/** (2 кадра) |
| **F02** | `face_dizzy` | Спиральки / Головокружение | 1 row × 4 cols | `faces/dizzy/` | ✅ **Есть в public/** (3 кадра) |
| **F03** | `face_shocked` | Удивление / Шок / Подхват | 1 row × 4 cols | `faces/shocked/` | ✅ **Есть в public/** (3 кадра) |
| **F04** | `face_flirty` | Смущение / Нежный румянец | 1 row × 4 cols | `faces/flirty/` | ✅ **Есть в public/** (3 кадра) |
| **F05** | `face_winking` | Игривое подмигивание | 1 row × 4 cols | `faces/winking/` | ✅ **Есть в public/** (3 кадра) |
| **F06** | `face_pout` | Надутые щёчки / Обида | 1 row × 4 cols | `faces/pout/` | ✅ **Есть в public/** (3 кадра) |
| **F07** | `pupils_normal` | Изолированные зрачки (центр) | 1 row × 4 cols | `faces/pupils/` | ✅ **Есть в public/** (2 кадра) |
| **F08** | `pupils_directional` | Взгляд в 4 стороны (L/R/U/D) | 1 row × 4 cols | `faces/pupils/` | ❌ **Нет в public/** *(требуется генерация)* |
| **F09** | `face_blink` | Моргание глазами (Idle) | 1 row × 4 cols | `faces/blink/` | ❌ **Нет в public/** *(требуется генерация)* |
| **F10** | `face_smug` | Довольная ухмылка | 1 row × 4 cols | `faces/smug/` | ❌ **Нет в public/** *(требуется генерация)* |
| **F11** | `face_crying` | Сильное огорчение / Слёзки | 1 row × 4 cols | `faces/crying/` | ❌ **Нет в public/** *(требуется генерация)* |
| — | `face_happy` | Радость / Улыбка | 1 row × 4 cols | `faces/happy/` | ✅ **Есть в public/** (3 кадра) |
| — | `face_sad` | Грусть / Печаль | 1 row × 4 cols | `faces/sad/` | ✅ **Есть в public/** (3 кадра) |
| — | `face_angry` | Злость / Раздражение | 1 row × 4 cols | `faces/angry/` | ✅ **Есть в public/** (3 кадра) |
| — | `face_sleep` | Спящее лицо / Дремота | 1 row × 4 cols | `faces/sleep/` | ✅ **Есть в public/** (3 кадра) |
| — | `face_thinking` | Задумчивость / Сомнение | 1 row × 4 cols | `faces/thinking/` | ✅ **Есть в public/** (3 кадра) |
| — | `face_talking` | Разговор / Движение рта | 1 row × 4 cols | `faces/talking/` | ✅ **Есть в public/** (2 кадра) |

---

### 🏃 Блок 2: Shimeji-позы тела

| ID | Ключ анимации | Описание | Сетка промпта | Путь в public/ | Статус в `public/` |
|---|---|---|---|---|---|
| — | `body_idle` | Базовое стояние (покой) | 2 rows × 4 cols | `body/idle/` | ✅ **Есть в public/** (8 кадров) |
| — | `body_walk` | Шаги / Ходьба | 1 row × 4 cols | `body/walk/` | ✅ **Есть в public/** (4 кадра) |
| — | `body_thinking` | Поза размышления | 1 row × 4 cols | `body/thinking/` | ✅ **Есть в public/** (4 кадра) |
| — | `body_dragged` | Перетаскивание курсором | 1 row × 4 cols | `body/dragged/` | ✅ **Есть в public/** (4 кадра) |
| — | `body_land` | Приземление на лапки | 1 row × 4 cols | `body/land/` | ✅ **Есть в public/** (4 кадра) |
| — | `body_petting` | Реакция на поглаживание | 1 row × 4 cols | `body/petting/` | ✅ **Есть в public/** (4 кадра) |
| — | `body_sleep` | Поза сна | 1 row × 4 cols | `body/sleep/` | ✅ **Есть в public/** (4 кадра) |
| — | `body_sleep_trans` | Укладывание спать | 1 row × 4 cols | `body/sleep_transition/` | ✅ **Есть в public/** (4 кадра) |
| — | `body_wave` | Машет ручкой | 1 row × 4 cols | `body/wave/` | ✅ **Есть в public/** (2 кадра) |
| — | `body_celebrate` | Празднование / Победа | 1 row × 4 cols | `body/celebrate/` | ✅ **Есть в public/** (1 кадр) |
| — | `body_scared` | Испуг / Дрожь тела | 1 row × 4 cols | `body/scared/` | ✅ **Есть в public/** (2 кадра) |
| — | `body_bored` | Скука / Тоска | 1 row × 4 cols | `body/bored/` | ✅ **Есть в public/** (2 кадра) |
| **B01** | `body_sit` | Сидит на полу | 1 row × 4 cols | `body/sit/` | ❌ **Нет в public/** *(требуется генерация)* |
| **B02** | `body_stand_up` | Вставание на ноги | 1 row × 4 cols | `body/stand_up/` | ❌ **Нет в public/** *(требуется генерация)* |
| **B03** | `body_lie` | Лежит на полу | 1 row × 4 cols | `body/lie/` | ❌ **Нет в public/** *(требуется генерация)* |
| **B04** | `body_run` | Быстрый бег | 1 row × 4 cols | `body/run/` | ❌ **Нет в public/** *(требуется генерация)* |
| **B05** | `body_fall` | Падение в воздухе | 1 row × 4 cols | `body/fall/` | ❌ **Нет в public/** *(требуется генерация)* |
| **B06** | `body_crash_splat` | Шлепок о пол / Расплющивание | 1 row × 4 cols | `body/crash_splat/` | ❌ **Нет в public/** *(требуется генерация)* |
| **B07** | `body_recover` | Подъём и отряхивание | 1 row × 4 cols | `body/recover/` | ❌ **Нет в public/** *(требуется генерация)* |
| **B08** | `body_climb_wall` | Ползание по краю экрана | 1 row × 4 cols | `body/climb_wall/` | ❌ **Нет в public/** *(требуется генерация)* |
| **B09** | `body_ceiling_hang` | Висение на верхней кромке | 1 row × 4 cols | `body/ceiling_hang/` | ❌ **Нет в public/** *(требуется генерация)* |
| **B10** | `body_jump` | Радостный прыжок / Подскок | 1 row × 4 cols | `body/jump/` | ❌ **Нет в public/** *(требуется генерация)* |

---

### 🎁 Блок 3: Реквизит и спецэффекты (Props & FX)

| ID | Ключ анимации | Описание | Сетка промпта | Путь в public/ | Статус в `public/` |
|---|---|---|---|---|---|
| **P01** | `props_pack` | Подушка, сердечко, вопрос, искра | 1 row × 4 cols | `props/` | ❌ **Нет в public/** *(требуется генерация)* |
| **P02** | `fx_emotes_pack` | Капля пота, Zzz, злость, ноты | 1 row × 4 cols | `props/` | ❌ **Нет в public/** *(требуется генерация)* |

---

## 📐 1. Технический контракт спрайтовой системы (Sprite Contract)

### 1.1. Базовые параметры холста
* **Размер итогового холста (Canvas Size):** строго **`512 × 512 px`** (в игре рендерится как $256 \times 256\text{ px}$ на экранах Retina/High-DPI с двукратной чёткостью).
* **Формат файлов:** `PNG-32` с полноценным альфа-каналом (100% прозрачный фон RGBA).
* **Расположение кадров при генерации:** строго **в один горизонтальный ряд (1 row × 4 columns wide strip)**, чтобы скрипт нарезки автоматически делил полоску на 4 равных кадра.
* **Стандарт кадров:** ровно **4 кадра** на каждую анимационную дорожку.

### 1.2. Слоёная архитектура персонажа (Layer Stacking)
Персонаж рендерится послойно в едином холсте $512 \times 512\text{ px}$:
1. **Слой 0 (`props / shadows`):** тень персонажа под ногами, подушка для сна.
2. **Слой 1 (`base_body`):** тело персонажа с прической и одеждой. **Область лица остаётся чистой (цвет кожи без глаз и рта)** под оверлей.
3. **Слой 2 (`face`):** летающие черты лица (глаза, брови, рот) на прозрачном фоне.
4. **Слой 2.5 (`pupils`):** процедурно смещаемые зрачки (для слежения глазами за курсором мыши).
5. **Слой 3 (`procedural_blush / fx`):** процедурный векторный румянец (`procedural_blush` на z-index 30), иконки эмоций (`prop_heart`, `prop_question`, `prop_sparkle`).

---

## 📏 2. Геометрические координаты и привязки (Anchors & Pivots)

### 2.1. Контракт тела (Body Contract)
* **Точка опоры (Pivot):** `{ x: 0.50, y: 0.90 }`.
* **Горизонтальное центрирование (Center X):** строго по центру (**`X = 256 px`**).
* **Линия опоры стоп (Floor Baseline Y):** строго **`Y = 460 px`** от верхнего края холста.
* **Высота стоящего персонажа (Target Height):** строго **`385 – 390 px`** (макушка головы $Y \approx 70\dots75\text{ px}$).

### 2.2. Контракт оверлеев лиц (Face Overlay Contract)
> [!IMPORTANT]
> **ПРАВИЛО ОВЕРЛЕЕВ ЛИЦ:**
> Нейросеть генерирует **только черты лица** (глаза, брови, нос, рот).
> **Строго запрещено рисовать контур головы, волосы, уши, шею и овал лица!**
> Черты лица занимают центральную зону головы ($X \in [176, 336]$, $Y \in [110, 220]$ внутри квадрата $512 \times 512$). Всё остальное пространство — 100% прозрачный фон.

---

# 🎭 БЛОК 1: Оверлеи лиц и зрачков (Face & Pupils Overlays — True Alpha PNG)

---

### F01. `face_curious` | Любопытство / Интерес
* **Статус в `public/`:** ✅ **Есть в public/** (`face_curious_00.png`, `face_curious_01.png`)
* **Папка в игре:** `public/assets/sprites/faces/curious/`
* **Файлы:** `face_curious_00.png` — `face_curious_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a clean 2D facial feature overlay sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth, and small expression FX.
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- The entire background and area around the eyes and mouth must be 100% transparent alpha (no solid color, no background box, no fake checkerboard pattern).
- Keep the exact relative position, small scale, eye-spacing, and height of the face as if positioned onto the head in the reference image (facial zone X:176-336, Y:110-220 within 512x512 canvas).
- Absolute consistency across all 4 frames: identical eye size, color palette, and line art style.

Animation Breakdown:
- Frame 1: One eyebrow slightly raised, eyes looking slightly up-left, small cute closed mouth.
- Frame 2: Curious head-tilt expression, eyes looking further to upper-left, soft pleasant mouth.
- Frame 3: Wonder and realization, sparkling wide curious eyes with small star glints, tiny "o" mouth.
- Frame 4: Satisfied warm smile, eyes relaxed and centering back.
```

---

### F02. `face_dizzy` | Спиральки в глазах / Головокружение
* **Статус в `public/`:** ✅ **Есть в public/** (`face_dizzy_00.png` — `face_dizzy_02.png`)
* **Папка в игре:** `public/assets/sprites/faces/dizzy/`
* **Файлы:** `face_dizzy_00.png` — `face_dizzy_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a clean 2D facial feature overlay sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth, and small expression FX (sweat drops, stars).
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- The entire background and area around the eyes and mouth must be 100% transparent alpha (no solid color, no background box, no fake checkerboard pattern).
- Keep the exact relative position, small scale, eye-spacing, and height of the face as if positioned onto the head in the reference image (facial zone X:176-336, Y:110-220 within 512x512 canvas).
- Absolute consistency across all 4 frames: identical eye size, color palette, and line art style.

Animation Breakdown:
- Frame 1: Spiral swirl pupils starting to spin, wavy wobbly mouth (~), tiny anime sweat droplet.
- Frame 2: Large white-and-dark spiral swirl eyes, wavy open mouth, dizzy pink blush cheeks.
- Frame 3: Dizzy spiral eyes rotated 180 degrees, funny tongue-out wobbly mouth, spinning stars near cheeks.
- Frame 4: Recovering half-closed dizzy eyes, small dazed "o" mouth.
```

---

### F03. `face_shocked` | Испуг / Внезапный подхват мышью / Шок
* **Статус в `public/`:** ✅ **Есть в public/** (`face_shocked_00.png` — `face_shocked_02.png`)
* **Папка в игре:** `public/assets/sprites/faces/shocked/`
* **Файлы:** `face_shocked_00.png` — `face_shocked_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a clean 2D facial feature overlay sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth, and small expression FX (sweat drops).
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- The entire background and area around the eyes and mouth must be 100% transparent alpha (no solid color, no background box, no fake checkerboard pattern).
- Keep the exact relative position, small scale, eye-spacing, and height of the face as if positioned onto the head in the reference image (facial zone X:176-336, Y:110-220 within 512x512 canvas).
- Absolute consistency across all 4 frames: identical eye size, color palette, and line art style.

Animation Breakdown:
- Frame 1: High raised eyebrows, wide rounded eyes with focused pupils, tiny "o" mouth.
- Frame 2: High arched startled brows, wide round eyes with tiny dot pupils, open oval gasp mouth (O), tiny sweat drop near temple.
- Frame 3: Wide sparkling surprised eyes, raised brows, open cute mouth.
- Frame 4: Calming down, eyes slightly relaxing, mouth closing to a soft "o".
```

---

### F04. `face_flirty` | Смущение / Нежный румянец / Флирт
* **Статус в `public/`:** ✅ **Есть в public/** (`face_flirty_00.png` — `face_flirty_02.png`)
* **Папка в игре:** `public/assets/sprites/faces/flirty/`
* **Файлы:** `face_flirty_00.png` — `face_flirty_03.png`
* *(Примечание: процедурный векторный румянец на щеках также может активироваться поверх слоя лица)*

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a clean 2D facial feature overlay sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth, and pink blush with cute diagonal blush hatch lines.
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- The entire background and area around the eyes and mouth must be 100% transparent alpha (no solid color, no background box, no fake checkerboard pattern).
- Keep the exact relative position, small scale, eye-spacing, and height of the face as if positioned onto the head in the reference image (facial zone X:176-336, Y:110-220 within 512x512 canvas).
- Absolute consistency across all 4 frames: identical eye size, color palette, and line art style.

Animation Breakdown:
- Frame 1: Shy downward-sideways glance, soft light rosy blush on cheeks, timid small mouth line.
- Frame 2: Deeper rosy blush with cute diagonal blush hatching lines, sideways bashful glance, shy smile.
- Frame 3: Flustered closed curved anime eyes (^ ^), bright red blush cheeks, embarrassed wavy mouth.
- Frame 4: Shy peek, one eye softly peeking, bright blush, timid sweet smile.
```

---

### F05. `face_winking` | Игривое подмигивание
* **Статус в `public/`:** ✅ **Есть в public/** (`face_winking_00.png` — `face_winking_02.png`)
* **Папка в игре:** `public/assets/sprites/faces/winking/`
* **Файлы:** `face_winking_00.png` — `face_winking_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a clean 2D facial feature overlay sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth, and small sparkle FX.
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- The entire background and area around the eyes and mouth must be 100% transparent alpha (no solid color, no background box, no fake checkerboard pattern).
- Keep the exact relative position, small scale, eye-spacing, and height of the face as if positioned onto the head in the reference image (facial zone X:176-336, Y:110-220 within 512x512 canvas).
- Absolute consistency across all 4 frames: identical eye size, color palette, and line art style.

Animation Breakdown:
- Frame 1: Cheerful open sparkling eyes, bright smile.
- Frame 2: Left eye closing into a sharp wink curve with a tiny yellow star glint, right eye wide and open, cheeky grin.
- Frame 3: Full wink hold, left eye closed in a clean lash curve with sparkle accent, right eye wide, happy open smile with blush.
- Frame 4: Left eye reopening smoothly, cheerful relaxed smile.
```

---

### F06. `face_pout` | Надутые щёчки / Милая обида
* **Статус в `public/`:** ✅ **Есть в public/** (`face_pout_00.png` — `face_pout_02.png`)
* **Папка в игре:** `public/assets/sprites/faces/pout/`
* **Файлы:** `face_pout_00.png` — `face_pout_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a clean 2D facial feature overlay sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth, and puffed cheek blush.
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- The entire background and area around the eyes and mouth must be 100% transparent alpha (no solid color, no background box, no fake checkerboard pattern).
- Keep the exact relative position, small scale, eye-spacing, and height of the face as if positioned onto the head in the reference image (facial zone X:176-336, Y:110-220 within 512x512 canvas).
- Absolute consistency across all 4 frames: identical eye size, color palette, and line art style.

Animation Breakdown:
- Frame 1: Mild annoyance, slightly furrowed brows, side glance, small cute protruded pout mouth (3).
- Frame 2: Puffed cheeks start, cheeks expanding with rosy blush, annoyed side-glance, puffed '3' mouth.
- Frame 3: Full cute pout, cheeks fully puffed with blush and cute puff outline curves, furrowed brows, turned-away eyes, grumpy-cute '3' mouth.
- Frame 4: Stubborn cute pout hold, eyes glancing back toward viewer.
```

---

### F07. `pupils_normal` | Изолированные зрачки (Центральный взгляд)
* **Статус в `public/`:** ✅ **Есть в public/** (`pupils_normal_00.png`, `pupils_normal_01.png`)
* **Папка в игре:** `public/assets/sprites/faces/pupils/`
* **Файлы:** `pupils_normal_00.png` — `pupils_normal_03.png`

```text
Using the EXACT eye color, iris gradient, pupil core, specular highlights, and eye-spacing from the ATTACHED REFERENCE IMAGE, generate an isolated pair of pupils for procedural eye tracking as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames arranged side-by-side in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

CRITICAL RULES:
- ONLY draw the isolated pair of pupils and irises (left pupil and right pupil).
- DO NOT draw eyelashes, eyelids, sclera (white of eye), skin, eyebrows, head, or body.
- The two pupils must be positioned at the exact distance and vertical height matching the eyes in the reference image.
- Background must be 100% transparent alpha (no background, no white box, no fake checkerboard).

Breakdown:
- Frame 1: Standard isolated pupil pair looking straight forward with specular highlights.
- Frame 2: Same isolated pupil pair with an extra subtle star glint highlight.
- Frame 3: Slightly enlarged soft pupils with warm gentle specular reflection.
- Frame 4: Normal focused pupil pair ready to loop back to Frame 1.
```

---

### F08. `pupils_directional` | Направленный взгляд зрачков (Влево, Вправо, Вверх, Вниз)
* **Статус в `public/`:** ❌ **Нет в public/** *(требуется генерация)*
* **Папка в игре:** `public/assets/sprites/faces/pupils/`
* **Файлы:** `pupils_directional_00.png` — `pupils_directional_03.png`

```text
Using the EXACT eye color, iris gradient, pupil core, specular highlights, and eye-spacing from the ATTACHED REFERENCE IMAGE, generate a set of isolated pupil pairs looking in 4 distinct cardinal directions as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames arranged side-by-side in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

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

### F09. `face_blink` | Цикл моргания глазами (для живого Idle)
* **Статус в `public/`:** ❌ **Нет в public/** *(требуется генерация)*
* **Папка в игре:** `public/assets/sprites/faces/blink/`
* **Файлы:** `face_blink_00.png` — `face_blink_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a natural 4-frame eye blink animation overlay sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyelashes, eyebrows, nose, and mouth.
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- 100% transparent background alpha.
- Keep exact facial alignment and dimensions (X:176-336, Y:110-220 within 512x512 canvas).

Animation Breakdown (Natural Blink):
- Frame 1: Fully open calm eyes, relaxed gentle smile.
- Frame 2: Half-closed eyelids descending (50% closed), eyelashes lowering.
- Frame 3: Fully closed eyes in cute clean curved eyelash lines (^_^) with relaxed eyebrows and smile.
- Frame 4: Eyes reopening back to 70% open, ready to smoothly return to Frame 1.
```

---

### F10. `face_smug` | Довольная ухмылка / Хитрая моська
* **Статус в `public/`:** ❌ **Нет в public/** *(требуется генерация)*
* **Папка в игре:** `public/assets/sprites/faces/smug/`
* **Файлы:** `face_smug_00.png` — `face_smug_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a cute anime smug / cheeky facial feature overlay sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

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

### F11. `face_crying` | Сильное огорчение / Аниме-слёзки
* **Статус в `public/`:** ❌ **Нет в public/** *(требуется генерация)*
* **Папка в игре:** `public/assets/sprites/faces/crying/`
* **Файлы:** `face_crying_00.png` — `face_crying_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a comical / dramatic cute crying face overlay sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

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

# 🏃 БЛОК 2: Shimeji-позы тела (Body Sheets — True Alpha PNG)

> Все позы тела генерируются **без запечённых глаз и рта** (с чистым овалом лица цвета кожи), чтобы поверх можно было накладывать любые эмоции.

---

### B01. `body_sit` | Сидит на полу
* **Статус в `public/`:** ❌ **Нет в public/** *(требуется генерация)*
* **Папка в игре:** `public/assets/sprites/body/sit/`
* **Файлы:** `body_sit_00.png` — `body_sit_03.png`

```text
Using the EXACT character design, hair style, chibi body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

Stability rules:
- Character keeps identical scale, body thickness, outfit, and palette across all frames.
- Character is centered horizontally in each cell (X=256).
- Seated bottom rests consistently on the floor baseline (Y=460).
- CRITICAL: The face area on the head is completely clean skin (NO baked eyes, NO baked mouth).
- Background is 100% transparent: no solid fill, backdrop, white box, floor, or baked shadow.
- Clean sharp 2D game asset, no extra characters, no UI, no text labels.

Animation Goal: Create a sitting idle loop.

Frame 1: Sits comfortably on the ground facing forward, hands resting softly on knees, legs folded cutely.
Frame 2: Inhale start, chest and shoulders rise slightly (+2px), hair tips float subtly.
Frame 3: Gentle weight shift to one side, leaning slightly on one hand, hair resting.
Frame 4: Exhale and settle smoothly back into Frame 1 position.
```

---

### B02. `body_stand_up` | Вставание на ноги
* **Статус в `public/`:** ❌ **Нет в public/** *(требуется генерация)*
* **Папка в игре:** `public/assets/sprites/body/stand_up/`
* **Файлы:** `body_stand_up_00.png` — `body_stand_up_03.png`

```text
Using the EXACT character design, hair style, chibi body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

Stability rules:
- Character keeps identical scale, body thickness, outfit, and palette across all frames.
- Character is centered horizontally in each cell (X=256).
- Feet stay aligned to the floor baseline (Y=460).
- CRITICAL: The face area on the head is completely clean skin (NO baked eyes, NO baked mouth).
- Background is 100% transparent: no solid fill, backdrop, white box, floor, or baked shadow.
- Clean sharp 2D game asset, no extra characters, no UI, no text labels.

Animation Goal: Create a transition sequence from sitting to standing.

Frame 1: Seated posture, hands placed on the floor for support.
Frame 2: Pushes up from floor onto knees and balls of feet (half-crouch).
Frame 3: Straightening legs, standing up tall, hands swinging naturally to sides.
Frame 4: Standard upright standing idle posture, fully balanced on feet.
```

---

### B03. `body_lie` | Лежит на полу
* **Статус в `public/`:** ❌ **Нет в public/** *(требуется генерация)*
* **Папка в игре:** `public/assets/sprites/body/lie/`
* **Файлы:** `body_lie_00.png` — `body_lie_03.png`

```text
Using the EXACT character design, hair style, chibi body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

Stability rules:
- Character keeps identical scale, body thickness, outfit, and palette across all frames.
- Character lies sideways/belly on the floor resting along baseline (Y=460).
- CRITICAL: The face area on the head is completely clean skin (NO baked eyes, NO baked mouth).
- Background is 100% transparent: no solid fill, backdrop, white box, floor, or baked shadow.
- Clean sharp 2D game asset, no extra characters, no UI, no text labels.

Animation Goal: Create a relaxing lying on floor loop.

Frame 1: Lying on tummy/side resting on elbows, legs slightly raised behind.
Frame 2: Gentle leg sway, one foot kicks up cutely in the air.
Frame 3: Other foot kicks up, chest rises slightly with gentle breathing.
Frame 4: Feet lower softly, returning smoothly to Frame 1.
```

---

### B04. `body_run` | Быстрый бег
* **Статус в `public/`:** ❌ **Нет в public/** *(требуется генерация)*
* **Папка в игре:** `public/assets/sprites/body/run/`
* **Файлы:** `body_run_00.png` — `body_run_03.png`

```text
Using the EXACT character design, hair style, chibi body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide strip), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

Stability rules:
- Character is seen from side profile / 3/4 view facing LEFT in a running pose.
- Character height (385-390px), dress, and hair remain 100% consistent across all frames.
- Feet contact the floor baseline (Y=460) during strides.
- CRITICAL: The face area on the head is clean skin without baked facial features.
- Background is 100% transparent: no solid fill, backdrop, white box, floor, or baked shadow.
- Clean sharp 2D game asset, no extra characters, no UI, no text labels.

Animation Goal: Create an energetic running cycle facing LEFT.

Frame 1 (Left Leg Contact): Left leg takes a long forward running stride, right leg trailing back, right arm forward, hair flying backward with inertia.
Frame 2 (Passing Flight): Both feet off the floor, body lifted (+6px) in airborne phase, legs passing each other.
Frame 3 (Right Leg Contact): Right leg takes a long forward running stride, left leg trailing back, left arm forward, hair flowing backward.
Frame 4 (Second Flight): Both feet off the floor, body lifted in airborne phase, ready to loop into Frame 1.
```

---

### B05. `body_fall` | Падение в воздухе
* **Статус в `public/`:** ❌ **Нет в public/** *(требуется генерация)*
* **Папка в игре:** `public/assets/sprites/body/fall/`
* **Файлы:** `body_fall_00.png` — `body_fall_03.png`

```text
Using the EXACT character design, hair style, chibi body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

Stability rules:
- Character is suspended in mid-air falling downward, centered horizontally in each cell (X=256).
- Dress and long hair are billowing upward due to wind resistance.
- CRITICAL: The face area on the head is clean skin without baked facial features.
- Background is 100% transparent: no solid fill, backdrop, white box, floor, or baked shadow.
- Clean sharp 2D game asset, no extra characters, no UI, no text labels.

Animation Goal: Create a free fall animation loop.

Frame 1: Falling pose, arms reaching upward, legs dangling slightly, hair billowing up.
Frame 2: Flails left arm and kicks right leg, hair swaying to one side.
Frame 3: Flails right arm and kicks left leg, hair swaying to the other side.
Frame 4: Arms spread out for wind balance, hair billowing high, loops back to Frame 1.
```

---

### B06. `body_crash_splat` | Шлепок о пол / Расплющивание
* **Статус в `public/`:** ❌ **Нет в public/** *(требуется генерация)*
* **Папка в игре:** `public/assets/sprites/body/crash_splat/`
* **Файлы:** `body_crash_splat_00.png` — `body_crash_splat_03.png`

```text
Using the EXACT character design, hair style, chibi body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

Stability rules:
- Floor baseline is consistent across all contact frames (Y=460).
- Comical cartoon squash-and-stretch physics.
- CRITICAL: The face area on the head is clean skin without baked facial features.
- Background is 100% transparent: no solid fill, backdrop, white box, floor, or baked shadow.
- Clean sharp 2D game asset, no extra characters, no UI, no text labels.

Animation Goal: Create an impact landing and flat squish sequence.

Frame 1 (Anticipation): Just 10px above floor, toes pointed down, bracing for impact.
Frame 2 (Hard Impact): Extreme squashed pose flat on the floor, knees bent wide, hair and dress splayed outward.
Frame 3 (Flat Splat): Comical flat pancake starfish pose completely flat on the floor baseline, arms and legs spread out wide.
Frame 4 (Squished Wobble): Flat on floor, slight dazed jiggle vibration.
```

---

### B07. `body_recover` | Подъём и отряхивание после падения
* **Статус в `public/`:** ❌ **Нет в public/** *(требуется генерация)*
* **Папка в игре:** `public/assets/sprites/body/recover/`
* **Файлы:** `body_recover_00.png` — `body_recover_03.png`

```text
Using the EXACT character design, hair style, chibi body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

Stability rules:
- Feet and knees stay grounded on floor baseline (Y=460).
- CRITICAL: The face area on the head is clean skin without baked facial features.
- Background is 100% transparent: no solid fill, backdrop, white box, floor, or baked shadow.
- Clean sharp 2D game asset, no extra characters, no UI, no text labels.

Animation Goal: Create a getting back up sequence.

Frame 1: Pushes upper body off the floor on hands, knees still on ground.
Frame 2: Gets onto knees, rubs head or dusts off dress with one hand.
Frame 3: Steps up onto one foot, rising upward.
Frame 4: Stands tall on both feet, quick final shake/dust-off, transitioning back to idle.
```

---

### B08. `body_climb_wall` | Ползание вверх по границе экрана
* **Статус в `public/`:** ❌ **Нет в public/** *(требуется генерация)*
* **Папка в игре:** `public/assets/sprites/body/climb_wall/`
* **Файлы:** `body_climb_wall_00.png` — `body_climb_wall_03.png`

```text
Using the EXACT character design, hair style, chibi body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

Stability rules:
- Character is clinging to a vertical wall on the LEFT edge of the frame, climbing UPWARDS.
- Hands and feet grip the vertical left plane.
- CRITICAL: The face area on the head is clean skin without baked facial features.
- 100% transparent background alpha.

Animation Goal: Vertical wall climbing loop.

Frame 1: Right hand reaches high up the wall, left knee bent grabbing wall lower, body close to wall.
Frame 2: Pulls body upward with right arm, left foot pushes off.
Frame 3: Left hand reaches high up to next grab point, right foot steps up.
Frame 4: Pulls body up with left arm, transitioning smoothly back to Frame 1.
```

---

### B09. `body_ceiling_hang` | Висение на потолке (Верхняя кромка экрана)
* **Статус в `public/`:** ❌ **Нет в public/** *(требуется генерация)*
* **Папка в игре:** `public/assets/sprites/body/ceiling_hang/`
* **Файлы:** `body_ceiling_hang_00.png` — `body_ceiling_hang_03.png`

```text
Using the EXACT character design, hair style, chibi body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

Stability rules:
- Character is hanging from the top edge of the frame by both hands.
- Legs dangle cutely in mid-air below.
- Hair and dress hang downward with gravity.
- CRITICAL: The face area on the head is clean skin without baked facial features.
- 100% transparent background alpha.

Animation Goal: Ceiling hanging and swaying loop.

Frame 1: Hanging straight down with both hands gripping the ceiling, legs dangling together.
Frame 2: Gentle sway to the left, legs swing slightly to left side.
Frame 3: Centered hang, slight pull-up bend in elbows (+4px lift).
Frame 4: Gentle sway to the right, legs swing slightly to right side.
```

---

### B10. `body_jump` | Радостный прыжок / Подскок
* **Статус в `public/`:** ❌ **Нет в public/** *(требуется генерация)*
* **Папка в игре:** `public/assets/sprites/body/jump/`
* **Файлы:** `body_jump_00.png` — `body_jump_03.png`

```text
Using the EXACT character design, hair style, chibi body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: Exactly 4 equal square frames in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

Stability rules:
- Character is centered horizontally (X=256).
- Floor baseline is Y=460.
- CRITICAL: The face area on the head is clean skin without baked facial features.
- 100% transparent background alpha.

Animation Goal: Jump anticipation, peak, and landing.

Frame 1 (Crouch Prep): Knees bent low (crouch), arms swinging back, storing energy.
Frame 2 (Ascent Launch): Pushes hard off the ground, body launching upward into the air (+40px), toes pointed down.
Frame 3 (Apex Flight): High airborne pose, arms spread out happily, dress and hair floating in mid-air.
Frame 4 (Landing Cushion): Feet contact floor baseline, knees bending to absorb the jump landing.
```

---

# 🎁 БЛОК 3: Реквизит и спецэффекты (Props & FX — True Alpha PNG)

---

### P01. `props_pack` | Базовый пак предметов
* **Статус в `public/`:** ❌ **Нет в public/** *(требуется генерация)*
* **Папка в игре:** `public/assets/sprites/props/`
* **Файлы:** `prop_pillow_00..03.png`, `prop_heart_00..03.png`, `prop_question_00..03.png`, `prop_sparkle_00..03.png`

```text
Using the EXACT pastel cute anime art style and color palette from the ATTACHED REFERENCE IMAGE, generate a clean 2D game props and FX sheet on a transparent background PNG.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns).

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

### P02. `fx_emotes_pack` | Дополнительные иконки эмоций
* **Статус в `public/`:** ❌ **Нет в public/** *(требуется генерация)*
* **Папка в игре:** `public/assets/sprites/props/`
* **Файлы:** `prop_sweat.png`, `prop_zzz.png`, `prop_anger.png`, `prop_music.png`

```text
Using the EXACT pastel cute anime art style and color palette from the ATTACHED REFERENCE IMAGE, generate a set of 4 floating anime emotion icons as a PNG with true alpha transparency.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns).

Items breakdown:
- Cell 1 (prop_sweat): A big cute cartoon anime sweat drop (💦) with soft specular shine.
- Cell 2 (prop_zzz): Three floating cozy sleeping letters "Z z z" in cute rounded bubble font with sparkles.
- Cell 3 (prop_anger): A cute red anime anger / irritation vein pop icon (💢).
- Cell 4 (prop_music): A pair of cute cheerful anime musical notes (🎵 🎶) with pastel sparkle accents.

Rules:
- 100% transparent background (true alpha PNG).
- Crisp vector-like outlines, no shadows, no backgrounds.
```
