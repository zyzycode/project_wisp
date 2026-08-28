# 🪄 Полный сборник 4-кадровых (Keyframe Optimized) промптов для ChatGPT / GPT-4o по Референсу на Прозрачном PNG

> **Цель:** Генерация четких, геометрически стабильных **4-кадровых спрайт-листов (Keyframes)** персонажа Wisp в **горизонтальной сетке 1 строка × 4 колонки (1×4 horizontal grid)** по **прикреплённому референсу (Attached Reference Image)** сразу в формате **PNG с прозрачным фоном (Transparent PNG with Alpha Channel)**.
> 
> *Сетка 1×4 из 4 ключевых кадров минимизирует «кипение» нейросети, идеально сохраняет пропорции персонажа и точно соответствует структуре проекта [ARTIST_BRIEF.md](file:///home/zybz/code/project_wisp/docs/ARTIST_BRIEF.md).*

---

## 📌 Инструкция для генерации в ChatGPT / GPT-4o / Midjourney / DALL-E:

1. **Прикрепи референс:** Обязательно прикрепи изображение персонажа перед отправкой промпта.
2. **Формат сетки:** Сетка строго **1 горизонтальный ряд из 4 равных квадратных кадров (1 row × 4 columns grid = 4 frames total)**, чтение слева направо (`00`, `01`, `02`, `03`).
3. **Единый масштаб и привязка (Pivot & Baseline):**
   * Персонаж занимает одинаковую высоту во всех 4 кадрах (высота тела ~400px в квадратной ячейке).
   * Стопы на всех кадрах стоят на единой горизонтальной линии пола (Baseline).
   * Персонаж строго отцентрован по горизонтали в каждой из 4 ячеек.
4. **Фон:** **100% прозрачный PNG (`.png` true alpha channel, zero background color, no shadows)**.

---

## 📋 Промпты для генерации анимаций (4 ключевых кадра, сетка 1×4)

---

### 🚶 1. Ходьба влево: 4 ключевых кадра (4-Frame Walk Cycle — сетка 1×4) ⭐
*Файлы: `body/walk/body_walk_00.png` — `body_walk_03.png`*

> `Using the EXACT character design, hair style, facial features, body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a 2D side-scrolling video game sprite sheet as a PNG with a 100% completely transparent background (true alpha channel, zero background color, no floor shadows, no white box).`
>
> `LAYOUT & GRID:`
> `Generate a clean horizontal sprite sheet with exactly 4 equal-sized square frames in a single row (1 row × 4 columns grid, 4 frames total, read left-to-right: Frame 1, Frame 2, Frame 3, Frame 4).`
>
> `CHARACTER ANCHOR & SCALE:`
> `- Full side-view profile (character completely turned to the left, walking towards the left).`
> `- Character must maintain identical height, scale, and body thickness across all 4 frames.`
> `- Feet must stay aligned to the exact same horizontal floor baseline across all frames.`
> `- Character stays perfectly centered horizontally in each of the 4 grid cells.`
>
> `4 KEYFRAME WALK CYCLE (LEFT-TO-RIGHT):`
> `- Frame 1 (Contact A - Right Leg Forward): Right foot makes forward contact with the floor, left foot pushes off behind, left arm forward, right arm back.`
> `- Frame 2 (Passing Position A): Body lifts slightly as left leg swings forward through the center past the planted right leg, arms pass near body.`
> `- Frame 3 (Contact B - Left Leg Forward): Left foot contacts the floor forward, right foot trailing behind, right arm forward, left arm back.`
> `- Frame 4 (Passing Position B): Body lifts as right leg swings forward through the center past the planted left leg, looping seamlessly back into Frame 1.`
>
> `SECONDARY MOTION: Wavy hair and dress hem flow backward with gentle inertial drag. High quality 2D game asset, sharp clean lines, true transparent PNG.`

---

### 🧍 2. Дыхание и живой покой (4-Frame Idle & Micro-Breathing Loop — сетка 1×4) ⭐
*Файлы: `body/idle/body_idle_00.png` — `body_idle_03.png`*

> `Using the EXACT character design, hair style, facial features, body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a 2D video game sprite sheet as a PNG with a 100% completely transparent background (true alpha channel, transparent cutout, zero background color, no backdrop).`
>
> `LAYOUT & GRID:`
> `Generate a clean horizontal sprite sheet with exactly 4 equal-sized square frames in a single row (1 row × 4 columns grid, 4 frames total, read left-to-right: Frame 1 to 4).`
>
> `CRITICAL ANCHOR & STABILITY:`
> `- Both feet MUST remain completely flat and anchored to the exact same floor line across all 4 frames.`
> `- Character stays perfectly centered horizontally in each cell with unchanged body height and proportions.`
>
> `4 KEYFRAME IDLE LOOP (LEFT-TO-RIGHT):`
> `- Frame 1 [Base Pose]: Neutral standing pose, straight posture, calm open eyes with a warm gentle expression, hair resting naturally.`
> `- Frame 2 [Inhale Start]: Chest gently expands and shoulders subtly rise by 3-4 pixels, posture straightens slightly.`
> `- Frame 3 [Peak Inhale & Float]: Peak of breath, lungs expanded, long wavy hair softly floats outward on a gentle magical updraft.`
> `- Frame 4 [Exhale / Reset]: Chest and shoulders gently descend back down, hair smoothly settles, resetting into Frame 1 for a seamless infinite loop.`
>
> `100% character identity match with reference. Clean 2D game asset, true transparent PNG with alpha transparency, no background shadows.`

---

### 🖱️ 3. Подхват курсором / Болтание в воздухе (4-Frame Dragged & Flailing Loop — сетка 1×4) ⭐
*Файлы: `body/dragged/body_dragged_00.png` — `body_dragged_03.png` (или `00`–`01`)*

> `Using the EXACT character design, hair style, facial features, body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a 2D video game sprite sheet as a PNG with a 100% completely transparent background (true alpha channel, zero background color).`
>
> `LAYOUT & GRID:`
> `Generate a clean horizontal sprite sheet with exactly 4 equal-sized square frames in a single row (1 row × 4 columns grid, 4 frames total, read left-to-right). The character is lifted into mid-air by the player's mouse cursor as if held by the scruff/collar:`
>
> `4 KEYFRAME DANGLING CYCLE (LEFT-TO-RIGHT):`
> `- Frame 1 [Lifted & Surprised]: Character lifted up off the floor, wide surprised eyes (O_O), legs hanging down limp, arms reaching up.`
> `- Frame 2 [Mid-Air Kick Left]: Kicks left leg forward in mid-air panic, right leg back, arms flailing outward for balance.`
> `- Frame 3 [Mid-Air Kick Right]: Kicks right leg forward, left leg back, wavy hair swaying sideways with momentum.`
> `- Frame 4 [Cute Resigned Dangle]: Stops kicking, dangling cutely in mid-air with a resigned chibi pout, legs slightly bent, smoothly looping back to Frame 1.`
>
> `Character centered in each cell. True transparent PNG, isolated cutout with zero background, no shadows.`

---

### 🪂 4. Приземление и упругий контакт (4-Frame Landing & Squash-Stretch — сетка 1×4) ⭐
*Файлы: `body/land/body_land_00.png` — `body_land_03.png` (или `00`–`01`)*

> `Using the EXACT character design, hair style, facial features, body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a 2D video game sprite sheet as a PNG with a 100% completely transparent background (true alpha channel, zero background color).`
>
> `LAYOUT & GRID:`
> `Generate a 4-frame horizontal landing and impact sequence in a clean 1 row × 4 columns grid (4 frames total, read left-to-right):`
>
> `4 KEYFRAME LANDING PROGRESSION (LEFT-TO-RIGHT):`
> `- Frame 1 [Falling Anticipation]: Airborne just before landing, toes pointed downward towards floor, arms spread slightly, wavy hair trailing upward.`
> `- Frame 2 [Deep Squash Impact]: Feet hit the floor line, knees deeply bent in a low crouch absorbing impact, dress and wavy hair flare outward from downward kinetic energy.`
> `- Frame 3 [Spring Stretch Recoil]: Body springs upward pushing out of the crouch, spine stretched tall on tip-toes, hair trailing upward.`
> `- Frame 4 [Neutral Settle]: Smoothly settles flat-footed into standard proud standing pose with a confident smile, hair resting on shoulders.`
>
> `Floor contact line remains consistent on frames 2, 3, and 4. Clean 2D game asset, true transparent PNG with alpha transparency, zero shadows.`

---

### 🛌 5. Засыпание: Укладывание на подушку (4-Frame Sleep Transition — сетка 1×4) ⭐
*Файлы: `body/sleep/body_sleep_00.png` — `body_sleep_03.png`*

> `Using the EXACT character design, hair style, facial features, body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a 2D video game sprite sheet as a PNG with a 100% completely transparent background (true alpha channel, zero background color).`
>
> `LAYOUT & GRID:`
> `Generate a cinematic 4-frame storytelling sleep transition in a clean 1 row × 4 columns grid (4 frames total, read left-to-right):`
>
> `4 KEYFRAME SLEEP TRANSITION (LEFT-TO-RIGHT):`
> `- Frame 1 [Sleepy Yawn]: Character rubs sleepy eyes with one fist, mouth open in a cute drowsy yawn.`
> `- Frame 2 [Place Pillow]: Character kneels down and places a soft fluffy pastel pillow on the floor with both hands.`
> `- Frame 3 [Lowering Down]: Character lies down sideways, resting head softly onto the plush pillow, pulling legs in cozily.`
> `- Frame 4 [Deep Asleep]: Lying comfortably on side asleep on the pillow, eyes peacefully closed, long wavy hair spread across the floor.`
>
> `Identical outfit and character scaling throughout. High quality transparent PNG with true alpha channel, zero background.`

---

### 🌙 5b. Сон: Дыхание во сне (4-Frame Deep Sleep Breathing Loop — сетка 1×4) ⭐
*Файлы: `body/sleep/body_sleep_00.png` — `body_sleep_01.png`*

> `Using the EXACT character design, hair style, facial features, body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a 2D video game sprite sheet as a PNG with a 100% completely transparent background (true alpha channel, zero background color).`
>
> `LAYOUT & GRID:`
> `Generate a 4-frame sleeping breathing loop in a clean 1 row × 4 columns grid (4 frames total, read left-to-right). Character is lying sideways asleep on a fluffy pastel pillow, eyes peacefully closed, wavy hair pooled around:`
>
> `4 KEYFRAME SLEEP BREATHING LOOP (LEFT-TO-RIGHT):`
> `- Frame 1 [Resting Baseline]: Body fully relaxed asleep on pillow, chest neutral, tiny "Zzz" bubble appears above head.`
> `- Frame 2 [Gentle Inhale]: Chest softly expands upward by 3 pixels, "Zzz" bubble floats slightly higher.`
> `- Frame 3 [Peak Sleep Inhale]: Peak chest rise, serene peaceful facial expression.`
> `- Frame 4 [Gentle Exhale]: Chest gently sinks back down, "Zzz" bubble softly pops with micro-sparkles, seamlessly looping to Frame 1.`
>
> `Clean 2D game asset, true transparent PNG with alpha transparency, no solid background.`

---

### 💡 6. Размышление: Вопрос -> Озарение -> Готовность (4-Frame Thinking Sequence — сетка 1×4) ⭐
*Файлы: `body/thinking/body_thinking_00.png` — `body_thinking_01.png`*

> `Using the EXACT character design, hair style, facial features, body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a 2D video game sprite sheet as a PNG with a 100% completely transparent background (true alpha channel, zero background color).`
>
> `LAYOUT & GRID:`
> `Generate a 4-frame thinking and Eureka animation sequence in a clean 1 row × 4 columns grid (4 frames total, read left-to-right):`
>
> `4 KEYFRAME THINKING PROGRESSION (LEFT-TO-RIGHT):`
> `- Frame 1 [Curious Question]: Character tilts head curiously, index finger on chin, small glowing question mark (?) appears above head.`
> `- Frame 2 [Deep Thought]: Eyes look upward thoughtfully, finger tapping chin, question mark turns into a soft thinking cloud.`
> `- Frame 3 [Eureka / Idea Strike!]: Eyes widen with realization, glowing exclamation mark (!) pops above head, character snaps fingers with a bright smile.`
> `- Frame 4 [Ready to Answer]: Hands clasped in front of chest, nodding joyfully with a confident beaming smile, ready to answer.`
>
> `Feet remain firmly anchored to the baseline floor across all frames. True transparent PNG, alpha channel transparency, zero background.`

---

### 💖 7. Ласка / Реакция на поглаживание (4-Frame Petting & Love Reaction — сетка 1×4) ⭐
*Файлы: `props/fx_heart.png` + реакции персонажа*

> `Using the EXACT character design, hair style, facial features, body proportions, clothing, and color palette from the ATTACHED REFERENCE IMAGE, create a 2D video game sprite sheet as a PNG with a 100% completely transparent background (true alpha channel, zero background color).`
>
> `LAYOUT & GRID:`
> `Generate an ultra-cute 4-frame petting reaction in a clean 1 row × 4 columns grid (4 frames total, read left-to-right):`
>
> `4 KEYFRAME REACTION CYCLE (LEFT-TO-RIGHT):`
> `- Frame 1 [Blissful Lean]: Character tilts and leans head into the touch/cursor, eyes closed blissfully with a gentle smile.`
> `- Frame 2 [Blushing & Hearts]: Soft pink blush on cheeks, joyful curved eyes (^ _ ^), tiny glowing pink hearts float above head.`
> `- Frame 3 [Excited Hop]: Cute mini-hop into the air with joy, hands clapping near chest, wavy hair bouncing upward.`
> `- Frame 4 [Happy Settle]: Lands softly on feet, winking playfully with a beaming smile, settling back into idle.`
>
> `Clean 2D game asset, true transparent PNG with alpha transparency, no background shadows.`

---

### 🎭 8. Пак базовых эмоций лица (4 Key Facial Expressions — сетка 1×4) ⭐
*Файлы: `faces/face_neutral.png`, `faces/face_happy.png`, `faces/face_blink.png`, `faces/face_confused.png` (или `face_shocked.png`)*

> `Using the EXACT character face structure, hair style, bangs, eye color, and art style from the ATTACHED REFERENCE IMAGE, create a 2D game face sprite sheet as a PNG with a 100% completely transparent background (true alpha channel, zero background color).`
>
> `LAYOUT & GRID:`
> `Generate 4 distinct expressive close-up facial portraits in a clean 1 row × 4 columns grid (4 faces total, read left-to-right):`
>
> `4 KEY EXPRESSIONS (LEFT-TO-RIGHT):`
> `- Frame 1 [Neutral / Calm]: Open natural eyes, serene gentle mouth, neutral idle expression.`
> `- Frame 2 [Happy / Joy (^ _ ^)]: Joyful upward curved crescent eyes, radiant beaming open smile, soft pink blush on cheeks.`
> `- Frame 3 [Natural Blink]: Eyelids softly and fully closed, peaceful gentle resting mouth.`
> `- Frame 4 [Shocked / Surprised (O_O)]: Wide open circular eyes with tiny pupils, small open gasp 'O' mouth, raised eyebrows.`
>
> `Identical head angle and framing across all 4 cells. True transparent PNG, alpha transparency, no solid background.`
