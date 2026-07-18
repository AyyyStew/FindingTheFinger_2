#!/bin/sh
set -e

python - <<'PY'
import os
import time

import psycopg
from sqlalchemy.engine import make_url

raw_dsn = os.environ["DATABASE_URL"]
url = make_url(raw_dsn)

# psycopg.connect() expects a libpq/Postgres URL, not a SQLAlchemy driver URL
if "+" in url.drivername:
    driver = url.drivername.split("+", 1)[0]
    url = url.set(drivername=driver)

dsn = url.render_as_string(hide_password=False)

for attempt in range(30):
    try:
        with psycopg.connect(dsn, autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
            break
    except psycopg.OperationalError:
        if attempt == 29:
            raise
        time.sleep(2)
PY

if [ "${RUN_DB_MIGRATIONS:-true}" = "true" ]; then
  alembic -c pipeline/alembic.ini upgrade head
fi

exec uvicorn webapp.backend.main:app --host 0.0.0.0 --port 8000
