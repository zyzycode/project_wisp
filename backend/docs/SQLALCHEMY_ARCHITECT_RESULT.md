# SQLAlchemy: architect result

**TASK:** прямой запрос «Нужна sqlalchemy»; существующий backend SQLite ledger.
**Дата / статус:** 2026-10-13, accepted для указанного ниже scope.

## Decision

Перевести SQL-доступ `SQLiteLedger` на синхронный SQLAlchemy Core 2.0.54,
сохранив SQLite, публичный `Ledger` и существующие `asyncio.to_thread` / lock.
Core предоставляет таблицы, выражения и явные транзакции без ненужного здесь
identity map / ORM Session. SQLAlchemy 2.1 требует Python >=3.11, поэтому
его выбор сейчас нарушил бы поддерживаемый backend runtime Python 3.10+.

## Dependency Review

| Фактор | Решение и проверенное основание |
|---|---|
| Лицензия | SQLAlchemy — MIT. Транзитивный greenlet — MIT с PSF-2.0 для унаследованных частей; обе разрешительные. Существующий typing-extensions — PSF-2.0. [SQLAlchemy metadata](https://raw.githubusercontent.com/sqlalchemy/sqlalchemy/rel_2_0_54/setup.cfg), [greenlet license](https://raw.githubusercontent.com/python-greenlet/greenlet/3.5.6/LICENSE), [typing-extensions](https://pypi.org/project/typing-extensions/4.16.0/). |
| Размер / transitives | SQLAlchemy 2.0.54: универсальный wheel около 2.0 MB, CPython 3.13 Windows x64 около 2.2 MB. Runtime зависимости: typing-extensions >=4.6.0 и платформенно обусловленный greenlet >=1. На Python 3.10+ importlib-metadata не требуется. Greenlet 3.5.6: Windows CPython 3.13 wheel 324.1 kB, дополнительных runtime dependencies нет. [SQLAlchemy wheels](https://pypi.org/project/SQLAlchemy/2.0.54/), [greenlet wheels](https://pypi.org/project/greenlet/3.5.6/), [greenlet packaging](https://raw.githubusercontent.com/python-greenlet/greenlet/3.5.6/setup.py). |
| Maintenance / critical CVE | Релизы 2.0.54 от 2026-09-15 и greenlet 3.5.6 от 2026-09-14 подтверждают maintenance за последний год; SQLAlchemy 2.0 находится в maintenance mode с critical fixes. В проверенных источниках не найдено открытых critical CVE, применимых к этим версиям: maintainer advisories пусты; известные critical SQLAlchemy CVE-2019-7164 / CVE-2019-7548 исправлены до 2.0. [Release policy](https://www.sqlalchemy.org/download.html#current), [SQLAlchemy advisories](https://github.com/sqlalchemy/sqlalchemy/security/advisories), [greenlet advisories](https://github.com/python-greenlet/greenlet/security/advisories), [CVE-2019-7164](https://github.com/advisories/GHSA-887w-45rq-vxgf), [CVE-2019-7548](https://github.com/advisories/GHSA-38fc-9xqv-7f7q). |
| Платформа / toolchain | SQLAlchemy имеет pure Python wheel; ускорения необязательны. Greenlet — native transitive, устанавливается готовым Windows wheel, сборка не нужна. Sync Core не нуждается в greenlet для исполнения, но metadata SQLAlchemy 2.0 требует его на AMD64; обход через `--no-deps` запрещает корректный `pip check`. Использовать готовые wheels; при отсутствии wheel не вводить компилятор. |
| Альтернатива 50–100 строк | Существующий sqlite3 уже решает узкую задачу без зависимости; небольшая обёртка могла бы улучшить транзакции. Однако она не заменяет выражения, metadata и систему типов SQLAlchemy. Прямой выбор пользователя принят; стоимость зависимости оправдана единым способом SQL-доступа. ORM, Alembic, aiosqlite и другая СУБД сейчас не нужны. |

**Constraints:** `SQLAlchemy==2.0.54`; для обусловленного metadata native transitive
закрепить `greenlet==3.5.6` с тем же platform marker из SQLAlchemy setup.cfg.
Эквивалентный marker: `platform_machine == 'aarch64' or platform_machine == 'ppc64le' or platform_machine == 'x86_64' or platform_machine == 'amd64' or platform_machine == 'AMD64' or platform_machine == 'win32' or platform_machine == 'WIN32'`.
Проверенное существующее `typing-extensions==4.16.0` удовлетворяет >=4.6.0;
обновлять остальные зависимости ради этого перехода не требуется.
Проверка security ограничена открытыми первичными источниками на указанную дату;
это не полный аудит окружения, исходного кода или гарантия отсутствия уязвимостей.

## Layer boundaries & Contracts

Владелец SQLAlchemy Engine/Connection и таблиц — backend ledger adapter.
`Ledger`, `Admission`, `Usage`, `Outcome` из
[contracts.py](../wisp_backend/contracts.py) остаются независимыми от SQLAlchemy.
Service, endpoints, wire DTO и desktop не получают Connection/Row/Session.
Обязательные источники поведения: [Backend API §5–6](../../docs/contracts/BACKEND_API_CONTRACT.md#5-закрытая-alpha-серверный-admission-учёт-и-повторы),
[OPERATIONS](OPERATIONS.md) и связанные [BE-A02 consequences](BE_A02_RESULT.md#implementation-consequences).
Ограничение одного процесса/worker и отсутствие пользовательского server storage сохраняются.

## Implementation consequences

1. Изменять только ledger SQL-доступ, его schema/helper, requirements, связанные
   тесты и серверную документацию. Core expressions для CRUD; raw SQL допустим
   для SQLite PRAGMA, BEGIN и существующего ALTER. Значения только bind parameters.
2. Сохранить имена/структуру `meta`, `days`, `entries` и существующие файлы.
   `days.confirmed/prompt/completion` имеют **пустой declared type**: их SQLite
   affinity нельзя заменить INTEGER/NUMERIC, иначе decimal strings огромного
   usage могут превратиться в неточный REAL. Использовать SQLite-specific type
   с пустым DDL, int до signed64 и decimal string выше него; читать обратно int.
   Не выполнять SQL-арифметику над этими тремя полями. Проверить старые и новые БД.
3. Старый `entries` без reservation получает прежний default 131072 **до** crash
   recovery; новые записи сохраняют reservation выбранного provider. Не пересоздавать
   таблицы, не сбрасывать budgets, halt, monotonic clock или request IDs.
4. Один lifecycle-owned Connection с `NullPool`, `check_same_thread=False`,
   timeout 0.25 s. Все обращения, включая startup/close, под существующим lock
   в worker thread. Connection не используется конкурентно и не живёт за `close()`.
   Закрыть Connection и затем dispose Engine; частичный startup также освобождает ресурсы.
5. Для Python 3.10+ отключить sqlite3 implicit BEGIN (`isolation_level=None`
   в connect hook) и выдавать SQL BEGIN через SQLAlchemy begin hook.
   `Connection.begin()` охватывает каждую целую операцию и startup migration/recovery;
   вложенный `_settle` не открывает вторую транзакцию. PRAGMA secure_delete=ON,
   journal_mode=DELETE, synchronous=FULL устанавливать до транзакции в DBAPI
   connect hook; не смешивать этот режим с SQLAlchemy AUTOCOMMIT.
   Основание: [SQLite transaction control](https://docs.sqlalchemy.org/en/20/dialects/sqlite.html#enabling-non-legacy-sqlite-transactional-modes-with-the-sqlite3-or-aiosqlite-driver).
6. Rollback при ошибке; storage/SQLAlchemy errors преобразовать в прежний безопасный
   `upstream_unavailable` и fail-closed latch. Обычные admission `ServiceError`
   откатывают транзакцию без storage latch. Не логировать SQL parameters или исключения
   с данными; Engine echo выключен, hide_parameters включён. Cache публикуется
   только после успешного commit с прежними deadline/cancellation guards.
7. Проверки исполнителя: текущие ledger/reservation и cancellation/late-result tests;
   дополнительные проверки legacy schema, exact huge usage после reopen, rollback
   между записями, SQLAlchemy storage failure без replay, PRAGMA и освобождение файла
   после close/неудачного startup. Затем `check:backend` → `test:backend` из корня.
   Установка через wheels с полноценным разрешением зависимостей и `pip check`.

**CHANGES:** только этот architect result; продуктовая реализация — отдельный шаг.
**BOUNDARIES:** API, storage ownership, concurrency topology и retention неизменны.
**SPRITES:** none.
**VERIFICATION:** ссылки и соответствие контрактам проверены; документ <450 строк.
Продуктовые тесты не запускались: docs-only architect gate.
**RECOMMENDED NEXT GATE:** `done` для архитектуры; реализация app-developer разрешена
в описанном scope с обязательными проверками выше.
