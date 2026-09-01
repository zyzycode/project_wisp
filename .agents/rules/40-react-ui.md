# React Renderer

- Компонент решает одну визуальную задачу; разделяй монолит, когда смешались независимые UI responsibilities.
- Renderer получает presentation-ready props/state и отправляет intents через типизированный `window.wispAPI`.
- В React нет physics, behavior decisions, persistence, raw provider DTO и выбора domain/animation transitions.
- Локальный state хранит input, hover, focus и раскрытие UI; общий Renderer store — только состояние, нужное нескольким визуальным веткам.
- Не копируй Main/Domain state в несколько конкурирующих stores; источник истины должен быть один.
- Каждый effect с timer, IPC listener или browser event имеет полный dependency list и cleanup.
- `useMemo`/`useCallback` добавляй по измеримой причине, а не по умолчанию.
- Для прозрачного окна избегай тяжёлых полноэкранных filters/shadows; проверяй FPS и compositing при изменении визуального слоя.
- Visual bounds, hitbox, layers, anchors и scaling сверяй с `docs/engine/RENDER_ENGINE.md`.
- Debug UI не показывает private memory facts и чувствительные payloads.
