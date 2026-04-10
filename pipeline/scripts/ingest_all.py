#!/usr/bin/env python3
"""
scripts/ingest_all.py

Canonical ingestion script. Run this to populate the database from scratch.

Steps:
    1. Seed the taxonomy tree (idempotent)
    2. Ingest each corpus in order (skips already-ingested translation versions)

Usage:
    .venv/bin/python3 scripts/ingest_all.py

Notes:
    - Safe to re-run; existing corpus versions are skipped automatically.
    - To re-ingest a corpus, delete its corpus_version row (and associated
      units) from the DB first, then re-run.
    - Bible was previously ingested as a single "Bible" corpus. If upgrading
      from that schema, delete the old corpus before running:
          DELETE FROM unit WHERE corpus_id = (SELECT id FROM corpus WHERE name = 'Bible');
          DELETE FROM corpus WHERE name = 'Bible';
"""

import sys
from functools import partial
from pathlib import Path

# Run from project root or any directory
_pipeline_root = str(Path(__file__).parent.parent)
_repo_root = str(Path(__file__).parent.parent.parent)
for _p in (_pipeline_root, _repo_root):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from db.seed_taxonomy import seed_taxonomy
from pipeline.pipeline.ingest import ingest

from pipeline.parsers.bible import parse_old_testament, parse_new_testament
from pipeline.parsers.quran import parse_quran
from pipeline.parsers.gita import parse_gita
from pipeline.parsers.bhagavatam import parse_bhagavatam
from pipeline.parsers.upanishads import parse_upanishads
from pipeline.parsers.yoga_sutras import parse_yoga_sutras
from pipeline.parsers.dhammapada import parse_dhammapada
from pipeline.parsers.diamond_sutra import parse_diamond_sutra
from pipeline.parsers.jataka import parse_jataka
from pipeline.parsers.sggs import parse_sggs
from pipeline.parsers.dao_de_jing import parse_dao_de_jing
from pipeline.parsers.chuang_tzu import parse_chuang_tzu
from pipeline.parsers.analects import parse_analects
from pipeline.parsers.kojiki import parse_kojiki
from pipeline.parsers.poetic_edda import parse_poetic_edda
from pipeline.parsers.yasna import parse_yasna
from pipeline.parsers.vendidad import parse_vendidad

RAW = Path(__file__).parent.parent.parent / "data"

# Each entry is a zero-argument callable that returns a ParsedCorpus.
# Use functools.partial to bind file paths.
CORPORA = [
    # ── Abrahamic ──────────────────────────────────────────────────────────
    partial(parse_old_testament, "KJV", str(RAW / "Abrahamic/Christian/Bibles/KJV.db")),
    partial(parse_new_testament, "KJV", str(RAW / "Abrahamic/Christian/Bibles/KJV.db")),
    partial(parse_quran,               str(RAW / "Abrahamic/Islamic/The Quran Dataset.csv")),

    # ── Indic (Dharmic) ────────────────────────────────────────────────────
    partial(parse_gita,          str(RAW / "Indic_Dharmic/Hindu/bhagavad_gita_verses.csv")),
    partial(parse_bhagavatam,    str(RAW / "Indic_Dharmic/Hindu/Srimad_Bhagavatam_Data.csv")),
    partial(parse_upanishads,    str(RAW / "Indic_Dharmic/Hindu/upanishads.txt")),
    partial(parse_yoga_sutras,   str(RAW / "Indic_Dharmic/Hindu/yoga_sutras_of_patanjali.txt")),
    partial(parse_dhammapada,    str(RAW / "Indic_Dharmic/Buddhist/dhammapada.txt")),
    partial(parse_diamond_sutra, str(RAW / "Indic_Dharmic/Buddhist/diamond_sutra.txt")),
    partial(parse_jataka,        str(RAW / "Indic_Dharmic/Buddhist/jataka_tales.txt")),
    partial(parse_sggs,          str(RAW / "Indic_Dharmic/Sikhism/sggs/gurbanidb.sqlite")),

    # ── East Asian ─────────────────────────────────────────────────────────
    partial(parse_dao_de_jing, str(RAW / "East Asian/Taoism/dao_de_ching.html")),
    partial(parse_chuang_tzu,  str(RAW / "East Asian/Taoism/chuang_tzu.txt")),
    partial(parse_analects,    str(RAW / "East Asian/Confucianism/analects_confucian.txt")),
    partial(parse_kojiki,      str(RAW / "East Asian/Shinto/kojiki")),

    # ── Ancient / Historical ───────────────────────────────────────────────
    partial(parse_poetic_edda, str(RAW / "Historical_Ancient/Germanic/poetic_eda.txt")),

    # ── Persian ────────────────────────────────────────────────────────────
    partial(parse_yasna,    str(RAW / "Iranian_Persian/Zoroastrianism/AVESTA_ YASNA_ (English).html")),
    partial(parse_vendidad, str(RAW / "Iranian_Persian/Zoroastrianism/vendidad.epub")),
]


def main() -> None:
    print("=" * 60)
    print("  FtF Ingestion Pipeline")
    print("=" * 60)

    print("\n[step 1] Seeding taxonomy tree...")
    seed_taxonomy()

    print(f"\n[step 2] Ingesting {len(CORPORA)} corpora...\n")
    for i, parse_fn in enumerate(CORPORA, start=1):
        print(f"── [{i}/{len(CORPORA)}] {parse_fn.func.__name__} ──")
        try:
            parsed = parse_fn()
            ingest(parsed)
        except Exception as e:
            print(f"  ERROR: {e}")
            raise
        print()

    print("=" * 60)
    print("  Done.")
    print("=" * 60)


if __name__ == "__main__":
    main()
