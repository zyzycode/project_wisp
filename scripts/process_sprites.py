#!/usr/bin/env python3
"""
Project Wisp — Universal Object-Aware PNG Sprite Sheet Processor
========================================================================
Пайплайн нарезки, масштабирования по референсу и центрирования спрайтов:
1. Прямая работа с прозрачными PNG без повреждения спрайтов:
   - Полное сохранение всех видимых пикселей персонажей.
   - Исключена обрезка ног, причесок или рук при близком расположении кадров.
2. Сегментация персонажей по центроидам (Voronoi Distance Transform Segmentation):
   - Каждый спрайт извлекается как отдельный целостный объект без жестких прямолинейных разрезов.
3. Точное определение сетки (Strict Valley Grid Detection):
   - Автоматически находит реальную сетку: 2x4 (8), 4x4 (16), 3x8 (24), 4x6 (24) и др.
   - Поддерживает подсказки в имени файла (_24f, _16f, _3x8, _4x4 и т.д.).
4. Масштабирование по эталонному росту (Target Body Height = 390px) во всех анимациях.
5. Интеллектуальное центрирование и стабилизация анимации по оси торса с выравниванием по линии земли (Baseline Y = 460).
6. Автогенерация manifest.json.
"""

import os
import sys
import glob
import json
import re
import hashlib
from collections import deque

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
from PIL import Image, ImageFilter, ImageOps

try:
    RESAMPLE_FILTER = Image.Resampling.LANCZOS
except AttributeError:
    RESAMPLE_FILTER = Image.LANCZOS

CATEGORY_RULES = [
    (["ходьб", "walk", "run", "step"], "body/walk", "body_walk", (2, 4)),
    (["стояни", "поко", "дыхан", "idle", "rest", "stand"], "body/idle", "body_idle", (2, 4)),
    (["курсор", "drag", "pick", "dangle", "подхват"], "body/dragged", "body_dragged", (2, 4)),
    (["приземлен", "land", "fall", "пада"], "body/land", "body_land", (2, 4)),
    (["укладыва", "готов_спать", "sleep_trans", "bed"], "body/sleep_transition", "body_sleep_trans", (2, 4)),
    (["спит", "сон", "sleep", "zzz"], "body/sleep", "body_sleep", (2, 4)),
    (["дума", "отвеча", "think", "ponder"], "body/thinking", "body_thinking", (2, 4)),
    (["поглаж", "клик", "ласк", "pet", "love", "heart"], "body/petting", "body_petting", (2, 4)),
    (["хорни", "flirt", "seduce", "blush", "erotic", "смущен"], "faces/flirty", "face_flirty", (2, 4)),
    (["лиц", "эмоци", "face", "expression", "eyes"], "faces/base", "face", (2, 4)),
    (["предмет", "вещ", "prop", "pillow", "shadow"], "props", "prop", (1, 1)),
]

TARGET_CANVAS_SIZE = 512
TARGET_BASELINE_Y = 460
TARGET_BODY_HEIGHT = 390  # Эталонная высота стоящего персонажа в холсте 512x512

def get_file_hash(filepath: str) -> str:
    hasher = hashlib.md5()
    with open(filepath, "rb") as f:
        hasher.update(f.read())
    return hasher.hexdigest()

def parse_filename_grid_hint(filename: str):
    """
    Извлекает указания на размер сетки из имени файла:
    'dance_3x8.png' -> (3, 8)
    'walk_4x4.png' -> (4, 4)
    'attack_24f.png' -> (3, 8)
    'walk_16f.png' -> (4, 4)
    """
    base = os.path.splitext(filename)[0].lower()
    
    # 1. Формат '3x8', '4x4', '4x6', '2x4', '3x4', '1x8'
    m = re.search(r'(\d+)\s*[xX*]\s*(\d+)', base)
    if m:
        r, c = int(m.group(1)), int(m.group(2))
        if 1 <= r <= 8 and 1 <= c <= 12 and r * c <= 36:
            return (r, c)
            
    # 2. Формат '_24f', '_16f', '_12f', '_18f', '_8f', '_6f', '_24кадр'
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

def detect_grid_dimensions(img: Image.Image, default_grid=(2, 4), filename: str = None) -> tuple:
    """
    Строгое контентное определение сетки спрайтов (до 24+ кадров):
    1. Проверяет подсказки в имени файла.
    2. Анализирует структуру альфа-канала и долины между спрайтами.
    3. Выбирает наиболее вероятную конфигурацию строк и колонок.
    """
    if filename:
        hint = parse_filename_grid_hint(filename)
        if hint:
            return hint

    w, h = img.size
    aspect = w / h

    if default_grid == (1, 1) and 0.8 <= aspect <= 1.25:
        return (1, 1)

    arr = np.array(img.convert("RGBA"))
    alpha = arr[:, :, 3] if arr.shape[2] == 4 else np.full((h, w), 255, dtype=np.uint8)
    alpha = np.where(alpha < 20, 0, alpha)

    if (alpha > 25).sum() < 500:
        return default_grid

    # Кандидаты сеток до 24+ спрайтов
    candidates = [
        (1, 1),
        (1, 4), (1, 6), (1, 8),
        (2, 2), (2, 3), (2, 4), (2, 6), (2, 8),
        (3, 3), (3, 4), (3, 6), (3, 8),
        (4, 4), (4, 6),
        (6, 4)
    ]

    best_grid = default_grid
    best_score = -1e9

    for r, c in candidates:
        if r * c > 32:
            continue
        row_h = h / r
        col_w = w / c
        cell_aspect = col_w / row_h

        # 1. Проверка горизонтальных долин между строками
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

        # 2. Проверка вертикальных долин между колонками
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

        # 3. Оценка пропорций отдельного спрайта
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

def get_target_info(filename: str):
    clean_name = os.path.splitext(filename)[0].strip().lower()
    for keywords, subfolder, prefix, grid in CATEGORY_RULES:
        if any(kw in clean_name for kw in keywords):
            return subfolder, prefix, grid
    safe_name = "".join(c if c.isalnum() or c in "_-" else "_" for c in clean_name)
    return f"custom/{safe_name}", safe_name, (2, 4)

def check_target_frames_exist(output_base: str, target_subfolder: str, target_prefix: str, expected_count: int) -> bool:
    out_dir = os.path.join(output_base, target_subfolder)
    if not os.path.exists(out_dir):
        return False
    for i in range(expected_count):
        frame_path = os.path.join(out_dir, f"{target_prefix}_{i:02d}.png")
        if not os.path.exists(frame_path) or os.path.getsize(frame_path) == 0:
            return False
    return True

def extract_frames_from_sheet(full_rgba: Image.Image, rows: int, cols: int) -> list:
    """
    Сегментация персонажей по центроидам (Voronoi Distance Transform Segmentation).
    Извлекает каждого персонажа как целостный неделимый объект.
    Исключает обрезание выступающих ног, волос и рук.
    """
    w, h = full_rgba.size
    if rows == 1 and cols == 1:
        return [full_rgba]

    arr = np.array(full_rgba.convert("RGBA"))
    alpha = arr[:, :, 3]
    binary_fg = (alpha > 15)

    if binary_fg.sum() < 400:
        return [full_rgba]

    row_h = h / rows
    col_w = w / cols

    # 1. Поиск центроидов тел персонажей в каждой номинальной ячейке (r, c)
    markers = np.zeros((h, w), dtype=int)
    marker_id = 1

    for r in range(rows):
        for c in range(cols):
            cy = int((r + 0.5) * row_h)
            cx = int((c + 0.5) * col_w)

            box_r = int(min(row_h, col_w) * 0.38)
            y1, y2 = max(0, cy - box_r), min(h, cy + box_r)
            x1, x2 = max(0, cx - box_r), min(w, cx + box_r)

            local_a = alpha[y1:y2, x1:x2]
            if np.max(local_a) > 50:
                ly, lx = np.where(local_a > 100)
                if len(ly) == 0:
                    ly, lx = np.where(local_a > 50)
                seed_y = y1 + int(np.median(ly))
                seed_x = x1 + int(np.median(lx))
            else:
                seed_y, seed_x = cy, cx

            markers[seed_y, seed_x] = marker_id
            marker_id += 1

    # 2. Сегментация всего видимого контента по ближайшему центроиду (Distance Transform)
    _, indices = ndi.distance_transform_edt(markers == 0, return_indices=True)
    nearest_marker = markers[indices[0], indices[1]]

    # 3. Извлечение каждого персонажа с сохранением 100% его пикселей
    frames = []
    for m in range(1, marker_id):
        char_mask = (nearest_marker == m) & binary_fg
        if char_mask.sum() > 400:
            y_idx, x_idx = np.where(char_mask)
            x_min, x_max = x_idx.min(), x_idx.max()
            y_min, y_max = y_idx.min(), y_idx.max()

            char_arr = np.zeros((y_max - y_min + 1, x_max - x_min + 1, 4), dtype=np.uint8)
            sub_arr = arr[y_min:y_max + 1, x_min:x_max + 1]
            sub_mask = char_mask[y_min:y_max + 1, x_min:x_max + 1]

            char_arr[:, :, :3] = sub_arr[:, :, :3]
            char_arr[:, :, 3] = np.where(sub_mask, sub_arr[:, :, 3], 0)

            frames.append(Image.fromarray(char_arr))

    return frames

def calculate_character_anchor(cropped_img: Image.Image) -> float:
    """
    Вычисляет стабильный центр торса/позвоночника персонажа (в координатах обрезанного изображения).
    Используется для исключения горизонтального дрожания анимации при махах руками или развевающихся волосах.
    """
    arr = np.array(cropped_img)
    if arr.shape[2] < 4:
        return float(cropped_img.size[0] / 2.0)
        
    alpha = arr[:, :, 3]
    h, w = alpha.shape
    
    # Берем центральные 60% высоты персонажа (область головы и торса)
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
                
    # Fallback: геометрический центр
    return float(w / 2.0)

def get_reference_scale(input_dir: str, current_frames: list, category: str) -> float:
    """
    Определяет масштаб для достижения эталонной высоты персонажа (TARGET_BODY_HEIGHT = 390px).
    """
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
    """
    Интеллектуальное центрирование спрайта в холст 512x512:
    - Для категорий тела (body/*): выравнивание стоп по baseline_y (460) и центрирование торса по X (256).
    - Для лиц и эмоций (faces/*): идеальное центрирование по центру холста (X=256, Y=256).
    - Для предметов (props/*): центрирование по центру холста с сохранением пропорций.
    """
    bbox = frame_img.getbbox()
    if not bbox:
        return Image.new("RGBA", (target_size, target_size), (0, 0, 0, 0))
    
    cropped = frame_img.crop(bbox)
    w, h = cropped.size
    
    if scale is None:
        desired_h = TARGET_BODY_HEIGHT if "body" in category else 420
        scale = desired_h / max(h, 1)
        
    new_w = max(1, int(w * scale))
    new_h = max(1, int(h * scale))
    
    # Ограничение по ширине и высоте с запасом безопасности
    if new_w > (target_size - 24):
        scale_w = (target_size - 24) / new_w
        new_w = int(new_w * scale_w)
        new_h = int(new_h * scale_w)
        
    if new_h > (target_size - 24):
        scale_h = (target_size - 24) / new_h
        new_w = int(new_w * scale_h)
        new_h = int(new_h * scale_h)
    
    resized = cropped.resize((new_w, new_h), RESAMPLE_FILTER)
    
    canvas = Image.new("RGBA", (target_size, target_size), (0, 0, 0, 0))
    
    if "faces" in category or "props" in category:
        # Геометрическое центрирование по обоим осям
        pos_x = (target_size - new_w) // 2
        pos_y = (target_size - new_h) // 2
    else:
        # Стабилизация по вертикальной оси торса
        torso_anchor_x = calculate_character_anchor(cropped) * (new_w / max(w, 1))
        target_center_x = target_size // 2  # 256
        pos_x = int(target_center_x - torso_anchor_x)
        
        # Защита от выхода за границы холста
        pos_x = max(8, min(target_size - new_w - 8, pos_x))
        
        # Выравнивание стоп по базовой линии
        pos_y = baseline_y - new_h
        if pos_y < 8:
            pos_y = 8
        elif pos_y > target_size - new_h - 8:
            pos_y = target_size - new_h - 8
    
    canvas.paste(resized, (pos_x, pos_y), resized)
    return canvas

def process_single_image(image_path: str, output_base: str, manifest: dict):
    filename = os.path.basename(image_path)
    target_subfolder, target_prefix, expected_grid = get_target_info(filename)
        
    out_dir = os.path.join(output_base, target_subfolder)
    os.makedirs(out_dir, exist_ok=True)
    
    # Прямая загрузка чистого прозрачного PNG и очистка альфа-шума (alpha < 20)
    img = Image.open(image_path).convert("RGBA")
    arr = np.array(img)
    if arr.shape[2] == 4:
        arr[:, :, 3] = np.where(arr[:, :, 3] < 20, 0, arr[:, :, 3])
        img = Image.fromarray(arr)

    # Автоопределение сетки (строгий поиск долин между спрайтами)
    rows, cols = detect_grid_dimensions(img, expected_grid, filename)
    width, height = img.size
    
    print(f"📦 [{filename}] -> нарезка PNG ({width}x{height}), сетка: {rows}x{cols} ({rows*cols} кадров)...")
    
    # 1. Сегментация персонажей по объектам (без прямолинейных разрезов)
    raw_frames = extract_frames_from_sheet(img, rows, cols)
    
    # 2. Вычисление согласованного масштаба по эталонной высоте
    input_dir = os.path.dirname(image_path)
    sheet_scale = get_reference_scale(input_dir, raw_frames, target_subfolder)
    print(f"    📐 Масштаб: scale={sheet_scale:.4f} (базовая высота: {TARGET_BODY_HEIGHT}px), извлечено кадров: {len(raw_frames)}")
    
    generated_frames = []
    
    # 3. Прецизионное центрирование и сохранение каждого кадра в 512x512 PNG
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
        print(f"   ✓ Кадр {frame_idx+1:02d}/{len(raw_frames):02d} -> {frame_filename}")
            
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
    if os.path.exists(manifest_file) and not force_all:
        try:
            with open(manifest_file, "r", encoding="utf-8") as f:
                manifest = json.load(f)
        except Exception:
            manifest = {}
            
    valid_exts = (".png", ".webp")
    all_files = [f for f in glob.glob(os.path.join(input_dir, "*")) if f.lower().endswith(valid_exts)]
    
    all_files = [f for f in all_files if not os.path.basename(f).lower().startswith(("ref.", "reference."))]
    
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
        target_subfolder, target_prefix, expected_grid = get_target_info(fname)
        
        # Проверяем кэш
        if cache.get(fname) == current_hash and not force_all:
            continue
            
        process_single_image(fpath, output_base, manifest)
        cache[fname] = current_hash
        processed_count += 1
        
    with open(cache_file, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)
        
    with open(manifest_file, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        
    if processed_count > 0:
        print(f"\n🎉 Успешно нарезано и отцентрировано: {processed_count} PNG листов (Lanczos 512x512)!")
        print(f"📄 Манифест: public/assets/sprites/manifest.json")
    else:
        print("✨ Все файлы уже актуальны. Используйте --force для принудительной перегенерации.")

if __name__ == "__main__":
    force = "--force" in sys.argv or "-f" in sys.argv
    main(force_all=force)
