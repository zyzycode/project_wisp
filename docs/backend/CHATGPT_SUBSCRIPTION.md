# Локальное подключение ChatGPT Pro

Scope: один локальный пользователь, существующие `/v1/chat` и `/v1/touch`.
Пользователь явно разрешил реализацию без отдельного architect gate (2026-10-08).
Внешний wire contract не меняется; OAuth и Responses mapping принадлежат backend.

## Контракт интеграции

- Авторизация через системный браузер, loopback callback, PKCE S256, state и nonce.
- Подпись ID token проверяется по фиксированному OpenAI JWKS, только RS256;
  проверяются issuer, audience, exp, nonce и subject при повторном входе.
- Только выданное разрешение `chatgpt.tokens.use.direct` допускает inference.
- Только `https://api.openai.com/v1/responses`, `store=false`, `stream=true`.
  Адаптер собирает SSE до `response.completed` и валидирует `ModelReply`.
- Модель выбирается из каталога аккаунта. Нет перехода на API key или Groq при ошибке.
- Внешние retries отключены. Deadline и byte cap ограничивают локальный запрос,
  но не гарантируют прекращение вычисления провайдером или расход подписки.
- Этот preview не поддерживает `max_output_tokens` и `temperature`.
  Краткость задаётся prompt; validation ограничивает выдаваемую реплику, не расход.
- Передаются существующие instructions, ограниченная история и character context.
  Backend не сохраняет диалоги. `store=false` не является обещанием ZDR провайдера.
  Для этого локального режима пользователь разрешил передачу тестового контекста OpenAI;
распространение внешним тестерам и серверный deployment не входят в scope.

## Запуск на Windows

Из корня репозитория, при остановленном backend:

```powershell
cd backend
.venv/Scripts/python.exe -m pip install --only-binary=:all: -r requirements.txt
.venv/Scripts/python.exe -m wisp_backend.chatgpt_login login
```

В браузере выбрать свой Pro-аккаунт и разрешить Project Wisp использование плана.
Команда выводит доступный каталог; выбрать точный slug:

```powershell
.venv/Scripts/python.exe -m wisp_backend.chatgpt_login models --model SLUG
```

В локальном `backend/.env` установить `WISP_AI_PROVIDER=chatgpt`; затем запускать
обычный `node scripts/wisp.mjs dev` из корня. Groq key в этом режиме не используется.
Модель берётся из сохранённого выбора; `WISP_CHATGPT_MODEL` — необязательное
переопределение точным slug из каталога аккаунта. `ASSISTANTS_JSON` относится к Groq.
В режиме ChatGPT весь трафик существующих chat/touch use cases расходует подписку;
новых таймеров/автоматических AI-вызовов эта интеграция не добавляет.
История ограничена существующим v1-контрактом (до 7 сообщений).

Сессия хранится в игнорируемом `backend/data/chatgpt-session.local`:
Windows DPAPI current-user encryption; Unix owner-only file permissions.
Одновременно допускается один backend или одна команда управления сессией.
Остановить backend перед login/models/logout; leases освобождаются при завершении процесса.
При неоднозначном refresh сохранённые токены очищаются: повторить вход.

Выход: `python -m wisp_backend.chatgpt_login logout` из `backend/`.
Команда пытается отозвать refresh token, очищает локальные токены, сохраняет
host/client mapping для повторного входа. Если отзыв не подтверждён, отключить
Project Wisp в ChatGPT Settings. Это не удаляет данные у провайдера.
Управление лимитами: [ChatGPT Settings → Usage](https://chatgpt.com/#settings/Usage).
На Unix команды те же с `.venv/bin/python`.

## Dependency review

Для проверки OIDC используются PyJWT 2.15.1 и cryptography 50.0.2.

| Фактор | Решение |
| --- | --- |
| Лицензии | PyJWT MIT; cryptography Apache-2.0/BSD; cffi и pycparser MIT/BSD. |
| Размер/transitives | PyJWT wheel ~34 KB; cryptography Windows wheel ~3.9 MB; cffi, pycparser, условный typing-extensions. Нет AI SDK. |
| Maintenance/security | Активные релизы в сентябре/октябре 2026; проверены upstream advisories. Известный critical PyJWT GHSA-ffc3-869f-jxw9 исправлен в 2.14.0; выбрана 2.15.1. Неизвестные/неопубликованные CVE этим не исключаются. |
| Native toolchain | PyJWT pure Python; cryptography/cffi устанавливаются готовыми wheels (`--only-binary=:all:`), без Rust/C build toolchain. |
| 50–100 строк своего кода | Собственная RSA/JWT криптография отвергнута; HTTP/OAuth orchestration использует существующий httpx и stdlib. |

Источники: [PyJWT](https://pypi.org/project/PyJWT/),
[cryptography](https://pypi.org/project/cryptography/),
[PyJWT advisories](https://github.com/jpadilla/pyjwt/security/advisories),
[cryptography advisories](https://github.com/pyca/cryptography/security/advisories).

Протокол: [вход](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[сессии](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions),
[inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference),
[ограничения](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
