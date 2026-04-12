"""normalize sources into source_ref

Revision ID: b1f8d0d8c3a1
Revises: 0ac3ffc1cd42
Create Date: 2026-04-12 16:20:00.000000
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b1f8d0d8c3a1"
down_revision: Union[str, Sequence[str], None] = "0ac3ffc1cd42"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _sources_path() -> Path:
    # /repo/pipeline/alembic/versions/<file>.py -> /repo/data/sources.json
    return Path(__file__).resolve().parents[3] / "data" / "sources.json"


def _normalize(v: Any) -> str | None:
    if v is None:
        return None
    if not isinstance(v, str):
        raise RuntimeError(f"Expected string field, got {type(v).__name__}")
    s = v.strip()
    return s if s else None


def _default_source_key(corpus: str, translation: str | None) -> str:
    base = corpus if translation is None else f"{corpus}-{translation}"
    slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in base)
    slug = "-".join(part for part in slug.split("-") if part)
    return slug or "source"


def _load_catalog() -> dict[tuple[str, str | None], dict[str, str | None]]:
    path = _sources_path()
    if not path.exists():
        raise RuntimeError(
            f"Missing canonical source catalog at {path}. "
            "Create data/sources.json before running this migration."
        )

    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise RuntimeError("data/sources.json must be a JSON array")

    out: dict[tuple[str, str | None], dict[str, str | None]] = {}
    seen_keys: set[str] = set()
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise RuntimeError(f"data/sources.json item #{i} must be an object")

        corpus = _normalize(item.get("corpus"))
        translation = _normalize(item.get("translation"))
        url = _normalize(item.get("url"))
        source_key = _normalize(item.get("source_key"))
        provider = _normalize(item.get("provider"))
        label = _normalize(item.get("label"))

        if not corpus:
            raise RuntimeError(f"data/sources.json item #{i} missing 'corpus'")
        if not url:
            raise RuntimeError(f"data/sources.json item #{i} missing 'url'")

        if not source_key:
            source_key = _default_source_key(corpus, translation)
        if source_key in seen_keys:
            # duplicate source_key across multiple corpus mappings is allowed only
            # if URL matches; that is validated during upsert.
            pass
        seen_keys.add(source_key)

        key = (corpus, translation)
        if key in out:
            raise RuntimeError(f"Duplicate corpus/translation mapping in data/sources.json: {key}")

        out[key] = {
            "corpus": corpus,
            "translation": translation,
            "source_key": source_key,
            "url": url,
            "provider": provider,
            "label": label,
        }

    return out


def _ensure_source_ref_id(bind: sa.Connection, entry: dict[str, str | None]) -> int:
    by_key = bind.execute(
        sa.text("SELECT id, url FROM source_ref WHERE source_key = :source_key"),
        {"source_key": entry["source_key"]},
    ).mappings().first()
    if by_key:
        if by_key["url"] != entry["url"]:
            raise RuntimeError(
                f"source_key={entry['source_key']!r} maps to conflicting URLs: "
                f"{entry['url']!r} vs existing {by_key['url']!r}"
            )
        return int(by_key["id"])

    by_url = bind.execute(
        sa.text("SELECT id FROM source_ref WHERE url = :url"),
        {"url": entry["url"]},
    ).mappings().first()
    if by_url:
        return int(by_url["id"])

    return int(bind.execute(sa.text("""
        INSERT INTO source_ref (source_key, url, provider, label)
        VALUES (:source_key, :url, :provider, :label)
        RETURNING id
    """), {
        "source_key": entry["source_key"],
        "url": entry["url"],
        "provider": entry["provider"],
        "label": entry["label"],
    }).scalar_one())


def upgrade() -> None:
    op.create_table(
        "source_ref",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_key", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("provider", sa.Text(), nullable=True),
        sa.Column("label", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("extra_metadata", sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_key"),
        sa.UniqueConstraint("url"),
    )

    op.add_column("corpus_version", sa.Column("source_id", sa.Integer(), nullable=True))
    op.create_index("ix_corpus_version_source_id", "corpus_version", ["source_id"], unique=False)
    op.create_foreign_key(
        "fk_corpus_version_source_ref",
        "corpus_version",
        "source_ref",
        ["source_id"],
        ["id"],
    )

    bind = op.get_bind()
    catalog = _load_catalog()

    rows = bind.execute(sa.text("""
        SELECT cv.id, c.name AS corpus, cv.translation_name AS translation
        FROM corpus_version cv
        JOIN corpus c ON c.id = cv.corpus_id
    """)).mappings().all()

    missing: list[str] = []
    for row in rows:
        key = (_normalize(row["corpus"]), _normalize(row["translation"]))
        if key not in catalog:
            missing.append(f"corpus={row['corpus']!r}, translation={row['translation']!r}")

    if missing:
        preview = "\n  - ".join(missing[:20])
        suffix = "\n  - ... (truncated)" if len(missing) > 20 else ""
        raise RuntimeError(
            "Migration aborted: missing corpus/translation mappings in data/sources.json for:\n  - "
            + preview
            + suffix
        )

    for row in rows:
        key = (_normalize(row["corpus"]), _normalize(row["translation"]))
        entry = catalog[key]
        source_id = _ensure_source_ref_id(bind, entry)
        bind.execute(
            sa.text("UPDATE corpus_version SET source_id = :source_id WHERE id = :id"),
            {"source_id": source_id, "id": int(row["id"])},
        )

    null_count = int(bind.execute(
        sa.text("SELECT COUNT(*) FROM corpus_version WHERE source_id IS NULL")
    ).scalar_one())
    if null_count != 0:
        raise RuntimeError(f"Migration aborted: {null_count} corpus_version rows still have NULL source_id")

    op.alter_column("corpus_version", "source_id", nullable=False)
    op.drop_column("unit", "source")
    op.drop_column("corpus_version", "source")


def downgrade() -> None:
    op.add_column("corpus_version", sa.Column("source", sa.Text(), nullable=True))
    op.add_column("unit", sa.Column("source", sa.Text(), nullable=True))

    bind = op.get_bind()
    bind.execute(sa.text("""
        UPDATE corpus_version cv
        SET source = sr.url
        FROM source_ref sr
        WHERE cv.source_id = sr.id
    """))
    bind.execute(sa.text("""
        UPDATE unit u
        SET source = cv.source
        FROM corpus_version cv
        WHERE u.corpus_version_id = cv.id
    """))

    op.drop_constraint("fk_corpus_version_source_ref", "corpus_version", type_="foreignkey")
    op.drop_index("ix_corpus_version_source_id", table_name="corpus_version")
    op.drop_column("corpus_version", "source_id")
    op.drop_table("source_ref")
