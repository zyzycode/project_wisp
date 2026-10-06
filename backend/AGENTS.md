# AGENTS: Backend Wisp

Обязательны [общие правила](../AGENTS.md). Этот файл применяется только к `backend/`; Electron/React/TypeScript, IPC и npm gates здесь не действуют. Общие роли находятся в `.agents/agents/`; читать только назначенную роль.

## Runtime и границы

- Python 3.10+, FastAPI, Pydantic, httpx, Groq. Entry point — `main.py`; application composition — `wisp_backend/application.py`. Зависимости — `requirements.txt` и `requirements-dev.txt`; тесты — pytest.
- API boundary валидирует вход, JSON/UTF-8, разрешённые поля, длины UTF-16, byte caps и ошибки до provider call. Wire DTO — Pydantic schemas; provider credentials, model и prompts остаются серверными.
- Канонические контракты — [Backend v1](../docs/engine/BACKEND_API_CONTRACT.md), [memory](../docs/engine/BACKEND_MEMORY_CONTRACT.md), [events](../docs/engine/AI_EVENTS_CONTRACT.md). Читать только контракт изменяемого endpoint. Фактическая версия импортированного сервера и известные gaps — в [серверном навигаторе](../docs/backend/README.md).
- Сервер возвращает семантические предложения; не исполняет локальные FSM/physics, не меняет локальную память напрямую. Desktop и backend не импортируют реализацию друг друга.
- У httpx lifecycle-owned client: bounded чтение ответов, deadline/connect/pool timeout, cancellation и закрытие stream/client. Redirect и автоматические повторы upstream запрещены. Provider errors преобразуются в безопасный wire error без внутренних деталей.
- Proxy/TLS environment используется только с явным `WISP_UPSTREAM_TRUST_ENV=true`; default false не отключает TLS verification. Ключи не печатать. Конфигурацию `.env` менять локально, без коммита секретов.
- Нет разрешения на серверное хранение диалогов/памяти. Новое хранилище, auth, quota/idempotency или новая версия API требует согласования контракта и architect gate; wire rules не ослаблять под текущую реализацию.

## Код и проверка

Новые/изменённые функции типизировать, неизвестные входы валидировать через схемы/guards, не скрывать ошибки blanket exceptions. Не рефакторить импортированный код целиком ради стиля.

Багфикс начинается с падающего регрессионного теста. Provider HTTP в unit-тестах мокать через httpx MockTransport; локальный HTTP fixture допустим для проверки маршрутизации/proxy. Tests не используют реальные ключи и внешнюю сеть. Проверять timeout, недоступность, malformed response и закрытие ресурсов для затронутого lifecycle.

Исполнитель: сначала затронутые тесты, затем `python -m pip check` → `python -m pytest -q` из `backend/`. Допустим `-p no:cacheprovider` при ограничениях кеша. Общие v1 fixtures читать из `../docs/contracts/fixtures/desktop-backend-v1/`, не дублировать их. При изменении desktop также выполнить его gates. Reviewer: аудит diff, `npm run typecheck` из корня и ссылки/согласованность; продуктовые tests не запускать.

Серверные runtime data/venv/секреты исключены из Git. Новые dependencies проходят §5 корневых правил. Продуктовая документация — в `docs/backend/` или соответствующем общем контракте, без конкурирующих копий API-спецификации.
