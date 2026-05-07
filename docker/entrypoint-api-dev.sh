#!/bin/sh
set -e
echo "Waiting for PostgreSQL..."
while ! nc -z "${PGHOST:-postgres}" "${PGPORT:-5432}"; do
  sleep 0.3
done
echo "Applying migrations..."
alembic upgrade head
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir /code/app
