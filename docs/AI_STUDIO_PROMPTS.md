# AI Studio & GPT Image Generation Prompts — Project Wisp

> [!NOTE]
> Документ с техническим контрактом спрайтовой системы и готовыми к копированию промптами для генерации (GPT / DALL-E / AI Studio) с **нативной поддержкой прозрачности (PNG with true alpha transparency)**.

---

## 📐 1. Технический контракт спрайтовой системы (Sprite Contract)

### 1.1. Базовые параметры холста
* **Размер итогового холста (Canvas Size):** строго **`512 × 512 px`** (в игре рендерится как $256 \times 256\text{ px}$ на экранах Retina/High-DPI с двукратной чёткостью).
* **Формат файлов:** `PNG-32` с полноценным альфа-каналом (100% прозрачный фон RGBA).
* **Расположение кадров при генерации:** строго **в один горизонтальный ряд (1 row × 4 columns wide strip)**, чтобы скрипт нарезки автоматически делил полоску на 4 равных кадра.

### 1.2. Слоёная архитектура персонажа (Layer Stacking)
Персонаж рендерится послойно в едином холсте $512 \times 512\text{ px}$:
1. **Слой 0 (`props / shadows`):** тень персонажа под ногами, подушка для сна.
2. **Слой 1 (`base_body`):** тело персонажа с прической и одеждой. **Область лица остаётся чистой (цвет кожи без глаз и рта)** под оверлей.
3. **Слой 2 (`face`):** летающие черты лица (глаза, брови, рот) на прозрачном фоне.
4. **Слой 3 (`procedural_blush / fx`):** процедурный румянец, иконки эмоций (`fx_heart`, `fx_question`).

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
> Нейросеть генерирует **только черты лица** (глаза, брови, нос, рот, румянец).
> **Строго запрещено рисовать контур головы, волосы, уши, шею и овал лица!**
> Черты лица занимают центральную зону головы ($X \in [176, 336]$, $Y \in [110, 220]$ внутри квадрата $512 \times 512$). Всё остальное пространство — 100% прозрачный фон.

---

# 🎭 БЛОК 1: Оверлеи лиц и эмоций (Face Overlays — True Alpha PNG)

---

### F01. `face_curious` | Любопытство / Интерес
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

### F03. `face_surprised` | Испуг / Внезапный подхват мышью
* **Папка в игре:** `public/assets/sprites/faces/surprised/`
* **Файлы:** `face_surprised_00.png` — `face_surprised_03.png`

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

### F04. `face_blush` | Смущение / Нежный румянец
* **Папка в игре:** `public/assets/sprites/faces/blush/`
* **Файлы:** `face_blush_00.png` — `face_blush_03.png`

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

### F07. `pupils_normal` | Изолированные зрачки (для Gaze Tracking)
* **Папка в игре:** `public/assets/sprites/faces/pupils/`
* **Файлы:** `pupils_normal_00.png`, `pupils_normal_01.png`

```text
Using the EXACT eye color, iris gradient, pupil core, specular highlights, and eye-spacing from the ATTACHED REFERENCE IMAGE, generate an isolated pair of pupils for procedural eye tracking as a PNG with true alpha transparency.

Layout: Exactly 2 equal square frames arranged side-by-side in ONE SINGLE HORIZONTAL ROW (1 row × 2 columns wide strip).

CRITICAL RULES:
- ONLY draw the isolated pair of pupils and irises (left pupil and right pupil).
- DO NOT draw eyelashes, eyelids, sclera (white of eye), skin, eyebrows, head, or body.
- The two pupils must be positioned at the exact distance and vertical height matching the eyes in the reference image.
- Background must be 100% transparent alpha (no background, no white box, no fake checkerboard).

Breakdown:
- Frame 1: Standard isolated pupil pair looking straight forward with specular highlights.
- Frame 2: Same isolated pupil pair with an extra subtle star glint highlight.
```

---

# 🏃 БЛОК 2: Shimeji-позы тела (Body Sheets — True Alpha PNG)

> Все позы тела генерируются **без запечённых глаз и рта** (с чистым овалом лица цвета кожи), чтобы поверх можно было накладывать любые эмоции.

---

### B01. `body_sit` | Сидит на полу
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

# 🎁 БЛОК 3: Реквизит и спецэффекты (Props & FX — True Alpha PNG)

---

### P01. `props_pack` | Пак предметов и эмоций
* **Папка в игре:** `public/assets/sprites/props/`
* **Файлы:** `prop_shadow.png`, `prop_pillow.png`, `prop_heart.png`, `prop_question.png`

```text
Using the EXACT pastel cute anime art style and color palette from the ATTACHED REFERENCE IMAGE, generate a clean 2D game props and FX sheet on a transparent background PNG.

Layout: Exactly 4 equal square cells in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns).

Items breakdown:
- Cell 1 (prop_shadow): A clean, soft semi-transparent oval floor shadow seen from top-down 3/4 perspective, smooth soft gradient edge.
- Cell 2 (prop_pillow): A small, soft cozy pastel sleeping pillow with subtle creases.
- Cell 3 (prop_heart): A cute floating anime heart icon with soft sparkle highlights.
- Cell 4 (prop_question): A cute question mark "?" icon with a subtle exclamation mark sparkle.

Rules:
- 100% transparent background (true alpha PNG).
- No solid background boxes, no fake checkerboards, no characters, no scenery.
```
