# Реестр запросов на спрайты и анимации (Sprite Requests)

Этот документ — единый журнал арт-запросов между разработчиками (`app-developer`) и внешним художником-человеком.

## Правила для разработчика (`app-developer`)
1. Разработчик **не генерирует, не нарезает и не рисует** спрайты и **не изменяет файлы внутри `asset-pipeline/`** (всю графику рисует внешний художник-человек вне ИИ-системы).
2. Если в задаче требуется анимация/спрайт, отсутствующий в `public/assets/sprites/`:
   - Применить в коде временный fallback/алиас (в `asset-resolver.ts` или FSM);
   - **Обязательно** добавить новую строку в таблицу ниже с описанием задачи, ключа и требований к движению;
   - Указать ключ спрайта в строке отчёта `SPRITES: <список или none>`.

---

## Открытые запросы

AUTO-I04/I05/I06 и #48 закрыты:
семь наборов (28 PNG) зарегистрированы в [манифесте](../../public/assets/sprites/manifest.json).
Подключение в приложении: `grab_edge`, `jump_travel`, `pull_up_edge` (выход на опору
в маршруте через стену), `sit_edge`, `sit_edge_settle`, `sit_edge_sleep` и `cursor_play`
используют выделенные ключи `body_*`. Старые спрайты остаются fallback для старых манифестов.
История и проверки — в [ASSETS.md](../../asset-pipeline/ASSETS.md) и
[отчёте приёмки](../../asset-pipeline/references/REQUESTED_SPRITES_QA.md).

| Task ID | Имя спрайта / Ключ | Текущий fallback в коде | Требования к кадрам и движению | Статус |
|---|---|---|---|---|

CURSOR-GAME-V1: арт-запросы закрыты **2026-09-08**. `body_cursor_caught` и
`body_cursor_missed` зарегистрированы в манифесте: по 6 кадров, 600 ms.
[Результат и воспроизведение](../../asset-pipeline/references/CURSOR_GAME_QA.md).
Выделенные ассеты подключены в [AssetResolver](../../src/renderer/render-engine/asset-resolver.ts)
через контекст текущей игровой реакции Body → Skin: caught → `body_cursor_caught`,
missed/lost_target → `body_cursor_missed`. Старые манифесты сохраняют fallback
`body_petting`/`body_scared`; общие реакции вне игры не изменены.
Открытых арт-запросов на эту дату нет.
