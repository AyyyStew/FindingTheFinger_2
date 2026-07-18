FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

ARG INSTALL_EMBEDDINGS=true

WORKDIR /app

COPY deploy/backend/requirements-core.txt /tmp/requirements-core.txt
COPY deploy/backend/requirements-embeddings.txt /tmp/requirements-embeddings.txt

RUN python -m pip install --upgrade pip \
    && pip install -r /tmp/requirements-core.txt \
    && if [ "${INSTALL_EMBEDDINGS}" = "true" ]; then \
        pip install --index-url https://download.pytorch.org/whl/cpu torch \
        && pip install -r /tmp/requirements-embeddings.txt; \
    fi

COPY db ./db
COPY data/sources.json ./data/sources.json
COPY pipeline/alembic.ini ./pipeline/alembic.ini
COPY pipeline/alembic ./pipeline/alembic
COPY webapp/backend ./webapp/backend
COPY deploy/backend/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]
