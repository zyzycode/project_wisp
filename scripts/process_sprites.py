#!/usr/bin/env python3
"""
Project Wisp — Multi-Category Sprite & Face Overlay Processor
=============================================================
Пайплайн нарезки, масштабирования и центрирования спрайтов тела и эмоций (лиц):
1. Интеграция с public/assets/sprites/manifest.json:
   - В первую очередь читает manifest.json как источник истины для маппинга
     файлов sourceFile -> категория (category), префикс (key) и папка назначения.
   - Если файл уже прописан в manifest.json, скрипт строго следует манифесту.
   - Поддержка префиксов: `body_<name>`, `face_<name>`, `prop_<name>`, `pupils_<name>` автоматически
     раскладываются по соответствующим папкам (`body/<name>`, `faces/<name>`, `props/<name>`, `faces/pupils/`).
2. Тело (body/*):
   - Объектная нарезка (Connected Component Object Islands) — 100% сохранение волос, рук, ног.
   - Масштабирование по эталонному росту (Target Body Height = 390px).
   - Выравнивание стоп по baseline (Y = 460) и центрирование торса по X (256).
3. Эмоции / Лица (faces/*):
   - Строгая геометрическая нарезка по пиксельным ячейкам (1x4, 2x4 и т.д.):
     поскольку черты лица (глаза, брови, рот, румянец) не связаны между собой физически,
     нарезка идет строго по равномерной сетке пикселей листа.
   - Пропорциональное масштабирование (TARGET_FACE_WIDTH = 115, макс высота = 90px)
     и точное позиционирование на голове персонажа: центр X = 256, центр Y = 180.
4. Предметы (props/*):
   - Центрирование объектов и FX-слоев.
5. Автообновление manifest.json и очистка устаревших кадров.
"""

import os
import sys
import glob
import json
import re
import hashlib

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENV_PYTHON = os.path.join(ROOT_DIR, ".venv", "bin", "python")

def ensure_proper_python_environment():
    try:
        import scipy.ndimage
        import numpy
        from PIL import Image
    except ImportError:
        if os.path.exists(VENV_PYTHON) and sys.executable != VENV_PYTHON:
            print(f"🔄 Переключение на виртуальное окружение: {VENV_PYTHON}")
            os.execv(VENV_PYTHON, [VENV_PYTHON] + sys.argv)
        elif sys.executable != "/usr/bin/python3.13" and os.path.exists("/usr/bin/python3.13"):
            print("🔄 Переключение на Python 3.13...")
            os.execv("/usr/bin/python3.13", ["/usr/bin/python3.13"] + sys.argv)

ensure_proper_python_environment()

import numpy as np
import scipy.ndimage as ndi
from PIL import Image

try:
    RESAMPLE_FILTER = Image.Resampling.LANCZOS
except AttributeError:
    RESAMPLE_FILTER = Image.LANCZOS

CATEGORY_RULES = [
    # --- Эмоции / Оверлеи лиц и зрачков (Faces & Pupils) ---
    (["зрач", "pupil", "pupils", "iris"], "faces/pupils", "pupils_normal", (1, 4)),
    (["морга", "blink"], "faces/blink", "face_blink", (1, 4)),
    (["взгляд", "look", "gaze", "directional"], "faces/gaze", "face_gaze", (1, 4)),
    (["подмиг", "winking", "wink"], "faces/winking", "face_winking", (1, 4)),
    (["наду", "обид", "pout", "grumpy_face"], "faces/pout", "face_pout", (1, 4)),
    (["головокруж", "спирал", "dizzy"], "faces/dizzy", "face_dizzy", (1, 4)),
    (["любопыт", "интерес", "curious"], "faces/curious", "face_curious", (1, 4)),
    (["ухмыл", "smug", "smirk", "хитр"], "faces/smug", "face_smug", (1, 4)),
    (["слез", "плач", "cry", "crying", "tears"], "faces/crying", "face_crying", (1, 4)),
    (["злост", "злой", "сердит", "ярост", "гнев", "angry", "rage", "mad"], "faces/angry", "face_angry", (1, 4)),
    (["счаст", "радост_лиц", "happy", "joy", "smile", "улыбк"], "faces/happy", "face_happy", (1, 4)),
    (["груст", "печал", "расстро", "sad", "distress"], "faces/sad", "face_sad", (1, 4)),
    (["удивл", "шок", "испуг_лиц", "shock", "shocked", "surpris", "gasp", "panic"], "faces/shocked", "face_shocked", (1, 4)),
    (["разговор", "речь", "говорит", "рот", "talk", "talking", "lipsync", "lip_sync", "speak"], "faces/talking", "face_talking", (1, 4)),
    (["озадачен", "сомнен", "растерян", "думает_лиц", "confus", "skeptic", "puzzl", "curious_face"], "faces/thinking", "face_thinking", (1, 4)),
    (["зевот", "дремот", "сон_лиц", "сонн", "drowsy", "yawn", "sleepy", "slumber"], "faces/sleep", "face_sleep", (1, 4)),
    (["смущен", "румян", "красне", "стыд", "хорни", "blush", "flirt", "seduce", "erotic"], "faces/flirty", "face_flirty", (1, 4)),
    (["нейтрал", "спокойн_лиц", "neutral", "calm_face", "base_face"], "faces/neutral", "face_neutral", (1, 4)),
    (["лиц", "эмоци", "face", "expression", "eyes"], "faces/base", "face", (1, 4)),

    # --- Анимации тела (Body) ---
    (["стена", "лаза", "полз", "climb", "wall_climb"], "body/climb_wall", "body_climb_wall", (1, 4)),
    (["потолок", "вис", "ceiling", "hang", "ceiling_hang"], "body/ceiling_hang", "body_ceiling_hang", (1, 4)),
    (["сидит", "сидеть", "посадка_тело", "sit", "sitting"], "body/sit", "body_sit", (1, 4)),
    (["встает", "встать", "подъем", "stand_up", "standup", "rise"], "body/stand_up", "body_stand_up", (1, 4)),
    (["лежит", "лежать", "отдых", "lie", "lying"], "body/lie", "body_lie", (1, 4)),
    (["шлепок", "расплющ", "падение_пол", "splat", "crash", "crash_splat"], "body/crash_splat", "body_crash_splat", (1, 4)),
    (["отряхив", "встает_после_падения", "recover", "dust_off"], "body/recover", "body_recover", (1, 4)),
    (["машет", "маха", "привет", "рука_машет", "wave", "waving", "hello", "hi"], "body/wave", "body_wave", (1, 4)),
    (["побед", "ура", "праздн", "радост_прыж", "celebrate", "celebration", "cheer", "victory", "win"], "body/celebrate", "body_celebrate", (1, 4)),
    (["испуг", "страх", "боит", "паник_тело", "scared", "afraid", "fear", "tremble"], "body/scared", "body_scared", (1, 4)),
    (["скук", "скуч", "тоск", "зева", "bored", "boring", "idle_bored", "tedious"], "body/bored", "body_bored", (1, 4)),
    (["укладыва", "готов_спать", "sleep_trans", "bed", "ложит"], "body/sleep_transition", "body_sleep_trans", (1, 4)),
    (["спит", "сон", "засып", "sleep", "zzz", "nap"], "body/sleep", "body_sleep", (1, 4)),
    (["ходьб", "шаг", "walk", "step"], "body/walk", "body_walk", (1, 4)),
    (["бег", "бежит", "run", "running", "sprint"], "body/run", "body_run", (1, 4)),
    (["прыжок", "прыг", "jump", "hop", "bounce"], "body/jump", "body_jump", (1, 4)),
    (["падение", "падает", "летит_вниз", "fall", "falling", "drop"], "body/fall", "body_fall", (1, 4)),
    (["перетаск", "курсор", "тащ", "подхват", "перенос", "хват", "взят", "тян", "drag", "pick", "dangle", "carry", "grab", "hold"], "body/dragged", "body_dragged", (1, 4)),
    (["приземлен", "посадк", "land", "landing"], "body/land", "body_land", (1, 4)),
    (["думает", "дума", "отвеча", "размышл", "think", "ponder"], "body/thinking", "body_thinking", (1, 4)),
    (["радост", "поглаж", "клик", "ласк", "тиск", "глад", "pet", "love", "heart", "click", "pat"], "body/petting", "body_petting", (1, 4)),
    (["стояни", "поко", "дыхан", "idle", "rest", "stand", "breath"], "body/idle", "body_idle", (1, 4)),

    # --- Предметы и FX (Props) ---
    (["предмет", "вещ", "prop", "pillow", "shadow", "подушк", "тень", "heart_fx", "эффект", "emote", "icon"], "props", "prop", (1, 4)),
]

TARGET_CANVAS_SIZE = 512
TARGET_BASELINE_Y = 460
TARGET_BODY_HEIGHT = 390  # Эталонная высота стоящего персонажа в холсте 512x512

# Параметры лица на холсте 512x512 (аккуратный масштаб под пропорции головы)
TARGET_FACE_WIDTH = 115
TARGET_FACE_MAX_HEIGHT = 90
TARGET_FACE_CENTER_X = 256
TARGET_FACE_CENTER_Y = 180  # Смещено чуть ниже под уровень глаз/рта

def get_file_hash(filepath: str) -> str:
    hasher = hashlib.md5()
    with open(filepath, "rb") as f:
        hasher.update(f.read())
    return hasher.hexdigest()

def parse_filename_grid_hint(filename: str):
    base = os.path.splitext(filename)[0].lower()
    m = re.search(r'(\d+)\s*[xX*]\s*(\d+)', base)
    if m:
        r, c = int(m.group(1)), int(m.group(2))
        if 1 <= r <= 8 and 1 <= c <= 12 and r * c <= 36:
            return (r, c)
            
    m_f = re.search(r'(\d+)\s*(?:frames?|кадр|f\b|_f)', base)
    if m_f:
        total = int(m_f.group(1))
        grid_map = {
            24: (3, 8), 18: (3, 6), 16: (4, 4), 12: (3, 4),
            8: (2, 4), 6: (2, 3), 4: (1, 4), 1: (1, 1)
        }
        if total in grid_map:
            return grid_map[total]
            
    return None

def detect_grid_dimensions(img: Image.Image, default_grid=(1, 4), filename: str = None, is_face_overlay: bool = False) -> tuple:
    if filename:
        hint = parse_filename_grid_hint(filename)
        if hint:
            return hint

    if is_face_overlay:
        return default_grid

    w, h = img.size
    aspect = w / h

    if default_grid == (1, 1) and 0.8 <= aspect <= 1.25:
        return (1, 1)

    if aspect >= 1.6 and default_grid == (1, 4):
        arr = np.array(img.convert("RGBA"))
        alpha = arr[:, :, 3] if arr.shape[2] == 4 else np.full((h, w), 255, dtype=np.uint8)
        row_density = (alpha > 25).sum(axis=1).astype(float)
        max_rd = max(1.0, float(np.max(row_density)))\
        mid_y = h // 2
        win_y = max(4, int(h * 0.08))
        v_mid = float(np.min(row_density[mid_y - win_y : mid_y + win_y])) / max_rd
        if v_mid < 0.12:
            return (2, 4)
        return (1, 4)

    arr = np.array(img.convert("RGBA"))
    alpha = arr[:, :, 3] if arr.shape[2] == 4 else np.full((h, w), 255, dtype=np.uint8)
    alpha = np.where(alpha < 20, 0, alpha)

    if (alpha > 25).sum() < 500:
        return default_grid

    candidates = [
        (1, 1),
        (1, 4), (1, 6), (1, 8),
        (2, 2), (2, 3), (2, 4), (2, 6), (2, 8),
        (3, 3), (3, 4), (3, 6), (3, 8),
        (4, 4), (4, 6),
        (6, 4)
    ]

    best_score = -1e9
    best_grid = default_grid

    for r, c in candidates:
        if r * c > 32:
            continue
        row_h = h / r
        col_w = w / c
        cell_aspect = col_w / row_h

        # 1. Проверка строк
        if r > 1:
            row_density = (alpha > 25).sum(axis=1).astype(float)
            max_rd = max(1.0, float(np.max(row_density)))
            row_valleys = []
            win_y = max(4, int(row_h * 0.12))
            for k in range(1, r):
                nom_y = int(k * row_h)
                y1 = max(0, nom_y - win_y)
                y2 = min(h, nom_y + win_y)
                v = float(np.min(row_density[y1:y2])) / max_rd
                row_valleys.append(v)
            max_row_v = max(row_valleys)
            avg_row_v = float(np.mean(row_valleys))
            if max_row_v > 0.18:
                continue
            row_score = 1.0 - avg_row_v
        else:
            row_score = 0.5

        # 2. Проверка колонок
        if c > 1:
            col_density = (alpha > 25).sum(axis=0).astype(float)
            max_cd = max(1.0, float(np.max(col_density)))
            col_valleys = []
            win_x = max(4, int(col_w * 0.12))
            for k in range(1, c):
                nom_x = int(k * col_w)
                x1 = max(0, nom_x - win_x)
                x2 = min(w, nom_x + win_x)
                v = float(np.min(col_density[x1:x2])) / max_cd
                col_valleys.append(v)
            max_col_v = max(col_valleys)
            avg_col_v = float(np.mean(col_valleys))
            if max_col_v > 0.18:
                continue
            col_score = 1.0 - avg_col_v
        else:
            col_score = 0.5

        # 3. Пропорции
        if 0.60 <= cell_aspect <= 1.25:
            aspect_score = 1.5
        elif 0.40 <= cell_aspect <= 1.6:
            aspect_score = 0.5
        else:
            aspect_score = -1.0

        total_score = (row_score * 4.0) + (col_score * 4.0) + aspect_score + (r * c * 0.05)

        if total_score > best_score:
            best_score = total_score
            best_grid = (r, c)

    return best_grid

def get_target_info(filename: str, manifest: dict = None) -> tuple:
    clean_name = os.path.splitext(filename)[0].strip().lower()

    # 1. Приоритет: явные правила категорий (перевод ключевых слов в канонические пути)
    for keywords, subfolder, prefix, grid in CATEGORY_RULES:
        if any(kw in clean_name for kw in keywords):
            return subfolder, prefix, grid

    # 2. Поиск в manifest.json
    if manifest and isinstance(manifest, dict):
        for key, val in manifest.items():
            if isinstance(val, dict):
                src = val.get("sourceFile", "")
                if src and (src.lower() == filename.lower() or os.path.splitext(src)[0].lower() == clean_name):
                    category = val.get("category", "")
                    prefix = key
                    count = val.get("framesCount", 4)
                    grid = (1, count)
                    return category, prefix, grid

        if clean_name in manifest:
            val = manifest[clean_name]
            if isinstance(val, dict):
                category = val.get("category", f"custom/{clean_name}")
                count = val.get("framesCount", 4)
                return category, clean_name, (1, count)

    # 3. Прямые префиксы стандартных слоев (если не совпало по ключевым словам)
    m_body = re.match(r'^body[_\-\s]+(.+)$', clean_name)
    if m_body:
        action = m_body.group(1).strip(" _-")
        return f"body/{action}", f"body_{action}", (1, 4)

    m_face = re.match(r'^face[_\-\s]+(.+)$', clean_name)
    if m_face:
        emotion = m_face.group(1).strip(" _-")
        return f"faces/{emotion}", f"face_{emotion}", (1, 4)

    m_pupils = re.match(r'^pupils?[_\-\s]+(.+)$', clean_name)
    if m_pupils:
        sub = m_pupils.group(1).strip(" _-")
        return "faces/pupils", f"pupils_{sub}", (1, 4)

    m_prop = re.match(r'^prop[_\-\s]+(.+)$', clean_name)
    if m_prop:
        prop_name = m_prop.group(1).strip(" _-")
        return f"props/{prop_name}", f"prop_{prop_name}", (1, 1)

    safe_name = "".join(c if c.isalnum() or c in "_-" else "_" for c in clean_name)
    return f"custom/{safe_name}", safe_name, (1, 4)

def extract_frames_from_sheet(full_rgba: Image.Image, rows: int, cols: int, is_face_overlay: bool = False) -> list:
    w, h = full_rgba.size
    if rows == 1 and cols == 1:
        return [full_rgba]

    arr = np.array(full_rgba.convert("RGBA"))
    alpha = arr[:, :, 3] if arr.shape[2] == 4 else np.full((h, w), 255, dtype=np.uint8)
    clean_a = np.where(alpha < 15, 0, alpha)

    total_expected = rows * cols

    # Для лиц нарезаем СТРОГО по равномерным пиксельным ячейкам (поскольку брови/глаза/рот разделены)
    if is_face_overlay:
        col_w = w / cols
        row_h = h / rows
        frames = []
        for r in range(rows):
            for c in range(cols):
                x1 = int(c * col_w)
                x2 = int((c + 1) * col_w)
                y1 = int(r * row_h)
                y2 = int((r + 1) * row_h)
                cell_arr = arr[y1:y2, x1:x2].copy()
                cell_arr[:, :, 3] = np.where(cell_arr[:, :, 3] < 15, 0, cell_arr[:, :, 3])
                frames.append(Image.fromarray(cell_arr))
        return frames

    # Для тела: связные компоненты
    labeled, num_features = ndi.label(clean_a > 0)
    comp_sizes = [(i, (labeled == i).sum()) for i in range(1, num_features + 1)]
    comp_sizes.sort(key=lambda x: x[1], reverse=True)

    major_comps = [c for c in comp_sizes if c[1] > 1500]

    if len(major_comps) >= total_expected and total_expected > 0:
        comps = []
        for comp_id, size in major_comps[:total_expected]:
            mask = (labeled == comp_id)
            y_idx, x_idx = np.where(mask)
            comps.append({
                "id": comp_id,
                "mask": mask,
                "cx": float(np.mean(x_idx)),
                "cy": float(np.mean(y_idx)),
            })

        row_h = h / rows
        for c in comps:
            c["row"] = min(rows - 1, max(0, int(c["cy"] / row_h)))

        comps.sort(key=lambda c: (c["row"], c["cx"]))

        marker_map = np.zeros((h, w), dtype=int)
        for idx, comp in enumerate(comps, 1):
            marker_map[comp["mask"]] = idx

        _, indices = ndi.distance_transform_edt(marker_map == 0, return_indices=True)
        nearest_comp = marker_map[indices[0], indices[1]]

        frames = []
        for idx, comp in enumerate(comps, 1):
            char_mask = (nearest_comp == idx) & (clean_a > 0)
            y_idx, x_idx = np.where(char_mask)
            if len(y_idx) > 0:
                x1, x2 = x_idx.min(), x_idx.max()
                y1, y2 = y_idx.min(), y_idx.max()
                char_arr = np.zeros((y2 - y1 + 1, x2 - x1 + 1, 4), dtype=np.uint8)
                sub_arr = arr[y1:y2 + 1, x1:x2 + 1]
                sub_mask = char_mask[y1:y2 + 1, x1:x2 + 1]
                char_arr[:, :, :3] = sub_arr[:, :, :3]
                char_arr[:, :, 3] = np.where(sub_mask, sub_arr[:, :, 3], 0)
                frames.append(Image.fromarray(char_arr))
        return frames

    else:
        # Fallback: разделение по долинам
        col_density = (clean_a > 0).sum(axis=0)
        row_density = (clean_a > 0).sum(axis=1)

        def find_valleys(density, count, total_len):
            step = total_len / count
            cuts = [0]
            for k in range(1, count):
                nom = int(k * step)
                win = max(4, int(step * 0.15))
                p1, p2 = max(0, nom - win), min(total_len, nom + win)
                sub = density[p1:p2]
                cuts.append(p1 + int(np.argmin(sub)) if len(sub) > 0 else nom)
            cuts.append(total_len)
            return cuts

        x_cuts = find_valleys(col_density, cols, w)
        y_cuts = find_valleys(row_density, rows, h)

        frames = []
        for r in range(rows):
            for c in range(cols):
                y1, y2 = y_cuts[r], y_cuts[r + 1]
                x1, x2 = x_cuts[c], x_cuts[c + 1]
                cell = arr[y1:y2, x1:x2].copy()
                cell_a = np.where(cell[:, :, 3] < 15, 0, cell[:, :, 3])
                cell[:, :, 3] = cell_a
                cell_img = Image.fromarray(cell)
                bbox = cell_img.getbbox()
                if bbox:
                    frames.append(cell_img.crop(bbox))
        return frames

def calculate_character_anchor(cropped_img: Image.Image) -> float:
    arr = np.array(cropped_img)
    if arr.shape[2] < 4:
        return float(cropped_img.size[0] / 2.0)

    alpha = arr[:, :, 3]
    h, w = alpha.shape

    y_min = int(h * 0.15)
    y_max = int(h * 0.75)
    core_alpha = alpha[y_min:y_max, :]

    weights = (core_alpha.astype(float) / 255.0) ** 2
    if np.sum(weights) > 50:
        y_indices, x_indices = np.where(core_alpha > 50)
        if len(x_indices) > 0:
            core_weights = weights[y_indices, x_indices]
            if np.sum(core_weights) > 0:
                return float(np.average(x_indices, weights=core_weights))

    return float(w / 2.0)

def get_reference_scale(current_frames: list, category: str) -> float:
    max_h = 1
    for frame in current_frames:
        bbox = frame.getbbox()
        if bbox:
            max_h = max(max_h, bbox[3] - bbox[1])

    desired_h = TARGET_BODY_HEIGHT if "body" in category else 420
    scale = desired_h / max(max_h, 1)
    return scale

def crop_and_center_to_512(frame_img: Image.Image,
                           target_size: int = TARGET_CANVAS_SIZE,
                           category: str = "body",
                           baseline_y: int = TARGET_BASELINE_Y,
                           scale: float = None) -> Image.Image:
    w, h = frame_img.size
    canvas = Image.new("RGBA", (target_size, target_size), (0, 0, 0, 0))

    if "faces" in category:
        bbox = frame_img.getbbox()
        if not bbox:
            return canvas
        cropped = frame_img.crop(bbox)
        cw, ch = cropped.size

        # Целевая ширина черт лица под голову персонажа (115px, макс высота 90px)
        fit_scale = TARGET_FACE_WIDTH / max(cw, 1)
        if (ch * fit_scale) > TARGET_FACE_MAX_HEIGHT:
            fit_scale = min(fit_scale, TARGET_FACE_MAX_HEIGHT / max(ch, 1))

        new_w = max(1, int(round(cw * fit_scale)))
        new_h = max(1, int(round(ch * fit_scale)))
        resized = cropped.resize((new_w, new_h), RESAMPLE_FILTER)

        # Размещение черт лица строго в координатах головы на холсте 512x512
        pos_x = TARGET_FACE_CENTER_X - (new_w // 2)
        pos_y = TARGET_FACE_CENTER_Y - (new_h // 2)
        canvas.paste(resized, (pos_x, pos_y), resized)
        return canvas

    elif "props" in category:
        bbox = frame_img.getbbox()
        if not bbox:
            return canvas
        cropped = frame_img.crop(bbox)
        cw, ch = cropped.size
        fit_scale = min((target_size - 40) / cw, (target_size - 40) / ch)
        new_w = max(1, int(cw * fit_scale))
        new_h = max(1, int(ch * fit_scale))
        resized = cropped.resize((new_w, new_h), RESAMPLE_FILTER)
        pos_x = (target_size - new_w) // 2
        pos_y = (target_size - new_h) // 2
        canvas.paste(resized, (pos_x, pos_y), resized)
        return canvas

    else:
        bbox = frame_img.getbbox()
        if not bbox:
            return canvas

        cropped = frame_img.crop(bbox)
        cw, ch = cropped.size

        if scale is None:
            desired_h = TARGET_BODY_HEIGHT
            scale = desired_h / max(ch, 1)

        new_w = max(1, int(cw * scale))
        new_h = max(1, int(ch * scale))

        if new_w > (target_size - 32):
            scale_w = (target_size - 32) / new_w
            new_w = int(new_w * scale_w)
            new_h = int(new_h * scale_w)

        if new_h > (target_size - 32):
            scale_h = (target_size - 32) / new_h
            new_w = int(new_w * scale_h)
            new_h = int(new_h * scale_h)

        resized = cropped.resize((new_w, new_h), RESAMPLE_FILTER)

        torso_anchor_x = calculate_character_anchor(cropped) * (new_w / max(cw, 1))
        target_center_x = target_size // 2
        pos_x = int(target_center_x - torso_anchor_x)
        pos_x = max(8, min(target_size - new_w - 8, pos_x))

        pos_y = baseline_y - new_h
        if pos_y < 8:
            pos_y = 8
        elif pos_y > target_size - new_h - 8:
            pos_y = target_size - new_h - 8

        canvas.paste(resized, (pos_x, pos_y), resized)
        return canvas

def process_single_image(image_path: str, output_base: str, manifest: dict):
    filename = os.path.basename(image_path)
    
    if filename.lower().startswith(("no_image", "ref.", "reference.")):
        print(f"⏩ Пропуск служебного файла: {filename}")
        return

    target_subfolder, target_prefix, expected_grid = get_target_info(filename, manifest)
    is_face = "faces" in target_subfolder

    out_dir = os.path.join(output_base, target_subfolder)
    os.makedirs(out_dir, exist_ok=True)

    for old_f in glob.glob(os.path.join(out_dir, f"{target_prefix}_*.png")):
        try:
            os.remove(old_f)
        except OSError:
            pass

    img = Image.open(image_path).convert("RGBA")
    arr = np.array(img)
    if arr.shape[2] == 4:
        arr[:, :, 3] = np.where(arr[:, :, 3] < 15, 0, arr[:, :, 3])
        img = Image.fromarray(arr)

    rows, cols = detect_grid_dimensions(img, expected_grid, filename, is_face_overlay=is_face)
    width, height = img.size

    print(f"📦 [{filename}] -> нарезка PNG ({width}x{height}), сетка: {rows}x{cols} ({rows*cols} кадров) -> {target_subfolder}/{target_prefix} (согласно manifest.json)...")

    raw_frames = extract_frames_from_sheet(img, rows, cols, is_face_overlay=is_face)

    sheet_scale = get_reference_scale(raw_frames, target_subfolder) if not is_face else 1.0
    if not is_face:
        print(f"    📐 Масштаб: scale={sheet_scale:.4f} (базовая высота: {TARGET_BODY_HEIGHT}px), извлечено кадров: {len(raw_frames)}")

    generated_frames = []

    for frame_idx, cell in enumerate(raw_frames):
        final_frame = crop_and_center_to_512(cell,
                                            target_size=TARGET_CANVAS_SIZE,
                                            category=target_subfolder,
                                            baseline_y=TARGET_BASELINE_Y,
                                            scale=sheet_scale)

        frame_filename = f"{target_prefix}_{frame_idx:02d}.png"
        frame_path = os.path.join(out_dir, frame_filename)
        final_frame.save(frame_path, "PNG")

        rel_url = f"/assets/sprites/{target_subfolder}/{frame_filename}"
        generated_frames.append(rel_url)
        print(f"   ✓ Кадр {frame_idx+1:02d}/{len(raw_frames):02d} -> {target_subfolder}/{frame_filename}")

    manifest[target_prefix] = {
        "category": target_subfolder,
        "framesCount": len(generated_frames),
        "frames": generated_frames,
        "sourceFile": filename
    }

def main(force_all=False):
    root_dir = ROOT_DIR
    input_dir = os.path.join(root_dir, "generated_images")
    output_base = os.path.join(root_dir, "public", "assets", "sprites")
    cache_file = os.path.join(root_dir, "scripts", ".sprites_cache.json")
    manifest_file = os.path.join(output_base, "manifest.json")

    os.makedirs(input_dir, exist_ok=True)
    os.makedirs(output_base, exist_ok=True)

    cache = {}
    if os.path.exists(cache_file) and not force_all:
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                cache = json.load(f)
        except Exception:
            cache = {}

    manifest = {}
    if os.path.exists(manifest_file):
        try:
            with open(manifest_file, "r", encoding="utf-8") as f:
                manifest = json.load(f)
                print(f"📖 Загружен манифест ({manifest_file}) с {len(manifest)} записями.")
        except Exception as e:
            print(f"⚠️ Ошибка чтения {manifest_file}: {e}, создается новый манифест.")
            manifest = {}

    valid_exts = (".png", ".webp")
    all_files = [f for f in glob.glob(os.path.join(input_dir, "*")) if os.path.isfile(f) and f.lower().endswith(valid_exts)]
    all_files = [f for f in all_files if not os.path.basename(f).lower().startswith(("no_image", "ref.", "reference."))]

    if not all_files:
        print(f"ℹ️ В папке {input_dir} пока нет PNG файлов. Поместите прозрачные PNG спрайт-листы в generated_images/")
        return

    print(f"🚀 Проверка PNG файлов в generated_images/ (Всего: {len(all_files)})...")
    if force_all:
        print("⚡ Включен режим принудительной перезаписи (--force)!")

    processed_count = 0
    for fpath in all_files:
        fname = os.path.basename(fpath)
        current_hash = get_file_hash(fpath)

        if cache.get(fname) == current_hash and not force_all:
            continue

        process_single_image(fpath, output_base, manifest)
        cache[fname] = current_hash
        processed_count += 1

    current_prefixes = {get_target_info(os.path.basename(f), manifest)[1] for f in all_files}
    manifest = {k: v for k, v in manifest.items() if k in current_prefixes or os.path.exists(os.path.join(output_base, v.get("category", ""), f"{k}_00.png"))}

    with open(cache_file, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)

    with open(manifest_file, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    if processed_count > 0:
        print(f"\n🎉 Успешно нарезано и отцентрировано: {processed_count} PNG листов (Lanczos 512x512)!")
        print(f"📄 Манифест: {manifest_file}")
    else:
        print("✨ Все файлы уже актуальны. Используйте --force для принудительной перегенерации.")

if __name__ == "__main__":
    force = "--force" in sys.argv or "-f" in sys.argv
    main(force_all=force)
