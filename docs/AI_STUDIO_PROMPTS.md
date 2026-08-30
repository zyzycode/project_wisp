# AI Studio & GPT Image Generation Prompts — Project Wisp

> [!IMPORTANT]
> **ЖЁСТКИЙ СТАНДАРТ КАДРОВ И ПРАВИЛА ПРОЕКТА:**
> 1. **СТАНДАРТ КАДРОВ (4 или 8 кадров):** В проекте **ЗАПРЕЩЕНЫ 2-кадровые и 3-кадровые анимации**. Все тела, оверлеи лиц, зрачки и эффекты строго генерируются и нарезаются:
>    - **4 кадра (базовый стандарт):** 1 горизонтальный ряд × 4 колонки (`1 row × 4 columns`, файлы `_00.png`..`_03.png`).
>    - **8 кадров (расширенные секвенции):** 2 ряда × 4 колонки (`2 rows × 4 columns`, файлы `_00.png`..`_07.png`) для базовой стойки `body_idle` и полного цикла падения-восстановления `body_crash_splat`.
> 2. **Широкий отступ между кадрами (Wide Spacing & Padding):** Между кадрами должно быть щедрое свободное прозрачное пространство. Каждый персонаж или оверлей строго центрирован в своей квадратной ячейке, чтобы спрайты не слипались при автоматической нарезке.
> 3. **Разделение режимов наложения (`overlay` vs `baked_in`):**
>    - **Диалоговые и статические позы (`overlay`, БЕЗ ЛИЦА):** 
>      - `body_idle` (основная стойка на ногах, 8 кадров, `2x4`)
>      - `body_sit` (сидение на полу / окне, 4 кадра, `1x4`)
>      - `body_stand_up` (вставание на ноги, 4 кадра, `1x4`)
>      - `body_lie` (лежит на животе, качает ножками, голова анфас, 4 кадра, `1x4`)
>      *Персонаж находится в длительном визуальном контакте с пользователем. Лицо **полностью чистое (blank smooth skin)** для процедурного наложения эмоций (`face_*`), моргания (`face_blink`), разговора (`face_talking`) и взгляда зрачков за курсором (`pupils_*`).*
>    - **Контекстные, кинематические и динамические позы (`baked_in`, С ГОТОВЫМ ЛИЦОМ):** Все остальные позы генерируются **С ГОТОВЫМ ЗАПЕЧЁННЫМ ЛИЦОМ**, идеально передающим эмоцию действия:
>      - *Реакции:* `body_petting` (блаженство/румянец от поглаживания), `body_wave` (приветливая улыбка), `body_bored` (скучающий вздох), `body_celebrate` (триумф/радость), `body_scared` (испуг/дрожь), `body_thinking` (палец у подбородка).
>      - *Физика и перемещение Shimeji:* `body_dragged` (подхват мышью), `body_fall` (испуг при падении), `body_land` (зажмуривание при ударе), `body_crash_splat` (полный цикл падения, расплющивания 'x_x' и подъёма на ноги, **8 кадров**), `body_jump` (радостный прыжок), `body_ceiling_hang` (висение на потолке), `body_walk` (ходьба в 3/4), `body_run` (быстрый бег в 3/4), `body_climb_wall` (ползание по стене), `body_sleep` / `body_sleep_trans` (сон).
> 4. **Нативная поддержка альфа-канала:** Все файлы генерируются и сохраняются как PNG-32 с истинной прозрачностью.

---

## 🎯 План задач генерации

### 🔥 Очередь 1: Диалоговые позы тела БЕЗ ЛИЦА (Faceless Base Body) — ВСЕ ГОТОВЫ И ЗАПЕЧЕНЫ ✅
1. ✅ `B00. body_idle` — без лица (**8 кадров**, `2x4`) — *нарезано и запечено*
2. ✅ `B12. body_sit` — без лица (**4 кадра**, `1x4`) — *нарезано и запечено*
3. ✅ `B13. body_stand_up` — без лица (**4 кадра**, `1x4`) — *нарезано и запечено*
4. ✅ `B14. body_lie` — без лица (**4 кадра**, `1x4`) — *нарезано и запечено*

---

### 🏃 Очередь 2: Физические позы Shimeji С ГОТОВЫМ ЛИЦОМ (`baked_in`) — ВСЕ ГОТОВЫ И ЗАПЕЧЕНЫ ✅
1. ✅ `B17. body_crash_splat` — **С ЛИЦОМ** (**8 кадров**, `2x4`) — *нарезано и запечено*
2. ✅ `B15. body_run` — **С ЛИЦОМ** (**4 кадра**, `1x4`) — *нарезано и запечено*
3. ✅ `B16. body_fall` — **С ЛИЦОМ** (**4 кадра**, `1x4`) — *нарезано и запечено*
4. ✅ `B19. body_climb_wall` — **С ЛИЦОМ** (**4 кадра**, `1x4`) — *нарезано и запечено*
5. ✅ `B20. body_ceiling_hang` — **С ЛИЦОМ** (**4 кадра**, `1x4`) — *нарезано и запечено*
6. ✅ `B21. body_jump` — **С ЛИЦОМ** (**4 кадра**, `1x4`) — *нарезано и запечено*
7. ✅ `B01..B11` (`body_petting`, `body_wave`, `body_bored`, `body_land`, `body_dragged`, `body_walk`, `body_thinking`, `body_sleep`, `body_sleep_trans`, `body_celebrate`, `body_scared`) — *нарезаны и запечены*.

---

### 🎭 Очередь 3: Оверлеи лиц, зрачков и реквизита (СТРОГО 4 кадра на прозрачном фоне)
* ✅ `F07. pupils_normal` (**4 кадра**) — изолированные зрачки для слежения за курсором — *нарезано и запечено*
* ⏳ `F09. face_blink` (**4 кадра**) — цикл естественного моргания в покое (`idle`/`sit`/`lie`)
* ⏳ `F10. face_smug` (**4 кадра**) — уверенная/хитрая ухмылка
* ⏳ `F11. face_crying` (**4 кадра**) — аниме-слёзки (плач/обида)
* ⏳ `F08. pupils_directional` (**4 кадра**) — 4 дискретных направления взгляда (влево, вправо, вверх, вниз)
* ⏳ `P01. prop_pillow` (**4 кадра**) — мягкая подушечка для сна
* ⏳ `P02. prop_heart` (**4 кадра**) — парящие пульсирующие сердечки эффекта любви/поглаживания
* ⏳ `P03. prop_question` (**4 кадра**) — покачивающийся аниме-знак вопроса `?`
* ⏳ `P04. prop_sparkle` (**4 кадра**) — сверкающие аниме-звёздочки `✨`

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

## 📋 Сводная матрица всех спрайтов

| ID | Ключ анимации | Описание позы / эффекта | Режим в движке | Кадров | Сетка | Текущий статус |
|---|---|---|---|---|---|---|
| **B00** | `body_idle` | Базовая стойка (дыхание) | `overlay` (без лица) | 8 | 2x4 | ✅ **Готово** |
| **B01** | `body_walk` | Шаги / Ходьба | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово** |
| **B02** | `body_thinking` | Размышление / Мысли | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово** |
| **B03** | `body_dragged` | Перетаскивание мышью | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово** |
| **B04** | `body_land` | Приземление (зажмуривание) | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово** |
| **B05** | `body_petting` | Реакция на поглаживание | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово** |
| **B06** | `body_sleep` | Поза сна на полу | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово** |
| **B07** | `body_sleep_trans` | Укладывание спать | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово** |
| **B08** | `body_wave` | Взмах ручкой (приветствие) | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово** |
| **B09** | `body_celebrate` | Празднование / Радость | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово** |
| **B10** | `body_scared` | Дрожь / Испуг тела | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово** |
| **B11** | `body_bored` | Скука / Вздох | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово** |
| **B12** | `body_sit` | Сидит на полу / окне | `overlay` (без лица) | 4 | 1x4 | ✅ **Готово** |
| **B13** | `body_stand_up` | Вставание на ноги | `overlay` (без лица) | 4 | 1x4 | ✅ **Готово** |
| **B14** | `body_lie` | Лежит на животе | `overlay` (без лица) | 4 | 1x4 | ✅ **Готово** |
| **B15** | `body_run` | Быстрый бег | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово** |
| **B16** | `body_fall` | Паническое падение | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово** |
| **B17** | `body_crash_splat` | Удар о пол + 'x_x' + подъём | `baked_in` (с лицом) | 8 | 2x4 | ✅ **Готово** |
| **B19** | `body_climb_wall` | Ползание по стене | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово** |
| **B20** | `body_ceiling_hang` | Висение на потолке | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово** |
| **B21** | `body_jump` | Радостный подскок | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово** |
| **F07** | `pupils_normal` | Зрачки (центр + блеск) | `pupils` | 4 | 1x4 | ✅ **Готово** |
| **F09** | `face_blink` | Моргание (открыты -> закрыты) | `overlay` | 4 | 1x4 | ⏳ **Промпт ниже** |
| **F10** | `face_smug` | Ухмылка (хитрая/уверенная) | `overlay` | 4 | 1x4 | ⏳ **Промпт ниже** |
| **F11** | `face_crying` | Слёзки (плач/обида) | `overlay` | 4 | 1x4 | ⏳ **Промпт ниже** |
| **F08** | `pupils_directional` | Зрачки (L, R, U, D) | `pupils` | 4 | 1x4 | ⏳ **Промпт ниже** |
| **P01** | `prop_pillow` | Мягкая подушечка | `props` | 4 | 1x4 | ⏳ **Промпт ниже** |
| **P02** | `prop_heart` | Парящие сердечки FX | `props` | 4 | 1x4 | ⏳ **Промпт ниже** |
| **P03** | `prop_question` | Знак вопроса `?` FX | `props` | 4 | 1x4 | ⏳ **Промпт ниже** |
| **P04** | `prop_sparkle` | Звёздочки/искры `✨` FX | `props` | 4 | 1x4 | ⏳ **Промпт ниже** |

---

# 🎨 Готовые промпты для недостающих спрайтов

> [!TIP]
> **Как использовать:**
> 1. Скопируйте блок промпта из поля `text`.
> 2. Вставьте в **Google AI Studio (Imagen 3 / Gemini 2.0 Pro)** или **ChatGPT (DALL-E 3)**.
> 3. Сохраните полученное изображение в папку проекта `generated_images/<имя_файла>.png`.

---

### [PROMPT: F09] `face_blink` — Моргание (Blinking Eyes Cycle)
* **Целевой файл:** `generated_images/face_blink.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).
* **Спецификация кадров:**
  - Кадр 1: Глаза широко открыты, нейтрально-добрый взгляд, маленький ротик в полуулыбке.
  - Кадр 2: Глазки прикрываются наполовину (half-closed eyelids, мягкий переход).
  - Кадр 3: Глазки полностью мягко закрыты дугами `^ ^` или умиротворенными линиями.
  - Кадр 4: Глазки начинают плавно приоткрываться обратно в исходное положение.

```text
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Facial expression overlay only for chibi anime character, featuring ONLY eyes, subtle eyebrows, and cute mouth. No body, no hair, no neck.
Character aesthetic: ethereal anime girl with large luminous lavender-purple eyes and soft specular star shine highlights.
Animation sequence: Smooth blinking cycle (Frame 1: wide open bright eyes with small neutral smiling mouth, Frame 2: half-closed eyelids transitioning down, Frame 3: fully closed relaxed peaceful eyes like soft arcs ^ ^, Frame 4: gently opening eyelids returning to start).
Perfect horizontal alignment, identical eye spacing and scale in all 4 cells, sharp crisp anime vector lineart, flat vibrant coloring, true PNG alpha transparency, masterwork game asset quality.
```

---

### [PROMPT: F10] `face_smug` — Ухмылка / Хитрая уверенность (Smug Expression)
* **Целевой файл:** `generated_images/face_smug.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).
* **Спецификация кадров:**
  - Кадр 1: Хитро прищуренные блестящие лавандовые глазки с приподнятой бровкой и маленькой уверенной кошачьей ухмылкой `:3`.
  - Кадр 2: Блеск в глазах усиливается, ухмылка чуть шире, бровь игриво приподнимается.
  - Кадр 3: Максимальная самодовольная аниме-ухмылка (задорный искрящийся взгляд, ухмылка на один бок).
  - Кадр 4: Мягкое возвращение к первому кадру.

```text
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Facial expression overlay only for chibi anime character, featuring ONLY eyes, expressive eyebrows, and cute mouth. No body, no hair, no neck.
Character aesthetic: luminous lavender-purple eyes, sparkling confident specular highlights.
Animation sequence: Cute playful smug anime face (Frame 1: sly half-closed confident eyes with one raised eyebrow and a subtle smirk mouth, Frame 2: sparkling glint in the eyes with mischievous cat-like grin :3, Frame 3: bold smug playful wink-glance with wide cocky smirk, Frame 4: relaxing back to subtle confident smirk).
Perfect horizontal alignment, identical scale and positioning in all 4 cells, crisp clean anime lineart, vibrant shading, true PNG alpha transparency.
```

---

### [PROMPT: F11] `face_crying` — Плач / Аниме-слёзки (Crying / Teary Eyes)
* **Целевой файл:** `generated_images/face_crying.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).
* **Спецификация кадров:**
  - Кадр 1: Огромные слезящиеся глаза `(>_<)` с накопившимися капельками в уголках, дрожащий плаксивый ротик `3:`.
  - Кадр 2: Крупные полупрозрачные аниме-слезинки начинают выкатываться из уголков глаз.
  - Кадр 3: Потоки сияющих аниме-слёз струятся вниз по щёчкам, зажмуренные или дрожащие заплаканные глазки.
  - Кадр 4: Всхлипывающий ротик, мерцающие остаточные слёзки.

```text
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Facial expression overlay only for chibi anime character, featuring ONLY eyes, arched sad eyebrows, tears, and trembling mouth. No body, no hair, no neck.
Character aesthetic: large watery anime eyes with glowing purple irises and shimmering tear droplets.
Animation sequence: Crying anime expression loop (Frame 1: huge teary glossy eyes welling up with tears and a trembling pouting mouth 3:, Frame 2: big sparkling translucent tears rolling down cheek level, Frame 3: streaming sparkling anime waterfall tears with squeezed watery eyes >_<, Frame 4: sniffling expression with glittering tear drops).
Perfect horizontal alignment, uniform spacing in all 4 cells, vibrant cel-shaded anime style, true PNG alpha transparency.
```

---

### [PROMPT: F08] `pupils_directional` — Дискретные зрачки по 4 сторонам (Directional Gaze)
* **Целевой файл:** `generated_images/pupils_directional.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).
* **Спецификация кадров:**
  - Кадр 1: Пара лавандовых зрачков смещена влево (Look Left).
  - Кадр 2: Пара лавандовых зрачков смещена вправо (Look Right).
  - Кадр 3: Пара лавандовых зрачков смещена вверх (Look Up).
  - Кадр 4: Пара лавандовых зрачков смещена вниз (Look Down).

```text
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Isolated anime eye pupils layer ONLY (a pair of left and right pupils together in each frame at canonical eye distance). No whites of the eyes, no eyelids, no skin, no face.
Aesthetic: luminous lavender-purple irises with dark pupil centers and bright white star specular shine highlights.
Sequence: 4 directional gaze offsets (Frame 1: both pupils shifted to the LEFT, Frame 2: both pupils shifted to the RIGHT, Frame 3: both pupils shifted UPWARDS, Frame 4: both pupils shifted DOWNWARDS).
Perfect anatomical spacing matching chibi eye sockets, crisp sharp vector edges, uniform size across all 4 frames, true PNG alpha transparency.
```

---

### [PROMPT: P01] `prop_pillow` — Мягкая подушечка для сна (Plush Bed Pillow)
* **Целевой файл:** `generated_images/prop_pillow.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра) или одиночный предмет.
* **Спецификация кадров:**
  - Нежная пастельная подушечка (светло-лавандовая или нежно-голубая с мягкими складками и звёздным узором), мягко приминается и расправляется при дыхании.

```text
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Chibi anime prop asset: An ultra-cute, plush fluffy sleeping pillow for anime chibi character.
Color palette: pastel white and soft lavender with faint glowing star embroidery pattern and delicate golden frills.
Animation: Soft squish and breathing bounce cycle (Frame 1: puffy fluffy pillow, Frame 2: gentle soft compression in center where head rests, Frame 3: deepest soft squish, Frame 4: gently decompressing back to fluffy shape).
Clean isometric / front perspective, no character, object only, cel-shaded anime game art, crisp outlines, true PNG alpha transparency.
```

---

### [PROMPT: P02] `prop_heart` — Парящие сердечки любви / ласки (Floating Hearts FX)
* **Целевой файл:** `generated_images/prop_heart.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).
* **Спецификация кадров:**
  - Анимированные розово-лавандовые сердечки, появляющиеся над головой, пульсирующие и взлетающие вверх с искрами.

```text
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Visual FX prop layer: Glowing anime love hearts floating upwards.
Color palette: vibrant glowing magenta, soft pink, and pastel lavender with bright white sparkle glints.
Animation sequence: Floating pulse cycle (Frame 1: small glowing heart appearing with tiny sparkles, Frame 2: heart expanding and pulsing brightly while rising, Frame 3: heart at maximum size with tiny mini-hearts bursting outward, Frame 4: heart gently fading into soft glowing glitter particles).
Clean visual effects sprite, no background, isolated FX, sharp clean vector anime aesthetic, true PNG alpha transparency.
```

---

### [PROMPT: P03] `prop_question` — Аниме-знак вопроса `?` (Confused Question Mark FX)
* **Целевой файл:** `generated_images/prop_question.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).
* **Спецификация кадров:**
  - Жёлто-золотой или пастельно-фиолетовый объёмный аниме-знак вопроса `?`, забавно покачивающийся и подпрыгивающий.

```text
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Visual FX prop layer: Cute bouncy anime 3D-styled question mark icon '?' floating above character head.
Color palette: bright pastel yellow-gold with soft lilac drop shadow and shiny glossy specular highlights.
Animation sequence: Wobble and bounce loop (Frame 1: question mark leaning slightly to the left with anticipation, Frame 2: popping upward with a tiny bounce spark, Frame 3: floating at peak height tilted to the right, Frame 4: dropping smoothly down to starting position).
Isolated prop icon only, clean transparent background, crisp bold chibi game UI art, true PNG alpha transparency.
```

---

### [PROMPT: P04] `prop_sparkle` — Сверкающие аниме-звёздочки `✨` (Sparkle Stars FX)
* **Целевой файл:** `generated_images/prop_sparkle.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).
* **Спецификация кадров:**
  - 4-лучевые мерцающие звёздочки магии и радости (вспыхивают, вращаются и мягко рассеиваются).

```text
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Visual FX prop layer: Shimmering anime magic sparkle stars (4-pointed twinkle stars and glitter glints).
Color palette: brilliant luminous gold, diamond white, and celestial light blue glows.
Animation sequence: Twinkle and shine cycle (Frame 1: small pinpoint light glint igniting, Frame 2: expanding into radiant 4-point cross star with glowing corona halo, Frame 3: star rotating slightly with maximum brilliant flare burst and orbiting micro-sparkles, Frame 4: soft dispersing stardust fade).
Isolated VFX only, no background, high resolution cel-shaded game particles, true PNG alpha transparency.
```
