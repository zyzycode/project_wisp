# AI Studio Prompts & Technical Sprite Contract — Project Wisp

> [!NOTE]
> Личный human-only документ. Включает в себя технический контракт спрайтовой системы, правила позиционирования слоёв и готовые к копированию промпты для AI Studio / Gemini.

---

## 📐 1. Технический контракт спрайтовой системы (Sprite Contract)

### 1.1. Базовые параметры холста
* **Размер итогового холста (Canvas Size):** строго **`512 × 512 px`** (в игре рендерится как $256 \times 256\text{ px}$ на экранах Retina/High-DPI с двукратной четкостью).
* **Формат файлов:** `PNG-32` с полноценным альфа-каналом (100% прозрачный фон RGBA).
* **Цветовое пространство:** `sRGB`, 8 bit/канал.

### 1.2. Слоёная архитектура персонажа (Layer Stacking)
Персонаж рендерится послойно в едином холсте $512 \times 512\text{ px}$:
1. **Слой 0 (`props / shadows`):** тень персонажа под ногами, подушка для сна.
2. **Слой 1 (`base_body`):** тело персонажа с прической и одеждой. Область лица оставляется чистой под оверлей.
3. **Слой 2 (`face`):** летающие черты лица (глаза, брови, рот) на прозрачном фоне.
4. **Слой 3 (`procedural_blush / fx`):** процедурный румянец, иконки эмоций (`fx_heart`, `fx_question`).

---

## 📏 2. Геометрические координаты и точки привязки (Anchors & Pivots)

### 2.1. Контракт тела (Body Contract)
* **Точка опоры (Pivot):** `{ x: 0.50, y: 0.90 }`.
* **Горизонтальное центрирование (Center X):** строго по центру (**`X = 256 px`**).
* **Линия опоры стоп (Floor Baseline Y):** строго **`Y = 460 px`** от верхнего края холста (снизу остается запас $\sim 52\text{ px}$ под тень и эффекты).
* **Высота стоящего персонажа (Target Height):** строго **`385 – 390 px`** (макушка головы находится в районе $Y \approx 70\dots75\text{ px}$).

### 2.2. Контракт оверлеев лиц (Face Overlay Contract)
> [!IMPORTANT]
> **Почему лица выходили гигантскими:**
> Если нейросеть рисовать лицо на весь холст $512 \times 512$, черты лица получаются масштаба крупного портрета ($400\text{ px}$ шириной) вместо маленького личика на чиби-теле!
> 
> **Строгие координаты зоны лица на холсте $512 \times 512$:**
> * **Центр лица:** `X = 256 px`, `Y = 160 px`.
> * **Зона черт лица (Face Bounding Box):** 
>   * По горизонтали: `X ∈ [176, 336] px` (ширина $\approx 160\text{ px}$).
>   * По вертикали: `Y ∈ [110, 220] px` (высота $\approx 110\text{ px}$).
> * **Линия уровня глаз:** `Y ≈ 140 – 155 px`.
> * **Линия рта:** `Y ≈ 185 – 200 px`.
> * **Прозрачность:** всё остальное пространство холста $512 \times 512$ — **100% чистая прозрачность**. Никаких контуров головы, кожи лица, черепа, ушей и волос!

---

## 🧘 Блок 1: Анимации тела (Body Sheets)

---

### 1A. `body_idle` | Дыхание в покое (4 кадра) (`дыхание.png`)
* **Категория:** `body/idle`
* **Файлы после нарезки:** `body/idle/body_idle_00.png` — `body_idle_03.png`

```text
Using the EXACT character design, hair style, facial features, body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: exactly 4 equal square frames in one horizontal row (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

Stability rules:
- Character keeps identical height, scale, body thickness, outfit, and palette across all frames.
- Character is centered horizontally in each cell (X=256).
- Feet stay aligned to one consistent floor baseline (Y=460).
- Background is 100% transparent: no solid fill, backdrop, white box, floor, or baked shadow.
- Clean sharp 2D game asset, no extra characters, no UI, no text labels.

Animation Goal: Create a calm standing idle loop with micro-breathing.

Frame 1: Base pose, calm open eyes, gentle neutral expression, hair resting naturally.
Frame 2: Inhale start, chest expands and shoulders rise by 3-4 pixels.
Frame 3: Peak inhale, posture slightly lifted, hair floats subtly.
Frame 4: Exhale/reset, shoulders and hair settle back toward Frame 1.
```

---

### 1B. `body_idle_8f` | Живой 8-кадровый Idle (`дыхание_8к.png`)
* **Категория:** `body/idle`
* **Файлы после нарезки:** `body/idle/body_idle_00.png` — `body_idle_07.png`
* **Сетка:** `2 rows × 4 columns` (или `1 row × 8 columns`)

```text
Using the EXACT character design, hair style, body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean, fluid 2D game sprite sheet with true alpha transparency.

Layout: exactly 8 equal square frames arranged in a 2 rows × 4 columns grid (or 1 row × 8 columns), read sequentially from Frame 1 to Frame 8.

Stability rules:
- Character keeps identical height (385-390px), body thickness, outfit, and pastel palette across all 8 frames.
- Character is strictly centered horizontally in each cell (X=256).
- Feet remain firmly planted on the exact same floor baseline (Y=460).
- Background is 100% transparent: no background box, no gradient, no floor line, no drop shadow.
- Clean sharp anime/chibi game asset, consistent line weight, no extra characters.

Animation Goal: An ultra-smooth 8-frame idle cycle combining deep breathing, micro-sway, and exactly 2 natural quick blinks spread smoothly across the cycle (Frame 2 and Frame 6).

Frame 1 (Resting Base): Natural upright posture, hands relaxed at sides, calm open eyes looking forward, gentle pleasant mouth, hair resting softly.
Frame 2 (Inhale & Blink 1): Chest begins to expand (+2px), quick natural blink (eyes softly closed in clean lash curves), hair tips float slightly.
Frame 3 (Peak Inhale): Chest fully expanded, shoulders lifted (+4px), eyes open wide and sparkling looking at viewer, hair suspended at peak.
Frame 4 (Exhale Transition): Shoulders begin smooth descent, eyes remain calm and open, weight shifts gently toward right foot.
Frame 5 (Exhale Rest): Chest settles to resting height, calm open eyes with a soft micro-smile, posture relaxed.
Frame 6 (Micro-Sway & Blink 2): Weight shifts subtly toward left foot, quick second blink (eyes softly closed), hands drift gently with inertia.
Frame 7 (Reopen & Re-center): Eyes reopen clear and bright, weight smoothly returns toward center between both feet.
Frame 8 (Loop Settle): Open serene eyes, body smoothly eases back into Frame 1 position for a seamless organic loop.
```

---

### 2. `body_walk` | Ходьба в 1 горизонтальную линию (4 кадра) (`ходьба.png`)
* **Категория:** `body/walk`
* **Файлы после нарезки:** `body/walk/body_walk_00.png` — `body_walk_03.png`

```text
Using the EXACT character design, hair style, facial features, chibi body proportions, clothing, and pastel color palette from the ATTACHED REFERENCE IMAGE, generate a clean 2D game sprite sheet.

Layout & Alignment:
- Exactly 4 equal square frames arranged side-by-side in ONE SINGLE HORIZONTAL ROW (1 row × 4 columns wide banner).
- All 4 characters must be positioned strictly along the exact same horizontal floor baseline (Y=460).
- Character torso centered at X=256 in each frame cell.
- Solid flat pure white background (#FFFFFF) or 100% transparent PNG, with NO ground shadows, NO floor lines, NO scenery, and NO boxes around frames.
- Character height (385-390px), hair color, eye style, and dress details must remain 100% identical and consistent across all 4 frames.

Animation Breakdown (Side-View Walking Cycle facing LEFT):
- Frame 1 (Left Foot Contact): Character walks facing left. Left leg takes a confident step forward with heel touching the floor baseline. Right leg stretches backward supporting on toe. Left arm swings backward, right arm swings forward.
- Frame 2 (Passing & Rise): Both feet meet together in the center. Body lifts slightly higher (+4px) on toes as the right leg begins swinging forward. Hair and dress float naturally.
- Frame 3 (Right Foot Contact): Right leg takes a confident step forward with heel touching the floor baseline. Left leg stretches backward supporting on toe. Right arm swings backward, left arm swings forward.
- Frame 4 (Passing & Settle): Both feet meet together in the center. Body settles smoothly back to baseline height, looping seamlessly back into Frame 1.
```

---

### 3. `body_dragged` | Перетаскивание курсором (`перетаскивание.png`)
* **Категория:** `body/dragged`
* **Файлы после нарезки:** `body_dragged_00.png` — `body_dragged_03.png`

```text
Using the EXACT character design, hair style, facial features, body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: exactly 4 equal square frames in one horizontal row (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

Stability rules:
- Character keeps identical height, scale, body thickness, outfit, and palette across all frames.
- Character is centered horizontally in each cell (X=256).
- Character is suspended in mid-air (airborne), centered vertically.
- Background is 100% transparent: no solid fill, backdrop, white box, floor, or baked shadow.
- Clean sharp 2D game asset, no extra characters, no UI, no text labels.

Animation Goal: Create a cute dangling loop where the character is lifted in mid-air by the mouse cursor, as if held by the collar.

Frame 1: Lifted and surprised, wide eyes, legs hanging, arms reaching up.
Frame 2: Kicks left leg forward, right leg back, arms flailing for balance.
Frame 3: Kicks right leg forward, left leg back, hair swaying sideways.
Frame 4: Resigned cute dangle, tiny pout, legs slightly bent, loops back to Frame 1.
```

---

### 4. `body_land` | Приземление на пол (`приземлен.png`)
* **Категория:** `body/land`
* **Файлы после нарезки:** `body_land_00.png` — `body_land_03.png`

```text
Using the EXACT character design, hair style, facial features, body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: exactly 4 equal square frames in one horizontal row (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

Stability rules:
- Character keeps identical height, scale, body thickness, outfit, and palette across all frames.
- Character is centered horizontally in each cell (X=256).
- Frames 2-4 share the exact same floor baseline (Y=460).
- Background is 100% transparent: no solid fill, backdrop, white box, floor, or baked shadow.
- Clean sharp 2D game asset, no extra characters, no UI, no text labels.

Animation Goal: Create a soft landing sequence with squash and stretch.

Frame 1: Airborne anticipation, toes pointed down, arms slightly spread, hair trailing upward.
Frame 2: Deep squash impact, feet hit baseline, knees bent low, hair and dress flare outward.
Frame 3: Spring stretch recoil, body rises tall on toes, hair trailing upward.
Frame 4: Neutral settle, flat-footed standard pose, hair resting, ready to return to idle.
```

---

### 5. `body_sleep_trans` | Переход ко сну (`готов_спать.png`)
* **Категория:** `body/sleep_transition`
* **Файлы после нарезки:** `body_sleep_trans_00.png` — `body_sleep_trans_03.png`

```text
Using the EXACT character design, hair style, facial features, body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: exactly 4 equal square frames in one horizontal row (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

Stability rules:
- Character keeps identical scale, body thickness, outfit, and palette across all frames.
- Character is centered horizontally in each cell.
- Baseline floor aligns with Y=460.
- Background is 100% transparent: no solid fill, backdrop, white box, floor, or baked shadow.
- Clean sharp 2D game asset, no extra characters, no UI, no text labels.

Animation Goal: Create a cozy sleep transition with a small pastel pillow.

Frame 1: Sleepy yawn, rubbing eyes with one fist while standing.
Frame 2: Kneels down and places a soft pillow on the floor.
Frame 3: Lies down sideways, head lowering onto the pillow, legs curling in.
Frame 4: Fully asleep lying on side, peaceful closed eyes, hair spread softly.
```

---

### 6. `body_sleep` | Дыхание во сне (`спит_дыхание.png`)
* **Категория:** `body/sleep`
* **Файлы после нарезки:** `body_sleep_00.png` — `body_sleep_03.png`

```text
Using the EXACT character design, hair style, facial features, body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: exactly 4 equal square frames in one horizontal row (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

Stability rules:
- Character keeps identical scale, body thickness, outfit, and palette across all frames.
- Character lies sideways on the pillow resting near floor baseline (Y=460).
- Background is 100% transparent: no solid fill, backdrop, white box, floor, or baked shadow.
- Clean sharp 2D game asset, no extra characters, no UI, no text labels.

Animation Goal: Create a sleeping breathing loop with the character lying sideways on the pillow.

Frame 1: Resting baseline, fully relaxed asleep on side.
Frame 2: Gentle inhale, chest and blanket/dress rise about 3 pixels.
Frame 3: Peak inhale, serene expression.
Frame 4: Gentle exhale, chest settles back to Frame 1.
```

---

### 7. `body_thinking` | Задумчивость (`думает.png`)
* **Категория:** `body/thinking`
* **Файлы после нарезки:** `body_thinking_00.png` — `body_thinking_03.png`

```text
Using the EXACT character design, hair style, facial features, body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: exactly 4 equal square frames in one horizontal row (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

Stability rules:
- Character keeps identical height, scale, body thickness, outfit, and palette across all frames.
- Character is centered horizontally in each cell (X=256).
- Feet remain firmly anchored to baseline (Y=460).
- Background is 100% transparent: no solid fill, backdrop, white box, floor, or baked shadow.
- Clean sharp 2D game asset, no extra characters, no UI, no text labels.

Animation Goal: Create a thinking-to-ready sequence.

Frame 1: Curious question pose, head tilted, finger near chin.
Frame 2: Deep thought, eyes looking upward, finger tapping chin.
Frame 3: Realization, eyes brighten, small smile, subtle hand gesture.
Frame 4: Ready to answer, hands clasped or small nod, confident warm expression.
```

---

### 8. `body_petting` | Реакция на поглаживание (`радость.png`)
* **Категория:** `body/petting`
* **Файлы после нарезки:** `body_petting_00.png` — `body_petting_03.png`

```text
Using the EXACT character design, hair style, facial features, body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: exactly 4 equal square frames in one horizontal row (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

Stability rules:
- Character keeps identical height, scale, body thickness, outfit, and palette across all frames.
- Character is centered horizontally in each cell (X=256).
- Feet remain aligned to baseline (Y=460) except during the small hop.
- Background is 100% transparent: no solid fill, backdrop, white box, floor, or baked shadow.
- Clean sharp 2D game asset, no extra characters, no UI, no text labels.

Animation Goal: Create a cute positive reaction to being petted.

Frame 1: Leans into touch with closed eyes and gentle smile.
Frame 2: Blushing happy expression, joyful eyes, hands clasped together.
Frame 3: Tiny excited hop (lifts 10-15px above baseline), hands near chest, hair bouncing.
Frame 4: Soft landing and happy settle, ready to return to idle.
```

---

## 😊 Блок 2: Оверлеи лиц (Face Overlays)

> [!IMPORTANT]
> **ПРАВИЛО ОВЕРЛЕЕВ ЛИЦ:**
> Нейросети **строго запрещено рисовать голову, волосы, уши, шею и овал лица**.
> Генерируются **только черты лица** (глаза, брови, нос, рот) в точных пропорциях головы персонажа. Черты лица занимают строго центральную область головы (`X: 176...336`, `Y: 110...220` внутри квадрата 512×512), а всё окружение — 100% прозрачный фон.

---

### 8F. `face_idle_blink_8f` | Моргание для покоя (8 кадров) (`моргание_8к.png`)
* **Категория:** `faces/idle_blink`
* **Файлы после нарезки:** `faces/idle_blink/face_idle_00.png` — `face_idle_07.png`
* **Сетка:** `2 rows × 4 columns` (или `1 row × 8 columns`)

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a clean 2D facial feature overlay sprite sheet as a PNG with true alpha transparency.

Layout: exactly 8 equal square cells in a 2 rows × 4 columns grid (or 1 row × 8 columns), read sequentially from Frame 1 to Frame 8.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth, and subtle soft blush.
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- The area around the eyes and mouth must be 100% transparent alpha.
- Keep the exact relative position, small scale, eye-spacing, and height of the face as if positioned onto the head in the reference image (facial zone X:176-336, Y:110-220 within 512x512 canvas).
- Absolute consistency across all 8 frames: identical eye size, color palette, and line art style.

Animation Goal: Natural relaxed idle face with a single realistic quick blink on frames 5-6 (leaving eyes open for 75% of the cycle).

Frame 1 (Open Base): Calm open eyes with sparkling highlights, gentle neutral mouth line, faint blush.
Frame 2 (Calm Hold): Same calm open eyes, pleasant micro-smile.
Frame 3 (Calm Hold): Same open eyes looking gently forward, relaxed eyebrows.
Frame 4 (Calm Hold / Pre-Blink): Open eyes, relaxed posture.
Frame 5 (Quick Half-Blink): Eyelids dropping halfway down (anticipation frame).
Frame 6 (Full Blink): Eyes smoothly closed into clean soft lash lines, closed relaxed mouth.
Frame 7 (Quick Eye Opening): Eyelids rising halfway back up, highlights reappearing.
Frame 8 (Open Settle): Eyes fully open and clear again, seamless transition back to Frame 1.
```

---

### 9. `face_happy` | Радость / Счастье (`счаст.png`)
* **Категория:** `faces/happy`
* **Файлы после нарезки:** `face_happy_00.png` — `face_happy_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a clean 2D facial feature overlay sprite sheet as a PNG with true alpha transparency.

Layout: exactly 4 equal square cells in one horizontal row (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth, and small expression FX (blush, tears, sweat drops).
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- The area around the eyes and mouth must be 100% transparent alpha.
- Keep the exact relative position, small scale, eye-spacing, and height of the face as if positioned onto the head in the reference image (facial zone X:176-336, Y:110-220 within 512x512 canvas).
- Absolute consistency across all 4 frames: identical eye size, color palette, and line art style.

Facial Expression Theme: Happy / Joy progression

Frame 1 (Soft Smile): Calm open eyes with gentle highlights, tiny pleasant smile, faint blush.
Frame 2 (Cheerful): Bright open eyes looking forward, wider smiling mouth, noticeable pink blush.
Frame 3 (Joyful Squinched): Closed curved anime eyes (^ ^), happy open smile showing upper teeth/mouth, cute rosy cheeks.
Frame 4 (Ecstatic / Laughing): Tightly closed joyful eyes (> <), wide happy open laugh, sparkling highlight accents, bright blush.
```

---

### 10. `face_sad` | Грусть / Плач (`грусть.png`)
* **Категория:** `faces/sad`
* **Файлы после нарезки:** `face_sad_00.png` — `face_sad_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a clean 2D facial feature overlay sprite sheet as a PNG with true alpha transparency.

Layout: exactly 4 equal square cells in one horizontal row (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth, and small expression FX (blush, tears, sweat drops).
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- The area around the eyes and mouth must be 100% transparent alpha.
- Keep the exact relative position, small scale, eye-spacing, and height of the face as if positioned onto the head in the reference image (facial zone X:176-336, Y:110-220 within 512x512 canvas).
- Absolute consistency across all 4 frames: identical eye size, color palette, and line art style.

Facial Expression Theme: Sadness / Distress progression

Frame 1 (Mild Sadness): Drooped eyebrows, slightly lowered pupils, tiny downturned mouth.
Frame 2 (Worry / Hurt): Troubled angled brows, glossy teary eyes with extra reflections, small quivering mouth.
Frame 3 (Crying): Squeezed shut sad eyes with tear drops at the corners, small open whimpering mouth, slight blue distress tint on forehead.
Frame 4 (Bawling / Streaming Tears): Closed crying eyes with animated tear streams flowing down cheeks, wide open crying mouth.
```

---

### 11. `face_shocked` | Удивление / Шок (`удивление.png`)
* **Категория:** `faces/shocked`
* **Файлы после нарезки:** `face_shocked_00.png` — `face_shocked_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a clean 2D facial feature overlay sprite sheet as a PNG with true alpha transparency.

Layout: exactly 4 equal square cells in one horizontal row (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth, and small expression FX (blush, tears, sweat drops).
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- The area around the eyes and mouth must be 100% transparent alpha.
- Keep the exact relative position, small scale, eye-spacing, and height of the face as if positioned onto the head in the reference image (facial zone X:176-336, Y:110-220 within 512x512 canvas).
- Absolute consistency across all 4 frames: identical eye size, color palette, and line art style.

Facial Expression Theme: Surprise / Shock progression

Frame 1 (Notice / Perked): Raised eyebrows, slightly widened eyes with focused small pupils, tiny "o" mouth.
Frame 2 (Surprised): High arched eyebrows, wide rounded eyes, open oval mouth.
Frame 3 (Shocked / Stunned): High startled eyebrows, tiny shrunken pupils (dot eyes), wide open gaping mouth, tiny anime sweatdrop near temple.
Frame 4 (Comical Panic / Bewildered): Swirl or spiral dizzy pupils, wavy uneven open mouth, multiple panic sweat droplets.
```

---

### 12. `face_talking` | Речь и мимика (`речь.png`)
* **Категория:** `faces/talking`
* **Файлы после нарезки:** `face_talking_00.png` — `face_talking_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a clean 2D facial feature overlay sprite sheet as a PNG with true alpha transparency.

Layout: exactly 4 equal square cells in one horizontal row (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth, and small expression FX (blush, tears, sweat drops).
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- The area around the eyes and mouth must be 100% transparent alpha.
- Keep the exact relative position, small scale, eye-spacing, and height of the face as if positioned onto the head in the reference image (facial zone X:176-336, Y:110-220 within 512x512 canvas).
- Absolute consistency across all 4 frames: identical eye size, color palette, and line art style.

Facial Expression Theme: Talking & Lip-sync with gentle blink

Frame 1 (Resting / Closed): Natural calm open eyes, closed resting mouth (line).
Frame 2 (Slight Open / M-B-P transition): Natural open eyes, slightly parted relaxed mouth.
Frame 3 (Wide Open / A-O vowels): Bright expressive open eyes, open talking mouth.
Frame 4 (Mid-Talk Blink): Half-closed blinking eyes, round "Oh" vowel mouth shape.
```

---

### 13. `face_thinking` | Задумчивость и сомнение (`думает_лицо.png`)
* **Категория:** `faces/thinking`
* **Файлы после нарезки:** `face_thinking_00.png` — `face_thinking_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a clean 2D facial feature overlay sprite sheet as a PNG with true alpha transparency.

Layout: exactly 4 equal square cells in one horizontal row (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth, and small expression FX (blush, tears, sweat drops).
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- The area around the eyes and mouth must be 100% transparent alpha.
- Keep the exact relative position, small scale, eye-spacing, and height of the face as if positioned onto the head in the reference image (facial zone X:176-336, Y:110-220 within 512x512 canvas).
- Absolute consistency across all 4 frames: identical eye size, color palette, and line art style.

Facial Expression Theme: Thinking / Skeptical progression

Frame 1 (Curious): One eyebrow slightly raised, eyes looking slightly up-left, neutral closed mouth.
Frame 2 (Pondering): Furrowed inner brows, eyes looking all the way up, mouth pursed to the side.
Frame 3 (Confused): Asymmetrical eyebrows (one high, one low), squinted asymmetrical eyes, wavy skeptical mouth (~).
Frame 4 (Idea / Eureka): Eyebrows snap up, wide sparkling enlightened eyes with star highlights, small confident smile.
```

---

### 14. `face_sleep` | Сонное лицо (`сон_лицо.png`)
* **Категория:** `faces/sleep`
* **Файлы после нарезки:** `face_sleep_00.png` — `face_sleep_03.png`

```text
Using the EXACT art style, eye design, eye color, line art weight, and facial proportions from the ATTACHED REFERENCE IMAGE, generate a clean 2D facial feature overlay sprite sheet as a PNG with true alpha transparency.

Layout: exactly 4 equal square cells in one horizontal row (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

CRITICAL OVERLAY RULES:
- ONLY draw facial features: eyes, eyebrows, nose, mouth, and small expression FX (blush, tears, sweat drops).
- DO NOT draw head silhouette, face skin shape, skull outline, ears, hair, neck, or body.
- The area around the eyes and mouth must be 100% transparent alpha.
- Keep the exact relative position, small scale, eye-spacing, and height of the face as if positioned onto the head in the reference image (facial zone X:176-336, Y:110-220 within 512x512 canvas).
- Absolute consistency across all 4 frames: identical eye size, color palette, and line art style.

Facial Expression Theme: Sleepy / Slumber progression

Frame 1 (Heavy Lids): Half-closed drowsy eyes, low relaxed eyebrows, tiny yawn mouth.
Frame 2 (Wide Yawn): Tightly squeezed shut eyes, wide open yawning mouth, tiny sleep tear at corner.
Frame 3 (Peaceful Asleep): Softly curved closed resting eyes, gentle relaxed mouth line, soft warm blush.
Frame 4 (Deep Sleep): Straight closed sleeping lash lines, tiny relaxed slightly parted "o" mouth with a tiny sleeping bubble near mouth/nose.
```

---

## 🚀 Блок 3: Дополнительные анимации и эффекты (Expansion Pack)

---

### 15. `body_wave` | Машет рукой (`машет.png`)
* **Категория:** `body/wave`
* **Файлы после нарезки:** `body_wave_00.png` — `body_wave_03.png`

```text
Using the EXACT character design, hair style, facial features, body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: exactly 4 equal square frames in one horizontal row (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

Stability rules:
- Character keeps identical height, scale, body thickness, outfit, and palette across all frames.
- Character is centered horizontally in each cell (X=256).
- Feet stay aligned to floor baseline (Y=460).
- Background is 100% transparent: no solid fill, backdrop, white box, floor, or baked shadow.
- Clean sharp 2D game asset, no extra characters, no UI, no text labels.

Animation Goal: Create a cute standing hand-waving cycle (greeting/goodbye).

Frame 1: Raises right hand up to head level, friendly smile, left hand resting at hip.
Frame 2: Hand tilts left, fingers spread slightly, body leans slightly right.
Frame 3: Hand tilts right, cheerful open expression, head tilted cutely.
Frame 4: Hand sways back toward center, looping cleanly back to Frame 1.
```

---

### 16. `body_celebrate` | Танец радости / Победа (`победа.png`)
* **Категория:** `body/celebrate`
* **Файлы после нарезки:** `body_celebrate_00.png` — `body_celebrate_03.png`

```text
Using the EXACT character design, hair style, facial features, body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a clean 2D game sprite sheet as a PNG with true alpha transparency.

Layout: exactly 4 equal square frames in one horizontal row (1 row × 4 columns), read left-to-right as Frame 1, Frame 2, Frame 3, Frame 4.

Stability rules:
- Character keeps identical height, scale, body thickness, outfit, and palette across all frames.
- Character is centered horizontally in each cell (X=256).
- Feet stay aligned to floor baseline (Y=460) except during the jump.
- Background is 100% transparent: no solid fill, backdrop, white box, floor, or baked shadow.
- Clean sharp 2D game asset, no extra characters, no UI, no text labels.

Animation Goal: Create an energetic celebration / victory animation.

Frame 1: Crouches down with fists clenched near chest (anticipation).
Frame 2: Leaps upward into the air (+20px) throwing both arms up high in a "V" sign, joyful expression.
Frame 3: Lands softly on baseline (Y=460), swaying hips with a cute victory pose.
Frame 4: Claps hands together in front of chest with a sparkling bright smile, ready to loop.
```

---

### 17. `props_pack` | Пак предметов и эффектов (`предметы.png`)
* **Категория:** `props`
* **Файлы после нарезки:** `props/prop_*.png`

```text
Using the EXACT pastel cute anime art style and color palette from the ATTACHED REFERENCE IMAGE, generate a clean 2D game props and FX sheet on a transparent background PNG.

Layout: exactly 4 equal square cells in one horizontal row (1 row × 4 columns).

Items breakdown:
Cell 1 (prop_shadow): A clean, soft semi-transparent oval floor shadow seen from top-down 3/4 perspective, smooth soft gradient edge.
Cell 2 (prop_pillow): A small, soft cozy pastel sleeping pillow with subtle creases.
Cell 3 (fx_heart): A cute floating anime heart icon with soft sparkle highlights.
Cell 4 (fx_question): A cute question mark "?" icon with a subtle exclamation mark sparkle.

Rules:
- 100% transparent background (true alpha).
- No characters, no background scenes, no solid boxes.
```
