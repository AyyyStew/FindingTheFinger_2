FROM pgvector/pgvector:pg17

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gzip \
    && rm -rf /var/lib/apt/lists/*

COPY deploy/postgres/init/10-restore-from-url.sh /docker-entrypoint-initdb.d/10-restore-from-url.sh

RUN chmod +x /docker-entrypoint-initdb.d/10-restore-from-url.sh
