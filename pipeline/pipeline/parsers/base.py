"""
ftf/parsers/base.py

Parser contract — the dataclasses every parser must return.
Ingest (ftf/pipeline/ingest.py) is the only consumer; parsers have no DB knowledge.

Flow:
    Parser  →  ParsedCorpus  →  ingest.py  →  DB

Tree representation:
    Each ParsedUnit carries a `key` (unique within this corpus version) and a
    `parent_key` (None for root nodes). Ingest builds a key→unit.id map as it
    inserts, so parents must appear before their children in the `units` list.
"""

from dataclasses import dataclass, field


@dataclass
class ParsedLevel:
    """Maps a height value to its human name for this corpus."""
    height: int    # 0 = leaf (verse/ayah/tuk), 1 = chapter, 2 = book, ...
    name: str      # e.g. "Verse", "Chapter", "Book", "Testament"


@dataclass
class ParsedUnit:
    """
    A single node in the text tree.

    key         — unique string within this corpus version; used to wire up
                  parent/child relationships without DB ids.
                  Use a natural identifier: "Genesis", "Genesis 1", "Genesis 1:1"

    parent_key  — key of the parent unit; None for root nodes (books, top-level sections).

    depth       — distance from corpus root (root node = 0).
                  Heights are computed post-insert by the pipeline, not by parsers.

    text        — cleaned, canonical text. None for non-leaf nodes (chapters, books)
                  that don't carry prose themselves.

    uncleaned_text — raw text preserved exactly as it appeared in the source.
                     Set to None if the source was already clean.

    author      — optional attribution string ("Guru Nanak Dev Ji", "John", "Unknown").
                  May be set at any level — a whole book, a chapter, or a single verse.
    """
    key:            str
    parent_key:     str | None
    depth:          int
    reference_label: str | None = None
    text:           str | None  = None
    uncleaned_text: str | None  = None
    author:         str | None  = None
    extra_metadata: dict        = field(default_factory=dict)


@dataclass
class ParsedCorpus:
    """
    The full output of a parser — everything needed to write one corpus version to the DB.

    taxonomy_hints  — ordered list of taxonomy node names the corpus should be linked to.
                      Ingest will look these up by name and create the bridge rows.
                      e.g. ["Abrahamic", "Christianity"]
                      Leave empty if taxonomy links will be added manually.

    units           — flat list ordered root-first (parents before children).
                      Ingest does a single pass; a parent must appear before its children.
    """
    # Corpus identity
    name:               str
    description:        str | None = None
    language_of_origin: str | None = None

    # Translation / edition
    translation_name:   str | None = None
    translator:         str | None = None
    language:           str | None = None
    source:             str | None = None

    # Hierarchy definition — one entry per level
    levels:             list[ParsedLevel] = field(default_factory=list)

    # Text content — ordered root-first
    units:              list[ParsedUnit]  = field(default_factory=list)

    # Taxonomy wiring
    taxonomy_hints:     list[str]         = field(default_factory=list)
