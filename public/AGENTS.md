# AGENTS: Desktop assets

Обязательны общие [правила](../AGENTS.md) и применимые [desktop-инварианты](../src/AGENTS.md).

Графику создаёт только внешний художник-человек. Агентам запрещено рисовать, генерировать или нарезать спрайты. Готовые ассеты — в `public/assets/sprites/`, manifest — `public/assets/sprites/manifest.json`. При отсутствии ассета использовать fallback/заглушку/алиас в коде и запись в [SPRITE_REQUESTS](../docs/art/SPRITE_REQUESTS.md): Task ID, ключ, fallback, требования к кадрам/движению. Ключи указать в `SPRITES` отчёта.
