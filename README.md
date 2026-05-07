# Самозапись курьеров на смены (MVP)

**Бэкенд:** Python **FastAPI**, SQLAlchemy 2 (async, **asyncpg**), миграции Alembic, база **PostgreSQL**.

**Фронт:** React + Vite (минимальная dev-оболочка).

Всё поднимается в Docker, локально ничего ставить не нужно.

## Запуск только через Docker

```bash
docker compose up --build
```

После старта:

| Сервис | URL на вашей машине |
|--------|---------------------|
| Фронт (HMR) | http://localhost:9001 |
| API | http://localhost:9000 |
| Swagger | http://localhost:9000/docs |
| Health | http://localhost:9000/health |

Postgres из этого compose **не пробрасывается на хост** (слушает только сервисы `api`/`postgres` внутри сети), чтобы не занимать `:5432` и не конфликтовать с вашими другими контейнерами PostgreSQL.

При изменении файлов в `./app` uvicorn перезагружает API; при изменении `./frontend` Vite отдаёт обновления с HMR.

Переопределить токен админа: переменная окружения при запуске, например  
`ADMIN_TOKEN=secret docker compose up --build`.

**Курьер:** заголовок `X-Courier-Id: <uuid>`. Создание курьера и слотов — `POST /admin/*` с `Authorization: Bearer <ADMIN_TOKEN>`.

Файл [.env.example](.env.example) описывает переменные для **локального** запуска без Docker (опционально).

См. также [doc/распределение_смен_курьеров_c83a770a_plan.md](doc/распределение_смен_курьеров_c83a770a_plan.md).
