"""
ftf/db/models.py

SQLAlchemy ORM models for the Finding The Finger database (v3).

Table overview:
    taxonomy          — hierarchical classification tree (Abrahamic > Judaism, etc.)
    corpus            — canonical text identity (Bible, Quran, etc.)
    corpus_to_taxonomy — many-to-many bridge between corpus and taxonomy
    corpus_version    — a specific translation/edition of a corpus (Bible KJV, Bible NIV)
    corpus_level      — defines what each height means for a corpus (0=Verse, 1=Chapter, ...)
    unit              — every node in the text tree (verse, chapter, book, etc.)
    method            — describes how an embedding was generated
    embedding         — vector embedding tied to a unit + method
"""

from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger, DateTime, ForeignKey, Index, Integer, Text, JSON,
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
    translation_name: Mapped[str|None] = mapped_column(Text)
    translator:       Mapped[str|None] = mapped_column(Text)
    language:         Mapped[str|None] = mapped_column(Text)
    source:           Mapped[str|None] = mapped_column(Text)
    date_added:       Mapped[datetime|None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    extra_metadata:   Mapped[dict|None] = mapped_column("extra_metadata", JSON)

    corpus: Mapped["Corpus"]     = relationship(back_populates="versions")
    units:  Mapped[list["Unit"]] = relationship(back_populates="corpus_version")


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
    source:           Mapped[str|None] = mapped_column(Text)
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
