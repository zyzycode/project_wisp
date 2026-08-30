# AI Studio & GPT Image Generation Prompts — Project Wisp

> [!IMPORTANT]
> **ЖЁСТКИЙ СТАНДАРТ КАДРОВ И ПРАВИЛА ПРОЕКТА:**
> 1. **ГЕНЕРАЦИЯ СТРОГО ПО РЕФЕРЕНСУ (Reference Image / Image-to-Image):** Все промпты содержат обязательную закрепляющую фразу `Based on the reference image, using the EXACT character design...` или `Matching the EXACT art style...`. При генерации в AI Studio (Imagen 3 / Gemini 2.0 Pro) или ChatGPT (DALL-E 3) **всегда прикрепляйте исходный референс персонажа** (например, `body_idle_00.png` или `face_happy_00.png`), чтобы сохранялся 100% единый стиль, пропорции и цветовая палитра.
> 2. **СТАНДАРТ КАДРОВ (4 или 8 кадров):** В проекте **ЗАПРЕЩЕНЫ 2-кадровые и 3-кадровые анимации**. Все тела, оверлеи лиц, зрачки и эффекты строго генерируются и нарезаются:
>    - **4 кадра (базовый стандарт):** 1 горизонтальный ряд × 4 колонки (`1 row × 4 columns`, файлы `_00.png`..`_03.png`).
>    - **8 кадров (расширенные секвенции):** 2 ряда × 4 колонки (`2 rows × 4 columns`, файлы `_00.png`..`_07.png`) для базовой стойки `body_idle` и полного цикла падения-восстановления `body_crash_splat`.
> 3. **Широкий отступ между кадрами (Wide Spacing & Padding):** Между кадрами должно быть щедрое свободное прозрачное пространство. Каждый персонаж или оверлей строго центрирован в своей квадратной ячейке, чтобы спрайты не слипались при автоматической нарезке.
> 4. **Разделение режимов наложения (`overlay` vs `baked_in`):**
>    - **Диалоговые и статические позы (`overlay`, БЕЗ ЛИЦА):** 
>      - `body_idle` (основная стойка на ногах, 8 кадров, `2x4`)
>      - `body_sit` (сидение на полу / окне, 4 кадра, `1x4`)
>      - `body_stand_up` (вставание на ноги, 4 кадра, `1x4`)
>      - `body_lie` (лежит на животе, качает ножками, голова анфас, 4 кадра, `1x4`)
>      *Персонаж находится в длительном визуальном контакте с пользователем. Лицо **полностью чистое (blank smooth skin)** для процедурного наложения эмоций (`face_*`), моргания (`face_blink`), разговора (`face_talking`) и взгляда (`face_gaze` / `pupils_*`).*
>    - **Контекстные, кинематические и динамические позы (`baked_in`, С ГОТОВЫМ ЛИЦОМ):** Все остальные позы генерируются **С ГОТОВЫМ ЗАПЕЧЁННЫМ ЛИЦОМ**, идеально передающим эмоцию действия.
> 5. **Нативная поддержка альфа-канала:** Все файлы генерируются и сохраняются как PNG-32 с истинной прозрачностью.

---

## 🎯 План задач генерации

### 🚨 Очередь 0: Срочная перегенерация дефектных и нарушающих масштаб поз тела (Fix Scaling & Defects)
> [!WARNING]
> **Причина перегенерации:** В результате аппаратного аудита размеров спрайтов выявлены критические отклонения в размерах и целостности:
> - **`body_wave`** — уменьшена на $\approx 15-20\%$ (ширина $197-212\text{ px}$ вместо эталонных $255-275\text{ px}$, пикселей всего $46\,000$ вместо $55\,000$). Из-за поднятой руки нейросеть уменьшила всё тело целиком!
> - **`body_jump`** — **критический дефект в кадре `01`** (размер всего $63\times100\text{ px}$, $966$ пикселей).
> - **`body_celebrate`** — сильная пульсация масштаба между кадрами (от $194\text{ px}$ до $276\text{ px}$).
> - **`body_bored`** — силуэт слишком худой и узкий ($196-205\text{ px}$).
> - **`body_scared`** — сжата по общей массе ($42\,000$ пикселей).
> - **`body_fall`** — вытянута и сужена ($204-213\text{ px}$).
> - **`body_land`** — **нарушен порядок фаз и стыковка с `idle`**: в кадре `02` персонаж уже встал в полный рост ($Y=70\text{ px}$), а в кадре `03` внезапно снова просел в полуприсед ($Y=103\text{ px}$), из-за чего при переключении на `idle_00` ($Y=75\text{ px}$) происходит резкий рывок/скачок тела вверх на 28px.

1. 🔴 `B08. body_wave` (**4 кадра**, `1x4`, `baked_in`) — *взмах рукой без сжатия тела, голова $190-200\text{ px}$, торс $255-275\text{ px}$*
2. 🔴 `B21. body_jump` (**4 кадра**, `1x4`, `baked_in`) — *исправление повреждённого кадра 01 и прыжок в полном чиби-масштабе*
3. 🔴 `B09. body_celebrate` (**4 кадра**, `1x4`, `baked_in`) — *радостный танец со строго одинаковым масштабом во всех 4 кадрах*
4. 🔴 `B11. body_bored` (**4 кадра**, `1x4`, `baked_in`) — *вздох и переминание с ноги на ногу с полным объёмом платья ($255-265\text{ px}$)*
5. 🟡 `B10. body_scared` (**4 кадра**, `1x4`, `baked_in`) — *дрожь от испуга в полном чиби-объёме без уменьшения массы*
6. ✅ `B16. body_fall` (**4 кадра**, `1x4`, `baked_in`) — *перегенерировано и нарезано, ширина 273-304px, полный масштаб*
7. ✅ `B04. body_land` (**4 кадра**, `1x4`, `baked_in`) — *перегенерировано и нарезано: 4-й кадр 100% бесшовно переходит в idle_00*

---

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
7. ✅ Готовы и стабильны: `body_petting`, `body_dragged`, `body_walk`, `body_thinking`, `body_sleep`, `body_sleep_trans`.
8. 🔄 Отправлены на перегенерацию в Очередь 0: `body_wave`, `body_celebrate`, `body_jump`, `body_bored`, `body_scared`, `body_fall`, `body_land`.

---

### 🎭 Очередь 3: Оверлеи лиц, зрачков и реквизита (СТРОГО 4 кадра на прозрачном фоне)
* ✅ `F07. pupils_normal` (**4 кадра**) — изолированные зрачки для слежения за курсором — *нарезано и запечено*
* ✅ `F08. face_gaze` (**4 кадра**) — оверлей полного лица с 4 дискретными направлениями взгляда (влево, вправо, вверх, вниз) — *нарезано и запечено*
* ⏳ `F09. face_blink` (**4 кадра**) — цикл естественного моргания в покое (`idle`/`sit`/`lie`)
* ⏳ `F10. face_smug` (**4 кадра**) — уверенная/хитрая ухмылка
* ⏳ `F11. face_crying` (**4 кадра**) — аниме-слёзки (плач/обида)
* ⏳ `P01. prop_pillow` (**4 кадра**) — мягкая подушечка для сна
* ⏳ `P02. prop_heart` (**4 кадра**) — парящие пульсирующие сердечки эффекта любви/поглаживания
* ⏳ `P03. prop_question` (**4 кадра**) — покачивающийся аниме-знак вопроса `?`
* ⏳ `P04. prop_sparkle` (**4 кадра**) — сверкающие аниме-звёздочки `✨`

---

### 🚀 Очередь 4: Новые позы ИИ-помощника, оконная физика и расширенные эмоции
* 💡 `B22. body_typing` (**4 кадра**) — печать на мини-ноутбуке (генерация AI кода / текста)
* 💡 `B23. body_read_book` (**4 кадра**) — чтение книги документации / знаний
* 💡 `B24. body_drink_tea` (**4 кадра**) — уютное чаепитие из кружечки с паром
* 💡 `B25. body_listen_music` (**4 кадра**) — прослушивание музыки в светящихся наушниках
* 💡 `B26. body_sit_edge` (**4 кадра**) — сидение на верхней рамке активного окна с болтающимися ножками
* 💡 `B27. body_peek_wall` (**4 кадра**) — выглядывание из-за края экрана / окна
* 💡 `F12. face_sparkle_eyes` (**4 кадра**) — глаза-звёздочки восторга `✪ ω ✪`
* 💡 `F13. face_embarrassed` (**4 кадра**) — смущение и пунцовый румянец `>///<`
* 💡 `F14. face_panic_scream` (**4 кадра**) — панический крик `D:`
* 💡 `P05. prop_lightbulb` (**4 кадра**) — загорающаяся лампочка идеи `💡`
* 💡 `P06. prop_exclamation` (**4 кадра**) — знак восклицания / алерта `!`
* 💡 `P07. prop_sweat_drop` (**4 кадра**) — аниме-капля неловкости `💧`
* 💡 `P08. prop_zzz` (**4 кадра**) — сонные улетающие символы `Z z z 💤`
* 💡 `P09. prop_music_notes` (**4 кадра**) — парящие музыкальные нотки `🎵 🎶`

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
| **B04** | `body_land` | Приземление (зажмуривание) | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово (бесшовная стыковка с idle)** |
| **B05** | `body_petting` | Реакция на поглаживание | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово** |
| **B06** | `body_sleep` | Поза сна на полу | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово** |
| **B07** | `body_sleep_trans` | Укладывание спать | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово** |
| **B08** | `body_wave` | Взмах ручкой (приветствие) | `baked_in` (с лицом) | 4 | 1x4 | 🔄 **Перегенерировать (мала на 20%)** |
| **B09** | `body_celebrate` | Празднование / Радость | `baked_in` (с лицом) | 4 | 1x4 | 🔄 **Перегенерировать (скачки масштаба)** |
| **B10** | `body_scared` | Дрожь / Испуг тела | `baked_in` (с лицом) | 4 | 1x4 | 🔄 **Перегенерировать (мало пикселей)** |
| **B11** | `body_bored` | Скука / Вздох | `baked_in` (с лицом) | 4 | 1x4 | 🔄 **Перегенерировать (слишком узкая)** |
| **B12** | `body_sit` | Сидит на полу / окне | `overlay` (без лица) | 4 | 1x4 | ✅ **Готово** |
| **B13** | `body_stand_up` | Вставание на ноги | `overlay` (без лица) | 4 | 1x4 | ✅ **Готово** |
| **B14** | `body_lie` | Лежит на животе | `overlay` (без лица) | 4 | 1x4 | ✅ **Готово** |
| **B15** | `body_run` | Быстрый бег | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово** |
| **B16** | `body_fall` | Паническое падение | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово (полный чиби-масштаб)** |
| **B17** | `body_crash_splat` | Удар о пол + 'x_x' + подъём | `baked_in` (с лицом) | 8 | 2x4 | ✅ **Готово** |
| **B19** | `body_climb_wall` | Ползание по стене | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово** |
| **B20** | `body_ceiling_hang` | Висение на потолке | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово** |
| **B21** | `body_jump` | Радостный подскак | `baked_in` (с лицом) | 4 | 1x4 | ✅ **Готово** |
| **B22** | `body_typing` | Печатает на ноутбуке | `baked_in` (с лицом) | 4 | 1x4 | 💡 **Новый промпт** |
| **B23** | `body_read_book` | Читает книгу знаний | `baked_in` (с лицом) | 4 | 1x4 | 💡 **Новый промпт** |
| **B24** | `body_drink_tea` | Пьёт чай с паром | `baked_in` (с лицом) | 4 | 1x4 | 💡 **Новый промпт** |
| **B25** | `body_listen_music`| Слушает музыку в наушниках | `baked_in` (с лицом) | 4 | 1x4 | 💡 **Новый промпт** |
| **B26** | `body_sit_edge` | Болтает ножками с окна | `baked_in` (с лицом) | 4 | 1x4 | 💡 **Новый промпт** |
| **B27** | `body_peek_wall` | Выглядывает из-за края | `baked_in` (с лицом) | 4 | 1x4 | 💡 **Новый промпт** |
| **F07** | `pupils_normal` | Зрачки (центр + блеск) | `pupils` | 4 | 1x4 | ✅ **Готово** |
| **F08** | `face_gaze` | Направления взгляда лица (L, R, U, D) | `overlay` | 4 | 1x4 | ✅ **Готово** |
| **F09** | `face_blink` | Моргание (открыты -> закрыты) | `overlay` | 4 | 1x4 | ⏳ **Промпт готов** |
| **F10** | `face_smug` | Ухмылка (хитрая/уверенная) | `overlay` | 4 | 1x4 | ⏳ **Промпт готов** |
| **F11** | `face_crying` | Слёзки (плач/обида) | `overlay` | 4 | 1x4 | ⏳ **Промпт готов** |
| **F12** | `face_sparkle_eyes` | Глаза-звёздочки `✪ ω ✪` | `overlay` | 4 | 1x4 | 💡 **Новый промпт** |
| **F13** | `face_embarrassed` | Смущение `>///<` | `overlay` | 4 | 1x4 | 💡 **Новый промпт** |
| **F14** | `face_panic_scream` | Панический крик `D:` | `overlay` | 4 | 1x4 | 💡 **Новый промпт** |
| **P01** | `prop_pillow` | Мягкая подушечка | `props` | 4 | 1x4 | ⏳ **Промпт готов** |
| **P02** | `prop_heart` | Парящие сердечки FX | `props` | 4 | 1x4 | ⏳ **Промпт готов** |
| **P03** | `prop_question` | Знак вопроса `?` FX | `props` | 4 | 1x4 | ⏳ **Промпт готов** |
| **P04** | `prop_sparkle` | Звёздочки/искры `✨` FX | `props` | 4 | 1x4 | ⏳ **Промпт готов** |
| **P05** | `prop_lightbulb` | Лампочка идеи `💡` FX | `props` | 4 | 1x4 | 💡 **Новый промпт** |
| **P06** | `prop_exclamation` | Знак внимания `!` FX | `props` | 4 | 1x4 | 💡 **Новый промпт** |
| **P07** | `prop_sweat_drop` | Капля неловкости `💧` FX | `props` | 4 | 1x4 | 💡 **Новый промпт** |
| **P08** | `prop_zzz` | Сонные буковки `Z z z 💤` FX | `props` | 4 | 1x4 | 💡 **Новый промпт** |
| **P09** | `prop_music_notes` | Музыкальные нотки `🎵` FX | `props` | 4 | 1x4 | 💡 **Новый промпт** |

---

# 🎨 Готовые промпты для генерации

> [!TIP]
> **Как использовать:**
> 1. Прикрепите исходное изображение персонажа (например, `body_idle_00.png` или `face_happy_00.png`) в качестве **Image Reference** (референса стиля и анатомии).
> 2. Скопируйте блок промпта из поля `text`.
> 3. Вставьте в **Google AI Studio (Imagen 3 / Gemini 2.0 Pro)** или **ChatGPT (DALL-E 3)**.
> 4. Сохраните полученное изображение в папку проекта `generated_images/<имя_файла>.png`.

---

## 🛠️ Раздел 0: Исправление масштаба и перегенерация поз тела (Fix Scaling & Defects)

> [!IMPORTANT]
> **ГЛАВНЫЕ ТРЕБОВАНИЯ ДЛЯ ИСПРАВЛЕНИЯ МАСШТАБА:**
> 1. **НЕ СЖИМАТЬ ТЕЛО ПРИ ПОДНЯТЫХ РУКАХ:** Рука, машущая или поднятая вверх, должна двигаться на уровне головы/плеча сбоку, **НЕ заставляя нейросеть пропорционально уменьшать фигурку персонажа**. Масштаб головы ($190-210\text{ px}$ ширина) и платья ($250-275\text{ px}$ ширина) обязан совпадать с референсом `body_idle` пиксель-в-пиксель!
> 2. **ЕДИНЫЙ МАСШТАБ ВО ВСЕХ 4 КАДРАХ:** Персонаж не должен пульсировать по ширине.
> 3. **ПОЛНАЯ ПРОЗРАЧНОСТЬ И ОТСТУПЫ:** 1 горизонтальный ряд $\times$ 4 квадратных ячейки (`1x4`), широкие прозрачные поля между кадрами.

---

### [PROMPT: B08] `body_wave` — Взмах ручкой / Приветствие (Waving Hand — Full Scale Fix)
* **📌 Что исправлено в промпте:** Жесткое требование сохранения 100% масштаба тела (Head Width 190–200px, Torso Width 260–275px). Рука машет сбоку от головы, не уменьшая туловище.
* **🎬 Раскадровка:** Кадр 1: правая ручка поднимается к плечу с приветливой улыбкой; Кадр 2: ладошка поднята на уровне щеки/ушка, взмах вправо; Кадр 3: ладошка наклоняется влево; Кадр 4: плавный возврат ладошки в центр с милым подмигиванием.
* **📋 Режим движка:** `baked_in` (полноценное готовое лицо с эмоцией приветствия).
* **📁 Файл:** `generated_images/body_wave.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Based on the reference image, using the EXACT character design, hair style, chibi proportions, clothing, and pastel palette:
Create a 2D game sprite sheet with 4 animation frames arranged in ONE SINGLE HORIZONTAL ROW (1 row by 4 columns) on a 100% transparent PNG background.

CRITICAL SCALE & PROPORTION CONTRACT (MUST MATCH REFERENCE EXACTLY):
- DO NOT SHRINK OR SCALE DOWN THE CHARACTER. The body, head, and dress MUST remain at 100% full scale (head width 190-200px, torso/dress width 260-275px, standing height 385-390px).
- When the character raises her hand to wave, the hand stays at cheek/shoulder level to the side. The head and body DO NOT shrink.
- Centered horizontally in each cell (X=256), feet aligned to floor baseline (Y=460).
- Generous empty transparent spacing between all 4 frames.

Pose & Animation (Friendly Cheerful Waving Hand):
- Character has a baked-in sweet friendly smiling face with sparkling eyes and soft blush.
- Frame 1: Natural standing posture, right hand lifted up to shoulder level, friendly welcoming expression.
- Frame 2: Open palm tilted outward to the right with fingers waving, pleasant smile.
- Frame 3: Open palm waved back toward the left, cheerful twinkle in eyes.
- Frame 4: Palm returning to center wave position with playful slight head tilt.

100% transparent background, clean 2D anime cel-shaded style, sharp lineart, master game asset quality.
```

---

### [PROMPT: B21] `body_jump` — Радостный прыжок / Подскок (Jump Hop — Frame 01 Defect Fix)
* **📌 Что исправлено в промпте:** Устранена ошибка битого кадра. Полная 4-кадровая фаза прыжка: Подготовка/Присед $	o$ Взлёт/Пик $	o$ Парение в воздухе $	o$ Мягкое приземление. Все 4 кадра содержат цельного персонажа в полном масштабе.
* **🎬 Раскадровка:** Кадр 1: легкий пружинистый присед перед толчком; Кадр 2: подскок в воздух, ножки оторваны от пола, ручки взлетают вверх; Кадр 3: пик парения в воздухе с радостным личиком; Кадр 4: мягкое касание стопами пола с пружинящими коленями.
* **📋 Режим движка:** `baked_in` (радостное сияющее личико `^ o ^`).
* **📁 Файл:** `generated_images/body_jump.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Based on the reference image, using the EXACT character design, chibi anatomy, hair, dress, and pastel color scheme:
Create a clean 2D game sprite sheet with 4 animation frames in ONE SINGLE HORIZONTAL ROW (1 row by 4 columns) on a transparent PNG background.

CRITICAL INTEGRITY & SCALE CONTRACT:
- All 4 frames MUST contain the FULL, complete character body rendered at identical scale and thickness (no cropped frames, no tiny fragments).
- Head width ~190-210px, dress width ~260-280px.
- Generous transparent margins around each cell. No touching between frames.

Animation Sequence (Energetic Happy Chibi Jump):
- Frame 1 (Anticipation / Crouch): Slight knee bend downward on floor baseline, arms pulling back, excited smiling eyes.
- Frame 2 (Airborne Jump Peak): Character actively leaps into the air with feet lifted off the ground, dress hem and hair flowing upwards dynamically, arms raised in pure joy with open mouth smile.
- Frame 3 (Floating Descent): Hair and dress floating softly at the apex of the hop, hands spread out happily.
- Frame 4 (Landing Cushion): Feet touch back down to floor baseline (Y=460), knees softly bending to absorb landing, radiant happy face.

Clean transparent background, high-definition 2D anime sprite sheet, 1x4 horizontal layout.
```

---

### [PROMPT: B09] `body_celebrate` — Празднование / Радостный танец (Celebrate — Scale Stability Fix)
* **📌 Что исправлено в промпте:** Строгая фиксация ширины ($260-275\text{ px}$) во всех 4 кадрах, устранены скачки размера ($194\text{ px} \leftrightarrow 276\text{ px}$).
* **🎬 Раскадровка:** Кадр 1: победный жест кулачками у груди; Кадр 2: радостный взмах ручками вверх `\( > o < )/`; Кадр 3: игривое покачивание бедрами вправо с подмигиванием; Кадр 4: победная стойка с сиянием в глазах.
* **📋 Режим движка:** `baked_in` (триумфальное лицо счастья).
* **📁 Файл:** `generated_images/body_celebrate.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Based on the reference image, keeping EXACT chibi proportions, clothing details, and color palette:
Create a 2D game sprite sheet with 4 animation frames arranged horizontally in 1 row by 4 columns on a transparent background PNG.

SCALE STABILITY RULE (CRITICAL):
- Character MUST keep constant volume and scale across all 4 frames (body width 260-275px, head width 190-205px).
- DO NOT narrow or widen the character between frames.
- Center X=256, Feet floor line Y=460. Wide transparent gaps between cells.

Animation Sequence (Victory Celebrate Dance):
- Baked-in joyful celebratory facial expressions.
- Frame 1: Pumping fists excitedly near chest, sparkling determined happy eyes, body balanced.
- Frame 2: Throwing both hands up in victory Yay!, cheerful open smile `\( > o < )/`, dress hem flaring slightly.
- Frame 3: Playful hip sway to the right, one hand on hip, other waving a peace sign with winking eye.
- Frame 4: Dynamic celebration pose with radiant beaming smile, hair floating gently.

100% transparent background, crisp anime outlines, 1x4 strip.
```

---

### [PROMPT: B11] `body_bored` — Скука / Переминание с ноги на ногу (Boredom Sigh — Width & Volume Fix)
* **📌 Что исправлено в промпте:** Восстановлена стандартная пышность платья и причёски ($255-265\text{ px}$ вместо зауженных $196\text{ px}$).
* **🎬 Раскадровка:** Кадр 1: стоит, перенеся вес на левую ногу, слегка надув щёчки; Кадр 2: забавный глубокий вздох, плечики поднимаются; Кадр 3: выдох с прикрытыми сонными глазками; Кадр 4: перенос веса на правую ногу с лёгким покачиванием косичек.
* **📋 Режим движка:** `baked_in` (комичное скучающее личико `(- 3 -)`).
* **📁 Файл:** `generated_images/body_bored.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Based on the reference image, retaining the EXACT character art style, pastel colors, and chibi volume:
Create a 2D game sprite sheet with 4 animation frames in ONE SINGLE HORIZONTAL ROW (1 row by 4 columns) on a true transparent PNG background.

PROPORTION RULE:
- Maintain full chibi body fullness (dress width 255-265px, head width 185-195px, total height 385-390px).
- Do not compress or thin out the silhouette. Keep generous transparent padding between cells.

Animation Sequence (Cute Boredom & Sighing):
- Baked-in comical cute bored expression `(- 3 -)`.
- Frame 1: Weight resting on left hip, one hand hanging loose, slight cute pout on face.
- Frame 2: Inhaling for a sigh, shoulders rising slightly, eyes looking up lazily.
- Frame 3: Soft comical puff/sigh release, shoulders drooping comfortably, eyes half-closed in relaxed daze.
- Frame 4: Weight softly shifting toward the right foot, hair tips settling down naturally.

100% transparent PNG, no background artifacts, 1x4 horizontal layout.
```

---

### [PROMPT: B10] `body_scared` — Дрожь / Испуг тела (Scared Shiver — Pixel Mass Fix)
* **📌 Что исправлено в промпте:** Полный объем чиби-тела ($\sim 55\,000$ пикселей) при сохранении эффекта забавной аниме-дрожи.
* **🎬 Раскадровка:** Кадр 1: испуганная стойка, ручки прижаты к груди; Кадр 2: микро-дрожь влево с расширенными глазами; Кадр 3: микро-дрожь вправо с приподнятыми плечиками; Кадр 4: дрожащий возврат с забавным трепетом подола платья.
* **📋 Режим движка:** `baked_in` (комичный испуг с круглыми глазами `O _ O`).
* **📁 Файл:** `generated_images/body_scared.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Based on the reference image, with EXACT anime chibi character model, hair, outfit, and pastel palette:
Create a 2D game sprite sheet with 4 animation frames in ONE SINGLE HORIZONTAL ROW (1 row by 4 columns) on a transparent PNG background.

SCALE & SPACING:
- Keep full character body mass (head width 190-205px, torso width 240-260px, height 385-390px).
- Generous empty margins between all 4 frames.

Animation Sequence (Anime Comical Shiver / Startled Tremble):
- Baked-in scared/startled comical anime expression with wide startled eyes and nervous wavy mouth.
- Frame 1: Shocked freeze posture, hands clutched close to chest, eyes wide `O _ O`.
- Frame 2: Micro-jitter 2px to the left, trembling shoulders, hair vibrating subtly.
- Frame 3: Micro-jitter 2px to the right, dress hem vibrating in nervous panic.
- Frame 4: Recoil settle with cute teary startle, hands tucked tight.

Clean 100% transparent alpha PNG, sharp 2D vector lineart, 1x4 horizontal grid.
```

---

### [PROMPT: B16] `body_fall` — Паническое падение в воздухе (Air Fall — Width Fix)
* **📌 Что исправлено в промпте:** Нормальная ширина тела и платья в свободном падении ($250-270\text{ px}$ вместо суженных $204\text{ px}$).
* **🎬 Раскадровка:** Кадр 1: испуганно зависает в воздухе, ручки в стороны; Кадр 2: падение вниз, подол платья и волосы развеваются вверх; Кадр 3: панические взмахи ручками в воздухе; Кадр 4: аэродинамический полёт с кричащим ротиком.
* **📋 Режим движка:** `baked_in` (панический крик `( > < )` / `D:`).
* **📁 Файл:** `generated_images/body_fall.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Based on the reference image, maintaining EXACT character proportions, dress design, and colors:
Create a 2D game sprite sheet with 4 animation frames in ONE SINGLE HORIZONTAL ROW (1 row by 4 columns) on a transparent PNG background.

PROPORTIONS & VOLUME:
- Keep full chibi width and volume (width 250-275px across flowing hair and billowing dress).
- Do not compress the character into a narrow stick. Ample spacing between frames.

Animation Sequence (Comical Mid-Air Falling Panic):
- Baked-in comical panicked falling expression with wide screaming mouth and anime worry eyes.
- Frame 1: Initial drop into the air, arms flailing outward, hair starting to billow upwards.
- Frame 2: Full airborne fall, dress skirt and long hair floating dynamically upward from air resistance.
- Frame 3: Panicked flailing of limbs in mid-air, cute frantic expression.
- Frame 4: Streamlined falling pose, arms reaching upward as gravity pulls down.

100% transparent background, crisp 2D anime aesthetic, 1x4 horizontal layout.
```

---

### [PROMPT: B04] `body_land` — Мягкое приземление на пол (Land Impact & Seamless Idle Transition)
* **📌 Что исправлено в промпте:** Исправлена последовательность фаз движения и устранена просадка в кадре 4. Кадр 4 формирует **полностью выпрямленную стоячую позу, которая геометрически и эмоционально бесшовно перетекает в `body_idle_00`** (Head Top $Y \approx 75\text{ px}$, Height $\approx 385\text{ px}$, Width $\approx 250\text{ px}$).
* **🎬 Раскадровка:**
  - **Кадр 1 (Touchdown):** Касание носочками пола ($Y=460$), начало амортизации, глаза зажмурены от скорости `( > < )`, ручки разведены в стороны.
  - **Кадр 2 (Deep Squash Cushion):** Глубокий мягкий присед, колени согнуты, подол платья и хвостики пышно расправляются в стороны (Top $Y \approx 190\text{ px}$), максимальное поглощение импульса падения.
  - **Кадр 3 (Rebound / Rising):** Разгибание колен, туловище поднимается вверх (Top $Y \approx 120\text{ px}$), ручки опускаются, глаза начинают приоткрываться.
  - **Кадр 4 (Full Upright Standing — Idle Settle):** Полный рост на двух ножках (Top $Y \approx 75\text{ px}$, Height $385\text{ px}$), устойчивая вертикальная стойка с открытыми ясными глазками и мягкой улыбкой облегчения, готовая на 100% бесшовно перейти в `body_idle`.
* **📋 Режим движка:** `baked_in` (готовое динамическое лицо: от зажмуривания к открытым глазам облегчения).
* **📁 Файл:** `generated_images/body_land.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Based on the reference image (body_idle_00.png), maintaining the EXACT character design, hair style, chibi proportions, outfit, and pastel palette:
Create a 2D game sprite sheet with 4 animation frames arranged in ONE SINGLE HORIZONTAL ROW (1 row by 4 columns) on a 100% transparent PNG background.

CRITICAL MOTION & TRANSITION CONTRACT:
- Frame 4 MUST transition seamlessly into body_idle_00. In Frame 4, the character MUST be standing upright at full height (head top Y~75px, standing height 385-390px, dress width ~250px) with open bright eyes and a sweet relieved smile.
- Strict height progression: Frame 1 (Touchdown Y~130px) -> Frame 2 (Deep Crouch Y~190px) -> Frame 3 (Rising Y~125px) -> Frame 4 (Fully Standing Upright Y~75px). DO NOT crouch again in Frame 4!
- Center X=256 in each cell, feet on baseline Y=460. Generous transparent spacing between cells.

Animation Sequence (Landing Impact to Standing Rest):
- Frame 1 (Touchdown): Toes touch floor baseline, knees bending, arms spread for balance, face wincing/worry with closed eyes `( > < )`.
- Frame 2 (Squash / Impact Absorption): Deep cute crouch, knees wide, dress skirt and hair flares outward softly, eyes squeezed tight `> <`.
- Frame 3 (Rebounding Upward): Knees straightening up, torso lifting, hair settling down, eyes gently beginning to open with relief.
- Frame 4 (Full Standing Rest — Matches Idle): Character fully standing upright on both feet, hands resting naturally at sides, wide bright open eyes with gentle smile, 100% matching the idle baseline posture.

Clean 100% transparent background PNG, sharp 2D anime vector style, 1x4 horizontal strip.
```

---

## Раздел 1: Базовые оверлеи лиц, зрачков и реквизита

### [PROMPT: F09] `face_blink` — Моргание (Blinking Eyes Cycle)
* **📌 Что делает:** Персонаж плавно моргает глазами в состоянии покоя (открытые глаза $\to$ полуприкрытые $\to$ закрытые $\to$ открывающиеся).
* **🎬 Раскадровка:** Кадр 1: ясные открытые глаза; Кадр 2: веки опускаются на 50%; Кадр 3: веки полностью сомкнуты дугами `^ ^`; Кадр 4: веки открываются.
* **📋 Режим движка:** `overlay` (накладывается поверх безликих тел `body_idle`, `body_sit`, `body_lie`).
* **📁 Файл:** `generated_images/face_blink.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Based on the reference image, maintaining the EXACT art style, luminous lavender-purple eye design, star-shine specular highlights, and facial proportions:
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Facial expression overlay only for chibi anime character, featuring ONLY eyes, subtle eyebrows, and cute mouth. No body, no hair, no neck.
Animation sequence: Smooth blinking cycle (Frame 1: wide open bright eyes with small neutral smiling mouth, Frame 2: half-closed eyelids transitioning down, Frame 3: fully closed relaxed peaceful eyes like soft arcs ^ ^, Frame 4: gently opening eyelids returning to start).
Perfect horizontal alignment, identical eye spacing and scale in all 4 cells, sharp crisp anime vector lineart, flat vibrant coloring, true PNG alpha transparency, masterwork game asset quality.
```

---

### [PROMPT: F10] `face_smug` — Ухмылка / Хитрая уверенность (Smug Expression)
* **📌 Что делает:** Персонаж хитро и уверенно ухмыляется, насмешливо щурясь с кошачьей улыбкой.
* **🎬 Раскадровка:** Кадр 1: прищуренный взгляд с приподнятой бровью; Кадр 2: озорной блеск в глазах с ухмылкой `:3`; Кадр 3: дерзкий взгляд с широкой самодовольной ухмылкой; Кадр 4: плавный возврат к лёгкой ухмылке.
* **📋 Режим движка:** `overlay`
* **📁 Файл:** `generated_images/face_smug.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Based on the reference image, maintaining the EXACT art style, eye aesthetics, and facial proportions of the character:
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Facial expression overlay only for chibi anime character, featuring ONLY eyes, expressive eyebrows, and cute mouth. No body, no hair, no neck.
Character aesthetic: luminous lavender-purple eyes, sparkling confident specular highlights.
Animation sequence: Cute playful smug anime face (Frame 1: sly half-closed confident eyes with one raised eyebrow and a subtle smirk mouth, Frame 2: sparkling glint in the eyes with mischievous cat-like grin :3, Frame 3: bold smug playful wink-glance with wide cocky smirk, Frame 4: relaxing back to subtle confident smirk).
Perfect horizontal alignment, identical scale and positioning in all 4 cells, crisp clean anime lineart, vibrant shading, true PNG alpha transparency.
```

---

### [PROMPT: F11] `face_crying` — Плач / Аниме-слёзки (Crying / Teary Eyes)
* **📌 Что делает:** Персонаж обиженно плачет комичными аниме-слезами, из глаз текут ручейки слёз.
* **🎬 Раскадровка:** Кадр 1: огромные влажные глаза со слезинками на уголках и дрожащим ртом `3:`; Кадр 2: крупные прозрачные капли слёз стекают по щекам; Кадр 3: комичные водопадные струи слёз со зажмуренными глазами `>_<`; Кадр 4: всхлипывание со сверкающими брызгами слёз.
* **📋 Режим движка:** `overlay`
* **📁 Файл:** `generated_images/face_crying.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Based on the reference image, maintaining the EXACT art style, eye color, and facial anatomy of the character:
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Facial expression overlay only for chibi anime character, featuring ONLY eyes, arched sad eyebrows, tears, and trembling mouth. No body, no hair, no neck.
Character aesthetic: large watery anime eyes with glowing purple irises and shimmering tear droplets.
Animation sequence: Crying anime expression loop (Frame 1: huge teary glossy eyes welling up with tears and a trembling pouting mouth 3:, Frame 2: big sparkling translucent tears rolling down cheek level, Frame 3: streaming sparkling anime waterfall tears with squeezed watery eyes >_<, Frame 4: sniffling expression with glittering tear drops).
Perfect horizontal alignment, uniform spacing in all 4 cells, vibrant cel-shaded anime style, true PNG alpha transparency.
```

---

### [PROMPT: F08] `face_gaze` — Дискретные направления взгляда лица (Directional Anime Face Gaze)
* **📌 Что делает:** Полный оверлей лица с глазами, ресницами, бровями и спокойным ртом, где взгляд направлен в 4 разные стороны для дискретного слежения за курсором.
* **🎬 Раскадровка:** Кадр 1: взгляд резко ВЛЕВО ($\leftarrow$); Кадр 2: взгляд резко ВПРАВО ($\rightarrow$); Кадр 3: взгляд ВВЕРХ ($\uparrow$); Кадр 4: взгляд ВНИЗ ($\downarrow$).
* **📋 Режим движка:** `overlay` (накладывается поверх `body_idle`, `body_sit`, `body_lie`).
* **📁 Файл:** `generated_images/face_gaze.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Based on the reference image, maintaining the EXACT art style, eye shape, star specular highlights, and facial proportions:
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Facial expression overlay only for chibi anime character, featuring complete anime face features: large luminous lavender-purple eyes, delicate upper/lower eyelashes, subtle expressive eyebrows, and cute small mouth. No hair, no body, no neck.
Character aesthetic: ethereal anime girl with sparkling star specular highlights inside irises.
4 distinct directional gaze frames:
- Frame 1: Eyes looking sharply to the LEFT (←), small neutral calm mouth.
- Frame 2: Eyes looking sharply to the RIGHT (→), small neutral calm mouth.
- Frame 3: Eyes looking UPWARDS (↑), slightly parted curious mouth.
- Frame 4: Eyes looking DOWNWARDS (↓), gentle relaxed mouth.
Uniform head alignment, identical eye distance and scale in all 4 cells, sharp anime vector lineart, flat vibrant coloring, true PNG alpha transparency.
```

---

### [PROMPT: P01] `prop_pillow` — Мягкая подушечка для сна (Plush Bed Pillow)
* **📌 Что делает:** Мягкая зефирная подушечка плавно пружинит и сминается под головой спящего персонажа.
* **🎬 Раскадровка:** Кадр 1: пышная надутая подушка; Кадр 2: лёгкое продавливание в центре; Кадр 3: максимальное уютное сжатие; Кадр 4: плавное расправление обратно.
* **📋 Режим движка:** `props` (слой реквизита, z-index 40).
* **📁 Файл:** `generated_images/prop_pillow.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Matching the EXACT pastel anime aesthetic and cozy color palette of the character from the reference image:
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Chibi anime prop asset: An ultra-cute, plush fluffy sleeping pillow for anime chibi character.
Color palette: pastel white and soft lavender with faint glowing star embroidery pattern and delicate golden frills.
Animation: Soft squish and breathing bounce cycle (Frame 1: puffy fluffy pillow, Frame 2: gentle soft compression in center where head rests, Frame 3: deepest soft squish, Frame 4: gently decompressing back to fluffy shape).
Clean isometric / front perspective, no character, object only, cel-shaded anime game art, crisp outlines, true PNG alpha transparency.
```

---

### [PROMPT: P02] `prop_heart` — Парящие сердечки любви / ласки (Floating Hearts FX)
* **📌 Что делает:** Полупрозрачные неоновые сердечки появляются, пульсируют и улетают вверх при поглаживании чиби.
* **🎬 Раскадровка:** Кадр 1: маленькое появляющееся сердечко с микро-искорками; Кадр 2: увеличивающееся пульсирующее сердце; Кадр 3: сердце максимального размера с сиянием; Кадр 4: рассеивание в мягкую звёздную пыльцу.
* **📋 Режим движка:** `props`
* **📁 Файл:** `generated_images/prop_heart.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Matching the EXACT magical pastel art style and glowing effects of the character from the reference image:
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Visual FX prop layer: Glowing anime love hearts floating upwards.
Color palette: vibrant glowing magenta, soft pink, and pastel lavender with bright white sparkle glints.
Animation sequence: Floating pulse cycle (Frame 1: small glowing heart appearing with tiny sparkles, Frame 2: heart expanding and pulsing brightly while rising, Frame 3: heart at maximum size with tiny mini-hearts bursting outward, Frame 4: heart gently fading into soft glowing glitter particles).
Clean visual effects sprite, no background, isolated FX, sharp clean vector anime aesthetic, true PNG alpha transparency.
```

---

### [PROMPT: P03] `prop_question` — Аниме-знак вопроса `?` (Confused Question Mark FX)
* **📌 Что делает:** Объёмный золотистый знак вопроса покачивается и подскакивает над головой при озадаченности.
* **🎬 Раскадровка:** Кадр 1: знак наклоняется влево; Кадр 2: подскакивает вверх с искоркой; Кадр 3: зависает в верхней точке с наклоном вправо; Кадр 4: плавно опускается в исходное положение.
* **📋 Режим движка:** `props`
* **📁 Файл:** `generated_images/prop_question.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Matching the EXACT anime game UI aesthetic and pastel tones from the reference image:
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Visual FX prop layer: Cute bouncy anime 3D-styled question mark icon '?' floating above character head.
Color palette: bright pastel yellow-gold with soft lilac drop shadow and shiny glossy specular highlights.
Animation sequence: Wobble and bounce loop (Frame 1: question mark leaning slightly to the left with anticipation, Frame 2: popping upward with a tiny bounce spark, Frame 3: floating at peak height tilted to the right, Frame 4: dropping smoothly down to starting position).
Isolated prop icon only, clean transparent background, crisp bold chibi game UI art, true PNG alpha transparency.
```

---

### [PROMPT: P04] `prop_sparkle` — Сверкающие аниме-звёздочки `✨` (Sparkle Stars FX)
* **📌 Что делает:** Четырёхконечные золотые и голубые звёздочки вспыхивают и вращаются вокруг персонажа при победе/радости.
* **🎬 Раскадровка:** Кадр 1: точка света загорается; Кадр 2: раскрывается в 4-конечную сияющую звезду с ореолом; Кадр 3: максимальная вспышка с микро-искрами; Кадр 4: плавное угасание в звёздную пыль.
* **📋 Режим движка:** `props`
* **📁 Файл:** `generated_images/prop_sparkle.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Matching the EXACT sparkle particle and star shine aesthetic from the reference image:
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Visual FX prop layer: Shimmering anime magic sparkle stars (4-pointed twinkle stars and glitter glints).
Color palette: brilliant luminous gold, diamond white, and celestial light blue glows.
Animation sequence: Twinkle and shine cycle (Frame 1: small pinpoint light glint igniting, Frame 2: expanding into radiant 4-point cross star with glowing corona halo, Frame 3: star rotating slightly with maximum brilliant flare burst and orbiting micro-sparkles, Frame 4: soft dispersing stardust fade).
Isolated VFX only, no background, high resolution cel-shaded game particles, true PNG alpha transparency.
```

---

## Раздел 2: Позы ИИ-помощника и интерактив с рабочим столом (`baked_in`)

### [PROMPT: B22] `body_typing` — Печать на ноутбуке (AI Code / Chat Generation)
* **📌 Что делает:** Чиби сидит по-турецки перед миниатюрным светящимся кибер-ноутбуком и быстро увлечённо стучит пальчиками по клавиатуре.
* **🎬 Раскадровка:** Кадр 1: левая ручка нажимает клавишу, правая приподнята; Кадр 2: правая ручка нажимает клавишу, экран мягко бликует; Кадр 3: обе ручки быстро порхают над клавиатурой; Кадр 4: радостный лёгкий кивок/подскок при компиляции.
* **📋 Режим движка:** `baked_in` (всё тело с готовым выражением лица, привязка к полу).
* **📁 Файл:** `generated_images/body_typing.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Using the EXACT character design, silver-white twin-tails hair with light blue highlights, pastel white hoodie dress with oversized sleeves, purple eyes, proportions, and anime art style from the reference image:
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Full body chibi anime girl sitting cross-legged on the floor typing intently on a miniature glowing holographic pastel laptop.
Baked-in face included: Focused, happy expression with bright enthusiastic eyes looking down at laptop screen and a cheerful determined mouth.
Animation sequence: Fast enthusiastic typing loop (Frame 1: left hand pressing key while right hand floats up, Frame 2: right hand tapping key, screen glints softly, Frame 3: both hands fluttering rapidly over keyboard, Frame 4: happy slight bounce as code compiles).
Perfect horizontal alignment, clean transparent PNG background, crisp cel-shaded anime lineart.
```

---

### [PROMPT: B23] `body_read_book` — Чтение книги знаний (Researching / Reading Docs)
* **📌 Что делает:** Чиби сидит и держит в ручках раскрытую толстую светящуюся книгу с золотыми звёздочками, задумчиво водя пальчиком по строкам и переворачивая страницы.
* **🎬 Раскадровка:** Кадр 1: увлечённое чтение, взгляд бегает по строкам; Кадр 2: кончиками пальцев приподнимает светящуюся страницу; Кадр 3: страница перелистывается в воздухе со звёздочками; Кадр 4: мягко приглаживает новую страницу.
* **📋 Режим движка:** `baked_in`
* **📁 Файл:** `generated_images/body_read_book.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Using the EXACT character design, silver-white hair, soft blue highlights, pastel white tunic dress, glowing purple eyes, and anime art style from the reference image:
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Full body chibi anime girl sitting peacefully, holding a large magical open glowing grimoire/book in her hands.
Baked-in face included: Curious scholarly expression with sparkling wide purple eyes following the text and a gentle smile.
Animation sequence: Reading and turning page loop (Frame 1: focused reading with eyes scanning left to right, Frame 2: turning the glowing page gently with tiny sparkles rising, Frame 3: page fluttering over in mid-turn, Frame 4: smoothing the fresh page down softly).
Centered 512x512 grid, wide spacing between cells, clean transparent alpha channel, high quality anime vector style.
```

---

### [PROMPT: B24] `body_drink_tea` — Уютное чаепитие (Cozy Tea Break)
* **📌 Что делает:** Персонаж держит обеими ручками в длинных рукавах тёплую дымящуюся кружечку чая/какао, дует на пар и делает глоток.
* **🎬 Раскадровка:** Кадр 1: держит кружку у груди с завитком пара; Кадр 2: подносит к губам и нежно дует на пар; Кадр 3: делает глоточек с блаженно зажмуренными глазками; Кадр 4: опускает кружку с довольным вздохом.
* **📋 Режим движка:** `baked_in`
* **📁 Файл:** `generated_images/body_drink_tea.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Using the EXACT character design, silver-white twin-tails, pastel white outfit with oversized sleeves, and anime art style from the reference image:
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Full body chibi anime girl enjoying a cozy break, holding a cute warm steaming mug of tea/hot cocoa with two hands.
Baked-in face included: Blissful, comfy expression with soft closed happy eyes and a tiny warm smile.
Animation sequence: Sipping and blowing warm tea (Frame 1: holding mug close to chest with rising steam swirl, Frame 2: bringing mug up to lips and gently blowing steam, Frame 3: taking a cozy sip with satisfied peaceful eyes, Frame 4: lowering mug with a blissful sigh).
Single horizontal strip of 4 frames, wide spacing, transparent background, clean game art lines.
```

---

### [PROMPT: B25] `body_listen_music` — Музыкальная пауза (Vibing to Music)
* **📌 Что делает:** На голове светящиеся кошачьи наушники, чиби ритмично покачивает головой и телом в такт любимому треку.
* **🎬 Раскадровка:** Кадр 1: наклон головы влево в бит; Кадр 2: пружинистый полуприсед в центре; Кадр 3: наклон головы вправо с подскоком; Кадр 4: плавный возврат в центр.
* **📋 Режим движка:** `baked_in`
* **📁 Файл:** `generated_images/body_listen_music.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Using the EXACT character design, silver-white hair, pastel outfit, and anime art style from the reference image:
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Full body chibi anime girl wearing stylish glowing lavender cat-ear over-ear headphones, standing and vibing cheerfully to music with slight rhythmic hip and head sway.
Baked-in face included: Happy joyful face with eyes closed to the beat and a beaming smile.
Animation sequence: Rhythmic headbobbing dance loop (Frame 1: head tilting slightly left to the beat, Frame 2: dipping down in central rhythmic groove, Frame 3: head tilting right with happy bounce, Frame 4: rising smoothly back to center).
Equal frame widths, clean 1x4 layout, transparent background, vibrant cel-shaded color palette.
```

---

### [PROMPT: B26] `body_sit_edge` — Сидение на кромке окна / панели (Window Edge Dangle)
* **📌 Что делает:** Чиби сидит на верхней рамке активного окна пользователя и весело болтает ножками в воздухе.
* **🎬 Раскадровка:** Кадр 1: левая ножка качнулась вперёд, правая назад; Кадр 2: ножки проходят среднюю точку; Кадр 3: правая ножка вперёд, левая назад; Кадр 4: плавный возврат в исходное положение.
* **📋 Режим движка:** `baked_in` (привязка базовой линии к верхней кромке окна).
* **📁 Файл:** `generated_images/body_sit_edge.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Using the EXACT character design, flowing silver-white hair, pastel outfit, and anime chibi proportions from the reference image:
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Full body chibi anime girl sitting on an edge with hands resting beside her thighs, legs dangling freely below the ledge.
Baked-in face included: Cheerful friendly face looking straight at the viewer with bright purple anime eyes and an open smile.
Animation sequence: Leg dangling swing loop (Frame 1: left leg swung slightly forward, right leg swung slightly back, Frame 2: legs passing center, Frame 3: right leg swung forward, left leg swung back, Frame 4: returning smoothly to Frame 1).
Strict 1x4 horizontal sheet, aligned sitting baseline, wide spacing between cells, clean transparent background.
```

---

### [PROMPT: B27] `body_peek_wall` — Выглядывание из-за края экрана (Edge Peeking)
* **📌 Что делает:** Персонаж держится ручками за невидимый вертикальный край монитора/окна и с любопытством выглядывает наружу.
* **🎬 Раскадровка:** Кадр 1: выглядывают только макушка и кончики ушек/глазок; Кадр 2: высовывается всё личико и две ручки, держащиеся за край; Кадр 3: максимальный наклон вперёд с сияющими глазами; Кадр 4: осторожно прячется назад.
* **📋 Режим движка:** `baked_in` (привязка к боковой границе экрана).
* **📁 Файл:** `generated_images/body_peek_wall.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Using the EXACT character design, silver-white hair, hair ribbon, oversized pastel sleeves, and chibi anime art style from the reference image:
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Full body chibi anime girl peeking around a vertical border from the left side, two small hands gripping the invisible vertical border line.
Baked-in face included: Super curious, playful expression with large shining eyes peering out and a cute mischievous smile.
Animation sequence: Peeking out and ducking slightly (Frame 1: just head and top of eyes peeking out, Frame 2: leaning further out showing full smiling face and hands, Frame 3: peak curious lean with sparkling eyes, Frame 4: ducking gently back to shallow peek).
1 row by 4 columns format, wide spacing, clean transparent PNG-32 alpha, masterwork 2D game asset.
```

---

## Раздел 3: Новые оверлеи эмоций лица (`overlay`)

### [PROMPT: F12] `face_sparkle_eyes` — Глаза-звёздочки восторга (Hyped Starry Eyes)
* **📌 Что делает:** В зрачках загораются вращающиеся 4-конечные золотые звёзды крайнего восторга `✪ ω ✪`.
* **🎬 Раскадровка:** Кадр 1: широко распахнутые глаза с яркой золотой звездой в радужке; Кадр 2: звезда пульсирует и расширяется с милым приоткрытым ротиком; Кадр 3: максимальная звёздная вспышка; Кадр 4: мягкая пульсация с возвратом к старту.
* **📋 Режим движка:** `overlay`
* **📁 Файл:** `generated_images/face_sparkle_eyes.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Based on the reference image, maintaining the EXACT art style, star-pupil aesthetic, and facial anatomy of the character:
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Facial expression overlay only for chibi anime character, featuring ONLY eyes and cute open mouth. No body, no hair.
Character aesthetic: Large glowing gold-and-lavender sparkling star pupils (starry eyes anime effect ✪ ω ✪).
Animation sequence: Pulsing star-eyes excitement loop (Frame 1: wide glowing eyes with 4-point yellow star shine in irises, Frame 2: star sparkle expanding and rotating with cute open w-mouth, Frame 3: maximum brilliant flare shine bursting from star eyes, Frame 4: soft sparkling pulse returning to start).
Perfect horizontal alignment, identical eye center coordinates, crisp clean outlines, true PNG alpha transparency.
```

---

### [PROMPT: F13] `face_embarrassed` — Смущение / Пунцовый румянец (Blushing Tsundere)
* **📌 Что делает:** Персонаж отводит взгляд в сторону, заливается густым аниме-румянцем и надувает губки `>///<`.
* **🎬 Раскадровка:** Кадр 1: взгляд отведён вправо с лёгкой штриховкой румянца; Кадр 2: румянец становится ярче, вздыхает с облачком пара; Кадр 3: сильно зажмуренные от смущения глазки и надутые губки; Кадр 4: робкий взгляд исподлобья.
* **📋 Режим движка:** `overlay`
* **📁 Файл:** `generated_images/face_embarrassed.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Based on the reference image, maintaining the EXACT art style, purple eye design, and blush styling of the character:
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Facial expression overlay only for chibi anime character, featuring ONLY eyes, furrowed shy eyebrows, dense blush lines, and pouting mouth. No hair, no body.
Aesthetic: Averted glowing purple eyes looking away sideways with intense anime blush cross-hatching and blushing cheeks.
Animation sequence: Shy embarrassed loop (Frame 1: looking away to the right with shy trembling eyelids and small wavy mouth, Frame 2: blushing deeper with little steam puffs, Frame 3: squeezed averted eyes >///< with cute grumpy pouting lips, Frame 4: shyly glancing back toward center).
Single horizontal strip of 4 frames, clean transparent background, high resolution anime cel-shading.
```

---

### [PROMPT: F14] `face_panic_scream` — Панический крик (Comical Scream Shock)
* **📌 Что делает:** Комичный панический шок и крик: рот широко открывается `D:`, зрачки сужаются в дрожащие точки.
* **🎬 Раскадровка:** Кадр 1: широко открытый орущий рот и вибрирующие зрачки; Кадр 2: рот расширяется с комичным зигзагообразным контуром зубок; Кадр 3: волнообразный крик со слезинками по краям глаз; Кадр 4: быстрый вдох перед новым криком.
* **📋 Режим движка:** `overlay`
* **📁 Файл:** `generated_images/face_panic_scream.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Based on the reference image, maintaining the EXACT chibi anime art style and facial baseline of the character:
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Facial expression overlay only for chibi anime character: Shocked screaming face with wide open comical mouth and pinpoint frantic pupils. No body, no hair.
Animation sequence: Frantic anime screaming loop (Frame 1: wide open mouth D: with vibrating tiny pupils, Frame 2: mouth opening wider with comical jagged teeth silhouette, Frame 3: wavy wailing scream with tear drops at eye edges, Frame 4: gasping breath before screaming again).
Uniform 4-cell layout, wide spacing, transparent background, clean vector anime lines.
```

---

## Раздел 4: Новые визуальные эффекты и реквизит (`props`)

### [PROMPT: P05] `prop_lightbulb` — Лампочка идеи `💡` (Idea Lightbulb FX)
* **📌 Что делает:** Над головой чиби весело всплывает и ослепительно вспыхивает мультяшная лампочка внезапного озарения.
* **🎬 Раскадровка:** Кадр 1: прозрачная колба появляется со смазанным движением вверх; Кадр 2: нить накала ярко зажигается; Кадр 3: ослепительная золотая вспышка с расходящимися лучиками; Кадр 4: мягкое тёплое свечение.
* **📋 Режим движка:** `props`
* **📁 Файл:** `generated_images/prop_lightbulb.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Matching the EXACT cel-shaded anime aesthetic and glowing color scheme from the reference image:
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Visual FX prop asset: A cute glowing anime idea lightbulb icon popping up with energetic rays.
Color palette: brilliant warm yellow-gold glass, soft lilac socket base, glowing radiant light filaments.
Animation sequence: Lightbulb popping and shining (Frame 1: transparent unlit glass bulb appearing with upward motion blur, Frame 2: filament sparking brightly, Frame 3: fully ignited incandescent brilliant flash with radiating golden burst beams, Frame 4: warm steady soft hum glow).
Clean isolated icon FX, no character, true PNG alpha transparency, crisp game UI asset quality.
```

---

### [PROMPT: P06] `prop_exclamation` — Знак восклицания / Алерта `!` (Alert Mark FX)
* **📌 Что делает:** Яркий сочный 3D-знак `!` резко выпрыгивает над головой с эффектом сжатия/растяжения (Squash & Stretch).
* **🎬 Раскадровка:** Кадр 1: знак выпрыгивает снизу со сжатием; Кадр 2: распрямляется с двумя ударными волнами; Кадр 3: дрожит на пиковой высоте; Кадр 4: плавно оседает.
* **📋 Режим движка:** `props`
* **📁 Файл:** `generated_images/prop_exclamation.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Matching the EXACT 2D chibi game art style and vibrant color accents from the reference image:
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Visual FX prop asset: Chunky 3D chibi-styled exclamation mark '!' icon for anime surprise / alert reaction.
Color palette: bright electric orange-red or magenta with shiny white glossy highlight and lilac shadow.
Animation sequence: Surprise pop loop (Frame 1: exclamation mark popping upward with squash-and-stretch impact, Frame 2: expanding with two tiny impact shockwave lines, Frame 3: hovering at peak height with vibrating jitter, Frame 4: settling smoothly down).
Isolated FX on transparent background, 1 row by 4 columns format, vector clean lineart.
```

---

### [PROMPT: P07] `prop_sweat_drop` — Капля неловкости `💧` (Awkward Sweat Drop FX)
* **📌 Что делает:** Огромная классическая аниме-капля пота появляется у виска, колышется и комично стекает вниз.
* **🎬 Раскадровка:** Кадр 1: большая круглая капля формируется у виска; Кадр 2: капля вытягивается и скользит вниз; Кадр 3: капля соскальзывает с микро-всплеском; Кадр 4: растворяется в воздухе.
* **📋 Режим движка:** `props`
* **📁 Файл:** `generated_images/prop_sweat_drop.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Matching the EXACT translucent anime FX shading and pastel blue tones from the reference image:
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Visual FX prop asset: Iconic giant anime blue sweat drop icon floating near the temple / side of head.
Color palette: translucent sky blue and sparkling cyan with pure white crescent shine highlight.
Animation sequence: Drip and wobble loop (Frame 1: big teardrop-shaped sweat drop forming and wobbling, Frame 2: elongating as it slides downward, Frame 3: drip sliding further down with tiny splash particle, Frame 4: vanishing into a soft translucent pop).
Clean isolated VFX sprite sheet, 4 frames, wide spacing, transparent background.
```

---

### [PROMPT: P08] `prop_zzz` — Сонные буковки `💤` (Sleeping Zzz Floating FX)
* **📌 Что делает:** Нежные полупрозрачные буквы `Z z z` плавно поднимаются в воздух волнообразной дугой от спящей чиби.
* **🎬 Раскадровка:** Кадр 1: маленькая светящаяся `z` появляется внизу; Кадр 2: `z` увеличивается и плывёт по диагонали, за ней появляется вторая `z`; Кадр 3: большая буква `Z` во главе парит в пушистом облачке; Кадр 4: верхняя буква мягко тает в воздухе.
* **📋 Режим движка:** `props`
* **📁 Файл:** `generated_images/prop_zzz.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Matching the EXACT pastel magical art style and glow effects from the reference image:
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Visual FX prop asset: Floating pastel-blue and lavender sleeping letters 'Z z z' drifting upwards in a gentle wavy curve.
Animation sequence: Floating sleep cycle (Frame 1: small glowing 'z' appearing at bottom, Frame 2: 'z' growing larger and drifting diagonally upwards while a second 'z' follows, Frame 3: capital 'Z' leading at top in soft cloud puff, Frame 4: highest letter gently dissolving into stardust).
Clean isolated FX, transparent background, 1x4 layout, cel-shaded anime aesthetic.
```

---

### [PROMPT: P09] `prop_music_notes` — Парящие музыкальные нотки `🎵` (Floating Music Notes FX)
* **📌 Что делает:** Разноцветные неоновые нотки (восьмые, двойные, скрипичный ключ) игриво подскакивают и кружатся в воздухе.
* **🎬 Раскадровка:** Кадр 1: розовая восьмая нотка подскакивает слева; Кадр 2: золотистая двойная нотка кружится в центре; Кадр 3: бирюзовый скрипичный ключ взлетает со звёздными искрами; Кадр 4: нотки мягко растворяются в воздухе.
* **📋 Режим движка:** `props`
* **📁 Файл:** `generated_images/prop_music_notes.png`
* **Формат:** 1 горизонтальный ряд × 4 колонки (`1x4`, 4 кадра).

```text
Matching the EXACT anime music FX aesthetic and colorful pastel palette from the reference image:
2D game sprite sheet, 4 animation frames in a single horizontal row, 1 row by 4 columns layout with wide spacing between frames, clean transparent background.
Visual FX prop asset: Glowing colorful anime musical notes (eighth notes, treble clef, beamed notes) floating up playfully.
Color palette: pastel cyan, bright pink, and golden yellow with sparkling trail dots.
Animation sequence: Bouncing melody loop (Frame 1: pink eighth note hopping up from left, Frame 2: yellow double note twisting playfully in center, Frame 3: cyan treble clef floating high with sparkle bursts, Frame 4: notes softly drifting and fading into air).
Isolated VFX, 1x4 horizontal grid, wide spacing, true PNG transparency.
```
