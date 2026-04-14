"""add embedding spans

Revision ID: 9d6e4c2b7a10
Revises: b1f8d0d8c3a1
Create Date: 2026-04-13 17:25:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import pgvector.sqlalchemy
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "9d6e4c2b7a10"
down_revision: Union[str, Sequence[str], None] = "b1f8d0d8c3a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "embedding_profile",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("target_tokens", sa.Integer(), nullable=False),
        sa.Column("overlap_tokens", sa.Integer(), nullable=False),
        sa.Column("min_tokens", sa.Integer(), nullable=False),
        sa.Column("max_tokens", sa.Integer(), nullable=False),
        sa.Column("model_name", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("extra_metadata", sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("label"),
    )
    op.create_index(
        "ix_embedding_profile_target_tokens",
        "embedding_profile",
        ["target_tokens"],
        unique=False,
    )

    op.create_table(
        "embedding_span",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("corpus_version_id", sa.Integer(), nullable=False),
        sa.Column("corpus_id", sa.Integer(), nullable=False),
        sa.Column("profile_id", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("token_count", sa.Integer(), nullable=False),
        sa.Column("word_count", sa.Integer(), nullable=False),
        sa.Column("char_count", sa.Integer(), nullable=False),
        sa.Column("start_unit_id", sa.BigInteger(), nullable=False),
        sa.Column("end_unit_id", sa.BigInteger(), nullable=False),
        sa.Column("start_char_offset", sa.Integer(), nullable=True),
        sa.Column("end_char_offset", sa.Integer(), nullable=True),
        sa.Column("reference_label", sa.Text(), nullable=True),
        sa.Column("ancestor_path", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("extra_metadata", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["corpus_id"], ["corpus.id"]),
        sa.ForeignKeyConstraint(["corpus_version_id"], ["corpus_version.id"]),
        sa.ForeignKeyConstraint(["end_unit_id"], ["unit.id"]),
        sa.ForeignKeyConstraint(["profile_id"], ["embedding_profile.id"]),
        sa.ForeignKeyConstraint(["start_unit_id"], ["unit.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_embedding_span_corpus_profile", "embedding_span", ["corpus_id", "profile_id"], unique=False)
    op.create_index("ix_embedding_span_end_unit", "embedding_span", ["end_unit_id"], unique=False)
    op.create_index("ix_embedding_span_profile", "embedding_span", ["profile_id"], unique=False)
    op.create_index("ix_embedding_span_start_unit", "embedding_span", ["start_unit_id"], unique=False)
    op.create_index("ix_embedding_span_version_profile", "embedding_span", ["corpus_version_id", "profile_id"], unique=False)

    op.create_table(
        "embedding_span_unit",
        sa.Column("span_id", sa.BigInteger(), nullable=False),
        sa.Column("unit_id", sa.BigInteger(), nullable=False),
        sa.Column("unit_order", sa.Integer(), nullable=False),
        sa.Column("char_start_in_unit", sa.Integer(), nullable=True),
        sa.Column("char_end_in_unit", sa.Integer(), nullable=True),
        sa.Column("coverage_weight", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["span_id"], ["embedding_span.id"]),
        sa.ForeignKeyConstraint(["unit_id"], ["unit.id"]),
        sa.PrimaryKeyConstraint("span_id", "unit_id"),
    )
    op.create_index("ix_embedding_span_unit_span_order", "embedding_span_unit", ["span_id", "unit_order"], unique=False)
    op.create_index("ix_embedding_span_unit_unit", "embedding_span_unit", ["unit_id"], unique=False)

    op.create_table(
        "span_embedding",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("embedding_span_id", sa.BigInteger(), nullable=False),
        sa.Column("method_id", sa.Integer(), nullable=False),
        sa.Column("vector", pgvector.sqlalchemy.vector.VECTOR(), nullable=False),
        sa.ForeignKeyConstraint(["embedding_span_id"], ["embedding_span.id"]),
        sa.ForeignKeyConstraint(["method_id"], ["method.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("embedding_span_id", "method_id", name="uq_span_embedding_span_method"),
    )
    op.create_index("ix_span_embedding_method", "span_embedding", ["method_id"], unique=False)
    op.create_index("ix_span_embedding_span", "span_embedding", ["embedding_span_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_span_embedding_span", table_name="span_embedding")
    op.drop_index("ix_span_embedding_method", table_name="span_embedding")
    op.drop_table("span_embedding")

    op.drop_index("ix_embedding_span_unit_unit", table_name="embedding_span_unit")
    op.drop_index("ix_embedding_span_unit_span_order", table_name="embedding_span_unit")
    op.drop_table("embedding_span_unit")

    op.drop_index("ix_embedding_span_version_profile", table_name="embedding_span")
    op.drop_index("ix_embedding_span_start_unit", table_name="embedding_span")
    op.drop_index("ix_embedding_span_profile", table_name="embedding_span")
    op.drop_index("ix_embedding_span_end_unit", table_name="embedding_span")
    op.drop_index("ix_embedding_span_corpus_profile", table_name="embedding_span")
    op.drop_table("embedding_span")

    op.drop_index("ix_embedding_profile_target_tokens", table_name="embedding_profile")
    op.drop_table("embedding_profile")
