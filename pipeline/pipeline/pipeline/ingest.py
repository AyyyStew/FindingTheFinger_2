"""
ftf/pipeline/ingest.py

Writes a ParsedCorpus to the database.

Steps:
    1. Upsert Corpus (by name)
    2. Insert CorpusVersion
    3. Upsert CorpusLevels
    4. Insert Units (single pass, root-first; builds key→id + ancestor_path)
    5. Compute heights (bottom-up propagation)
    6. Wire taxonomy links (lookup by name, insert bridge rows)
"""

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from db.models import Corpus, CorpusLevel, CorpusToTaxonomy, CorpusVersion, Taxonomy, Unit
from db.session import get_session
from pipeline.parsers.base import ParsedCorpus


def ingest(parsed: ParsedCorpus, session: Session | None = None) -> CorpusVersion:
    """
    Persist a ParsedCorpus to the DB. Returns the created CorpusVersion.
    If a session is provided it is used as-is (caller commits); otherwise
    a new session is opened and committed here.
    """
    if session is not None:
        return _ingest(parsed, session)

    with get_session() as s:
        result = _ingest(parsed, s)
        s.commit()
        s.refresh(result)
        s.expunge(result)
        return result


def _ingest(parsed: ParsedCorpus, session: Session) -> CorpusVersion:
    print(f"[ingest] corpus: {parsed.name!r}")

    # ------------------------------------------------------------------
    # 1. Corpus
    # ------------------------------------------------------------------
    corpus = session.execute(
        select(Corpus).where(Corpus.name == parsed.name)
    ).scalar_one_or_none()

    if corpus is None:
        corpus = Corpus(
            name=parsed.name,
            description=parsed.description,
            language_of_origin=parsed.language_of_origin,
        )
        session.add(corpus)
        session.flush()
        print(f"  created corpus id={corpus.id}")
    else:
        print(f"  found existing corpus id={corpus.id}")

    # ------------------------------------------------------------------
    # 2. CorpusVersion — skip if already ingested
    # ------------------------------------------------------------------
    existing_version = session.execute(
        select(CorpusVersion).where(
            CorpusVersion.corpus_id == corpus.id,
            CorpusVersion.translation_name == parsed.translation_name,
        )
    ).scalar_one_or_none()

    if existing_version is not None:
        print(f"  corpus_version already exists (id={existing_version.id}, {parsed.translation_name!r}) — skipping")
        return existing_version

    version = CorpusVersion(
        corpus_id=corpus.id,
        translation_name=parsed.translation_name,
        translator=parsed.translator,
        language=parsed.language,
        source=parsed.source,
    )
    session.add(version)
    session.flush()
    print(f"  created corpus_version id={version.id} ({parsed.translation_name or 'no translation name'})")

    # ------------------------------------------------------------------
    # 3. CorpusLevels (upsert by corpus_id + height)
    # ------------------------------------------------------------------
    for lvl in parsed.levels:
        existing = session.execute(
            select(CorpusLevel).where(
                CorpusLevel.corpus_id == corpus.id,
                CorpusLevel.height == lvl.height,
            )
        ).scalar_one_or_none()
        if existing is None:
            session.add(CorpusLevel(corpus_id=corpus.id, height=lvl.height, name=lvl.name))
    session.flush()
    print(f"  upserted {len(parsed.levels)} corpus levels")

    # ------------------------------------------------------------------
    # 4. Units — single pass, root-first
    # ------------------------------------------------------------------
    key_to_id:   dict[str, int] = {}
    key_to_path: dict[str, str] = {}  # for building ancestor_path

    print(f"  inserting {len(parsed.units)} units...")
    for i, pu in enumerate(parsed.units):
        parent_id   = key_to_id.get(pu.parent_key) if pu.parent_key else None
        parent_path = key_to_path.get(pu.parent_key, "") if pu.parent_key else ""
        ancestor_path = f"{parent_path}/{pu.reference_label or pu.key}"

        unit = Unit(
            corpus_id=corpus.id,
            corpus_version_id=version.id,
            parent_id=parent_id,
            depth=pu.depth,
            height=None,  # computed in step 5
            reference_label=pu.reference_label,
            author=pu.author,
            text=pu.text,
            uncleaned_text=pu.uncleaned_text,
            ancestor_path=ancestor_path,
            source=parsed.source,
            extra_metadata=pu.extra_metadata or None,
        )
        session.add(unit)
        session.flush()

        key_to_id[pu.key]   = unit.id
        key_to_path[pu.key] = ancestor_path

        if (i + 1) % 5000 == 0:
            print(f"    {i + 1}/{len(parsed.units)}")

    print(f"  units inserted")

    # ------------------------------------------------------------------
    # 5. Heights — bottom-up propagation (same approach as v2)
    # ------------------------------------------------------------------
    _compute_heights(session, corpus.id)

    # ------------------------------------------------------------------
    # 6. Taxonomy links
    # ------------------------------------------------------------------
    if parsed.taxonomy_hints:
        _wire_taxonomy(session, corpus.id, parsed.taxonomy_hints)

    return version


def _compute_heights(session: Session, corpus_id: int) -> None:
    print("  computing heights...")

    session.execute(text("""
        UPDATE unit SET height = 0
        WHERE corpus_id = :cid
          AND id NOT IN (
              SELECT DISTINCT parent_id FROM unit
              WHERE parent_id IS NOT NULL AND corpus_id = :cid
          )
    """), {"cid": corpus_id})

    while True:
        result = session.execute(text("""
            UPDATE unit SET height = sub.h
            FROM (
                SELECT parent_id AS id, MAX(height) + 1 AS h
                FROM unit
                WHERE corpus_id = :cid AND height IS NOT NULL
                GROUP BY parent_id
            ) sub
            WHERE unit.id = sub.id
              AND unit.corpus_id = :cid
              AND unit.height IS NULL
        """), {"cid": corpus_id})
        if result.rowcount == 0:
            break

    nulls = session.execute(
        text("SELECT COUNT(*) FROM unit WHERE corpus_id = :cid AND height IS NULL"),
        {"cid": corpus_id},
    ).scalar()
    if nulls:
        print(f"  WARNING: {nulls} units still have NULL height")
    else:
        print("  heights OK")


def _wire_taxonomy(session: Session, corpus_id: int, hints: list[str]) -> None:
    for name in hints:
        node = session.execute(
            select(Taxonomy).where(Taxonomy.name == name)
        ).scalar_one_or_none()
        if node is None:
            print(f"  WARNING: taxonomy node {name!r} not found, skipping")
            continue

        exists = session.execute(
            select(CorpusToTaxonomy).where(
                CorpusToTaxonomy.corpus_id == corpus_id,
                CorpusToTaxonomy.taxonomy_id == node.id,
            )
        ).scalar_one_or_none()
        if exists is None:
            session.add(CorpusToTaxonomy(corpus_id=corpus_id, taxonomy_id=node.id))

    session.flush()
    print(f"  taxonomy links wired for: {hints}")
