"""
ftf/db/models.py

SQLAlchemy ORM models for the Finding The Finger database (v3).

Table overview:
    taxonomy          — hierarchical classification tree (Abrahamic > Judaism, etc.)
    corpus            — canonical text identity (Bible, Quran, etc.)
    corpus_to_taxonomy — many-to-many bridge between corpus and taxonomy
    source_ref        — canonical provenance source (URL/provider), shared by versions
    corpus_version    — a specific translation/edition of a corpus (Bible KJV, Bible NIV)
    corpus_level      — defines what each height means for a corpus (0=Verse, 1=Chapter, ...)
    unit              — every node in the text tree (verse, chapter, book, etc.)
    method            — describes how an embedding was generated
    embedding_profile — segmentation profile for normalized embedding spans
    embedding_span    — derived text span used for cross-corpus embeddings
    span_embedding    — vector embedding tied to a span + method
    embedding         — legacy vector embedding tied to a unit + method
"""

from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger, DateTime, Float, ForeignKey, Index, Integer, Text, JSON,
    UniqueConstraint, func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# Taxonomy
# ---------------------------------------------------------------------------

class Taxonomy(Base):
    """
    Hierarchical classification tree used for search and filtering.
    Not meant to convey theological meaning — just organisational grouping.

    Example tree:
        Abrahamic (level=0)
        ├── Judaism (level=1)
        ├── Christianity (level=1)
        └── Islam (level=1)
    """
    __tablename__ = "taxonomy"

    id:          Mapped[int]      = mapped_column(Integer, primary_key=True)
    parent_id:   Mapped[int|None] = mapped_column(Integer, ForeignKey("taxonomy.id"), nullable=True)
    name:        Mapped[str]      = mapped_column(Text, nullable=False)
    level:       Mapped[int]      = mapped_column(Integer, nullable=False)
    extra_metadata: Mapped[dict|None] = mapped_column("extra_metadata", JSON)

    parent:   Mapped["Taxonomy|None"]    = relationship(back_populates="children", remote_side="Taxonomy.id")
    children: Mapped[list["Taxonomy"]]   = relationship(back_populates="parent")
    corpora:  Mapped[list["CorpusToTaxonomy"]] = relationship(back_populates="taxonomy")


# ---------------------------------------------------------------------------
# Corpus
# ---------------------------------------------------------------------------

class Corpus(Base):
    """
    Canonical identity of a text — the Bible is one Corpus regardless of translation.
    Translation-specific data lives in CorpusVersion.
    """
    __tablename__ = "corpus"

    id:                Mapped[int]      = mapped_column(Integer, primary_key=True)
    name:              Mapped[str]      = mapped_column(Text, nullable=False, unique=True)
    description:       Mapped[str|None] = mapped_column(Text)
    language_of_origin: Mapped[str|None] = mapped_column(Text)
    extra_metadata:    Mapped[dict|None] = mapped_column("extra_metadata", JSON)

    versions:   Mapped[list["CorpusVersion"]]    = relationship(back_populates="corpus")
    levels:     Mapped[list["CorpusLevel"]]      = relationship(back_populates="corpus")
    taxonomies: Mapped[list["CorpusToTaxonomy"]] = relationship(back_populates="corpus")


class SourceRef(Base):
    """Canonical source record (URL/provider) shared by corpus versions."""
    __tablename__ = "source_ref"

    id:           Mapped[int] = mapped_column(Integer, primary_key=True)
    source_key:   Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    url:          Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    provider:     Mapped[str | None] = mapped_column(Text)
    label:        Mapped[str | None] = mapped_column(Text)
    created_at:   Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    extra_metadata: Mapped[dict | None] = mapped_column("extra_metadata", JSON)

    corpus_versions: Mapped[list["CorpusVersion"]] = relationship(back_populates="source_ref")


class CorpusToTaxonomy(Base):
    """Many-to-many bridge between Corpus and Taxonomy."""
    __tablename__ = "corpus_to_taxonomy"

    corpus_id:   Mapped[int] = mapped_column(Integer, ForeignKey("corpus.id"), primary_key=True)
    taxonomy_id: Mapped[int] = mapped_column(Integer, ForeignKey("taxonomy.id"), primary_key=True)

    corpus:   Mapped["Corpus"]   = relationship(back_populates="taxonomies")
    taxonomy: Mapped["Taxonomy"] = relationship(back_populates="corpora")


class CorpusVersion(Base):
    """
    A specific translation or edition of a Corpus.
    Bible KJV and Bible NIV share one Corpus but have separate CorpusVersions.
    Units belong to a CorpusVersion.
    """
    __tablename__ = "corpus_version"

    id:               Mapped[int]      = mapped_column(Integer, primary_key=True)
    corpus_id:        Mapped[int]      = mapped_column(Integer, ForeignKey("corpus.id"), nullable=False)
    source_id:        Mapped[int]      = mapped_column(Integer, ForeignKey("source_ref.id"), nullable=False)
    translation_name: Mapped[str|None] = mapped_column(Text)
    translator:       Mapped[str|None] = mapped_column(Text)
    language:         Mapped[str|None] = mapped_column(Text)
    date_added:       Mapped[datetime|None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    extra_metadata:   Mapped[dict|None] = mapped_column("extra_metadata", JSON)

    corpus: Mapped["Corpus"]        = relationship(back_populates="versions")
    source_ref: Mapped["SourceRef"] = relationship(back_populates="corpus_versions")
    units:  Mapped[list["Unit"]]    = relationship(back_populates="corpus_version")
    embedding_spans: Mapped[list["EmbeddingSpan"]] = relationship(back_populates="corpus_version")

    __table_args__ = (
        Index("ix_corpus_version_source_id", "source_id"),
    )


class CorpusLevel(Base):
    """
    Defines what each height value means within a corpus.
    Shared across all versions of the same corpus (KJV and NIV have the same levels).

    height=0 → Verse / Ayah / Tuk / Stanza  (the leaf — primary unit of analysis)
    height=1 → Chapter / Surah
    height=2 → Book / Juz
    ...
    """
    __tablename__ = "corpus_level"

    corpus_id: Mapped[int] = mapped_column(Integer, ForeignKey("corpus.id"), primary_key=True)
    height:    Mapped[int] = mapped_column(Integer, primary_key=True)
    name:      Mapped[str] = mapped_column(Text, nullable=False)

    corpus: Mapped["Corpus"] = relationship(back_populates="levels")


# ---------------------------------------------------------------------------
# Unit
# ---------------------------------------------------------------------------

class Unit(Base):
    """
    Every node in the text tree — verse, chapter, book, or any other level.

    Height and depth:
        depth  — distance from the corpus root downward (root node = 0)
        height — distance from the leaf upward (leaf/verse = 0)
        Both stored for query convenience; height is computed post-insert.

    corpus_id is denormalised from corpus_version for fast corpus-level queries.
    """
    __tablename__ = "unit"

    id:               Mapped[int]      = mapped_column(BigInteger, primary_key=True)
    corpus_version_id: Mapped[int]     = mapped_column(Integer, ForeignKey("corpus_version.id"), nullable=False)
    corpus_id:        Mapped[int]      = mapped_column(Integer, ForeignKey("corpus.id"), nullable=False)
    parent_id:        Mapped[int|None] = mapped_column(BigInteger, ForeignKey("unit.id"), nullable=True)

    depth:            Mapped[int]      = mapped_column(Integer, nullable=False)
    height:           Mapped[int|None] = mapped_column(Integer, nullable=True)

    reference_label:  Mapped[str|None] = mapped_column(Text)
    author:           Mapped[str|None] = mapped_column(Text)
    text:             Mapped[str|None] = mapped_column(Text)
    uncleaned_text:   Mapped[str|None] = mapped_column(Text)
    ancestor_path:    Mapped[str|None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    extra_metadata: Mapped[dict|None] = mapped_column("extra_metadata", JSON)

    corpus_version: Mapped["CorpusVersion"]  = relationship(back_populates="units")
    corpus:         Mapped["Corpus"]         = relationship()
    parent:         Mapped["Unit|None"]      = relationship(back_populates="children", remote_side="Unit.id")
    children:       Mapped[list["Unit"]]     = relationship(back_populates="parent")
    embeddings:     Mapped[list["Embedding"]] = relationship(back_populates="unit")
    span_links:      Mapped[list["EmbeddingSpanUnit"]] = relationship(back_populates="unit")

    __table_args__ = (
        Index("ix_unit_corpus_height",   "corpus_id", "height"),
        Index("ix_unit_corpus_version",  "corpus_version_id"),
        Index("ix_unit_parent",          "parent_id"),
    )


# ---------------------------------------------------------------------------
# Embeddings
# ---------------------------------------------------------------------------

class Method(Base):
    """
    Describes how a set of embeddings was generated.
    vector_dim is required because pgvector columns are fixed-width.
    """
    __tablename__ = "method"

    id:           Mapped[int]      = mapped_column(Integer, primary_key=True)
    model_name:   Mapped[str]      = mapped_column(Text, nullable=False)
    label:        Mapped[str]      = mapped_column(Text, nullable=False)
    description:  Mapped[str|None] = mapped_column(Text)
    vector_dim:   Mapped[int]      = mapped_column(Integer, nullable=False)
    extra_metadata: Mapped[dict|None] = mapped_column("extra_metadata", JSON)

    embeddings: Mapped[list["Embedding"]] = relationship(back_populates="method")
    span_embeddings: Mapped[list["SpanEmbedding"]] = relationship(back_populates="method")

    __table_args__ = (
        UniqueConstraint("model_name", "label", name="uq_method_model_label"),
    )


class Embedding(Base):
    """Vector embedding for a unit, generated by a specific method."""
    __tablename__ = "embedding"

    id:        Mapped[int] = mapped_column(BigInteger, primary_key=True)
    unit_id:   Mapped[int] = mapped_column(BigInteger, ForeignKey("unit.id"), nullable=False)
    method_id: Mapped[int] = mapped_column(Integer, ForeignKey("method.id"), nullable=False)
    vector:    Mapped[list[float]] = mapped_column(Vector, nullable=False)

    unit:   Mapped["Unit"]   = relationship(back_populates="embeddings")
    method: Mapped["Method"] = relationship(back_populates="embeddings")

    __table_args__ = (
        UniqueConstraint("unit_id", "method_id", name="uq_embedding_unit_method"),
        Index("ix_embedding_unit",   "unit_id"),
        Index("ix_embedding_method", "method_id"),
    )


class EmbeddingProfile(Base):
    """
    Segmentation profile used to derive normalized embedding spans.
    Example labels: window-50, window-100, window-200, window-500, window-1000.
    """
    __tablename__ = "embedding_profile"

    id:             Mapped[int]      = mapped_column(Integer, primary_key=True)
    label:          Mapped[str]      = mapped_column(Text, nullable=False, unique=True)
    target_tokens:  Mapped[int]      = mapped_column(Integer, nullable=False)
    overlap_tokens: Mapped[int]      = mapped_column(Integer, nullable=False)
    min_tokens:     Mapped[int]      = mapped_column(Integer, nullable=False)
    max_tokens:     Mapped[int]      = mapped_column(Integer, nullable=False)
    model_name:     Mapped[str]      = mapped_column(Text, nullable=False)
    created_at:     Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    extra_metadata: Mapped[dict|None] = mapped_column("extra_metadata", JSON)

    spans: Mapped[list["EmbeddingSpan"]] = relationship(back_populates="profile")

    __table_args__ = (
        Index("ix_embedding_profile_target_tokens", "target_tokens"),
    )


class EmbeddingSpan(Base):
    """
    Derived text span for embedding. A span may cover part of one unit, exactly one
    unit, or several adjacent tiny units inside a coherent structural boundary.
    """
    __tablename__ = "embedding_span"

    id:                Mapped[int]      = mapped_column(BigInteger, primary_key=True)
    corpus_version_id: Mapped[int]      = mapped_column(Integer, ForeignKey("corpus_version.id"), nullable=False)
    corpus_id:         Mapped[int]      = mapped_column(Integer, ForeignKey("corpus.id"), nullable=False)
    profile_id:        Mapped[int]      = mapped_column(Integer, ForeignKey("embedding_profile.id"), nullable=False)

    text:        Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, nullable=False)
    word_count:  Mapped[int] = mapped_column(Integer, nullable=False)
    char_count:  Mapped[int] = mapped_column(Integer, nullable=False)

    start_unit_id:     Mapped[int]      = mapped_column(BigInteger, ForeignKey("unit.id"), nullable=False)
    end_unit_id:       Mapped[int]      = mapped_column(BigInteger, ForeignKey("unit.id"), nullable=False)
    start_char_offset: Mapped[int|None] = mapped_column(Integer, nullable=True)
    end_char_offset:   Mapped[int|None] = mapped_column(Integer, nullable=True)
    reference_label:   Mapped[str|None] = mapped_column(Text)
    ancestor_path:     Mapped[str|None] = mapped_column(Text)
    created_at:        Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    extra_metadata:    Mapped[dict|None] = mapped_column("extra_metadata", JSON)

    corpus_version: Mapped["CorpusVersion"] = relationship(back_populates="embedding_spans")
    corpus:         Mapped["Corpus"]        = relationship()
    profile:        Mapped["EmbeddingProfile"] = relationship(back_populates="spans")
    start_unit:     Mapped["Unit"]          = relationship(foreign_keys=[start_unit_id])
    end_unit:       Mapped["Unit"]          = relationship(foreign_keys=[end_unit_id])
    unit_links:     Mapped[list["EmbeddingSpanUnit"]] = relationship(back_populates="span")
    embeddings:     Mapped[list["SpanEmbedding"]] = relationship(back_populates="span")

    __table_args__ = (
        Index("ix_embedding_span_profile", "profile_id"),
        Index("ix_embedding_span_corpus_profile", "corpus_id", "profile_id"),
        Index("ix_embedding_span_version_profile", "corpus_version_id", "profile_id"),
        Index("ix_embedding_span_start_unit", "start_unit_id"),
        Index("ix_embedding_span_end_unit", "end_unit_id"),
    )


class EmbeddingSpanUnit(Base):
    """Bridge from a derived embedding span back to the canonical units it covers."""
    __tablename__ = "embedding_span_unit"

    span_id:            Mapped[int]        = mapped_column(BigInteger, ForeignKey("embedding_span.id"), primary_key=True)
    unit_id:            Mapped[int]        = mapped_column(BigInteger, ForeignKey("unit.id"), primary_key=True)
    unit_order:         Mapped[int]        = mapped_column(Integer, nullable=False)
    char_start_in_unit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    char_end_in_unit:   Mapped[int | None] = mapped_column(Integer, nullable=True)
    coverage_weight:    Mapped[float]      = mapped_column(Float, nullable=False)

    span: Mapped["EmbeddingSpan"] = relationship(back_populates="unit_links")
    unit: Mapped["Unit"] = relationship(back_populates="span_links")

    __table_args__ = (
        Index("ix_embedding_span_unit_unit", "unit_id"),
        Index("ix_embedding_span_unit_span_order", "span_id", "unit_order"),
    )


class SpanEmbedding(Base):
    """Vector embedding for a normalized embedding span."""
    __tablename__ = "span_embedding"

    id:                Mapped[int] = mapped_column(BigInteger, primary_key=True)
    embedding_span_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("embedding_span.id"), nullable=False)
    method_id:         Mapped[int] = mapped_column(Integer, ForeignKey("method.id"), nullable=False)
    vector:            Mapped[list[float]] = mapped_column(Vector, nullable=False)

    span:   Mapped["EmbeddingSpan"] = relationship(back_populates="embeddings")
    method: Mapped["Method"] = relationship(back_populates="span_embeddings")

    __table_args__ = (
        UniqueConstraint("embedding_span_id", "method_id", name="uq_span_embedding_span_method"),
        Index("ix_span_embedding_span", "embedding_span_id"),
        Index("ix_span_embedding_method", "method_id"),
    )
