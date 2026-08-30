"""
Project Wisp — Sprite Pipeline Configuration & Constants
========================================================
Centralized definitions of canvas dimensions, layout anchors, category rules, and paths.
Standard: 4 frames minimum (1x4 grid) for all animations; 8 frames (2x4) for crash_splat.
"""

import os
from typing import List, Tuple

# Paths
LIB_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(LIB_DIR)
ROOT_DIR = os.path.dirname(SCRIPTS_DIR)

PUBLIC_DIR = os.path.join(ROOT_DIR, "public")
SPRITES_DIR = os.path.join(PUBLIC_DIR, "assets", "sprites")
GENERATED_DIR = os.path.join(ROOT_DIR, "generated_images")
MANIFEST_PATH = os.path.join(SPRITES_DIR, "manifest.json")
CACHE_PATH = os.path.join(SCRIPTS_DIR, ".sprites_cache.json")

# Canvas Dimensions & Alignment (512x512 Sprite Contract)
TARGET_CANVAS_SIZE: int = 512
TARGET_BASELINE_Y: int = 460
TARGET_BODY_HEIGHT: int = 390  # Canonical standing height of chibi model

# Face Overlay Placement
TARGET_FACE_WIDTH: int = 115
TARGET_FACE_MAX_HEIGHT: int = 90
TARGET_FACE_CENTER_X: int = 256
TARGET_FACE_CENTER_Y: int = 180

# Rule Definition: (Keywords, Target Subfolder, Animation Prefix, Default Grid)
CategoryRuleType = Tuple[List[str], str, str, Tuple[int, int]]

CATEGORY_RULES: List[CategoryRuleType] = [
    # --- Эмоции / Оверлеи лиц и зрачков (Faces & Pupils) - Standard 1x4 (4 frames) ---
    (["pupils_normal", "зрач_обыч", "pupil_normal"], "faces/pupils", "pupils_normal", (1, 4)),
    (["зрач", "pupil", "pupils", "iris"], "faces/pupils", "pupils_directional", (1, 4)),
    (["морга", "blink"], "faces/blink", "face_blink", (1, 4)),
    (["face_gaze", "взгляд", "look", "gaze", "directional", "face_look"], "faces/gaze", "face_gaze", (1, 4)),
    (["подмиг", "winking", "wink"], "faces/winking", "face_winking", (1, 4)),
    (["наду", "обид", "pout", "grumpy_face"], "faces/pout", "face_pout", (1, 4)),
    (["головокруж", "спирал", "dizzy"], "faces/dizzy", "face_dizzy", (1, 4)),
    (["любопыт", "интерес", "curious"], "faces/curious", "face_curious", (1, 4)),
    (["ухмыл", "smug", "smirk", "хитр"], "faces/smug", "face_smug", (1, 4)),
    (["слез", "плач", "cry", "crying", "tears"], "faces/crying", "face_crying", (1, 4)),
    (["звезд_глаз", "sparkle_eyes", "star_eyes", "hype"], "faces/sparkle_eyes", "face_sparkle_eyes", (1, 4)),
    (["смущен", "румян", "красне", "стыд", "tsundere", "embarrass", "blush"], "faces/embarrassed", "face_embarrassed", (1, 4)),
    (["паник_крик", "panic_scream", "scream_face", "shout"], "faces/panic_scream", "face_panic_scream", (1, 4)),
    (["злост", "злой", "сердит", "ярост", "гнев", "angry", "rage", "mad"], "faces/angry", "face_angry", (1, 4)),
    (["счаст", "радост_лиц", "happy", "joy", "smile", "улыбк"], "faces/happy", "face_happy", (1, 4)),
    (["груст", "печал", "расстро", "sad", "distress"], "faces/sad", "face_sad", (1, 4)),
    (["удивл", "шок", "испуг_лиц", "shock", "shocked", "surpris", "gasp", "panic"], "faces/shocked", "face_shocked", (1, 4)),
    (["разговор", "речь", "говорит", "рот", "talk", "talking", "lipsync", "lip_sync", "speak"], "faces/talking", "face_talking", (1, 4)),
    (["озадачен", "сомнен", "растерян", "думает_лиц", "confus", "skeptic", "puzzl", "curious_face"], "faces/thinking", "face_thinking", (1, 4)),
    (["зевот", "дремот", "сон_лиц", "сонн", "drowsy", "yawn", "sleepy", "slumber"], "faces/sleep", "face_sleep", (1, 4)),
    (["флирт", "flirt", "seduce", "erotic"], "faces/flirty", "face_flirty", (1, 4)),
    (["нейтрал", "спокойн_лиц", "neutral", "calm_face", "base_face"], "faces/neutral", "face_neutral", (1, 4)),
    (["лиц", "эмоци", "face", "expression", "eyes"], "faces/base", "face", (1, 4)),

    # --- Анимации тела (Body) - Standard 1x4 (4 frames) / 2x4 for crash_splat ---
    (["ноутбук", "печата", "код", "программирует", "typing", "laptop", "code"], "body/typing", "body_typing", (1, 4)),
    (["книг", "чита", "book", "read", "reading"], "body/read_book", "body_read_book", (1, 4)),
    (["чай", "кофе", "кружк", "напиток", "tea", "coffee", "drink"], "body/drink_tea", "body_drink_tea", (1, 4)),
    (["музык", "наушник", "music", "listen", "headphones"], "body/listen_music", "body_listen_music", (1, 4)),
    (["край_окн", "болтает_нож", "sit_edge", "edge_sit", "dangle"], "body/sit_edge", "body_sit_edge", (1, 4)),
    (["выглядыва", "подглядыва", "peek", "peeking", "peek_wall"], "body/peek_wall", "body_peek_wall", (1, 4)),
    (["стена", "лаза", "полз", "climb", "wall_climb"], "body/climb_wall", "body_climb_wall", (1, 4)),
    (["потолок", "вис", "ceiling", "hang", "ceiling_hang"], "body/ceiling_hang", "body_ceiling_hang", (1, 4)),
    (["сидит", "сидеть", "посадка_тело", "sit", "sitting"], "body/sit", "body_sit", (1, 4)),
    (["встает", "встать", "подъем", "stand_up", "standup", "rise"], "body/stand_up", "body_stand_up", (1, 4)),
    (["лежит", "лежать", "отдых", "lie", "lying"], "body/lie", "body_lie", (1, 4)),
    (["шлепок", "расплющ", "падение_пол", "splat", "crash", "crash_splat"], "body/crash_splat", "body_crash_splat", (2, 4)),
    (["отряхив", "встает_после_падения", "recover", "dust_off"], "body/recover", "body_recover", (1, 4)),
    (["машет", "маха", "привет", "рука_машет", "wave", "waving", "hello"], "body/wave", "body_wave", (1, 4)),
    (["побед", "ура", "праздн", "радост_прыж", "celebrate", "celebration", "cheer", "victory", "win"], "body/celebrate", "body_celebrate", (1, 4)),
    (["испуг", "страх", "боит", "паник_тело", "scared", "afraid", "fear", "tremble"], "body/scared", "body_scared", (1, 4)),
    (["скук", "скуч", "тоска", "зева", "bored", "boring", "idle_bored", "tedious"], "body/bored", "body_bored", (1, 4)),
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
    (["стояние", "поко", "дыхан", "idle", "rest", "stand", "breath"], "body/idle", "body_idle", (1, 4)),

    # --- Предметы и FX (Props) - Standard 1x4 (4 frames) or 1x1 for single prop ---
    (["подушк", "pillow"], "props/pillow", "prop_pillow", (1, 4)),
    (["сердеч", "heart"], "props/heart", "prop_heart", (1, 4)),
    (["вопрос", "знак_вопроса", "question"], "props/question", "prop_question", (1, 4)),
    (["искра", "блеск", "sparkle"], "props/sparkle", "prop_sparkle", (1, 4)),
    (["лампочк", "идея", "lightbulb", "idea"], "props/lightbulb", "prop_lightbulb", (1, 4)),
    (["восклиц", "алерт", "exclamation", "alert", "notice"], "props/exclamation", "prop_exclamation", (1, 4)),
    (["капл", "пот", "sweat", "sweat_drop", "awkward"], "props/sweat_drop", "prop_sweat_drop", (1, 4)),
    (["храп", "спящ_букв", "zzz", "sleep_fx"], "props/zzz", "prop_zzz", (1, 4)),
    (["нот", "мелоди", "music_notes", "melody", "song"], "props/music_notes", "prop_music_notes", (1, 4)),
    (["предмет", "вещ", "prop", "shadow", "тень", "heart_fx", "эффект", "emote", "icon"], "props", "prop", (1, 4)),
]
