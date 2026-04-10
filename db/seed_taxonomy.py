"""
ftf/db/seed_taxonomy.py

Seeds the taxonomy tree. Idempotent — nodes that already exist are skipped.

The tree is defined as a flat list of (name, parent_name) pairs processed
in order, so parents must appear before their children.

Usage:
    from ftf.db.seed_taxonomy import seed_taxonomy
    seed_taxonomy()
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from db.models import Taxonomy
from db.session import get_session

# (name, parent_name or None)
# Order matters: parents must precede children.
_NODES: list[tuple[str, str | None]] = [
    # ── Roots ──────────────────────────────────────────────────────────────
    ("Abrahamic",              None),
    ("Indic (Dharmic)",        None),
    ("East Asian",             None),
    ("Persian",                None),
    ("Indigenous",             None),
    ("Ancient / Historical",   None),
    ("New Religious Movements", None),
    ("Other (Sacred)",         None),
    ("Non Sacred",             None),

    # ── Abrahamic ──────────────────────────────────────────────────────────
    ("Judaism",      "Abrahamic"),
    ("Christianity", "Abrahamic"),
    ("Islam",        "Abrahamic"),

    # ── Indic (Dharmic) ────────────────────────────────────────────────────
    ("Hinduism", "Indic (Dharmic)"),
    ("Buddhism", "Indic (Dharmic)"),
    ("Jainism",  "Indic (Dharmic)"),
    ("Sikhism",  "Indic (Dharmic)"),

    # ── East Asian ─────────────────────────────────────────────────────────
    ("Taoism",        "East Asian"),
    ("Confucianism",  "East Asian"),
    ("Shinto",        "East Asian"),
    ("Zen",           "East Asian"),

    # ── Persian ────────────────────────────────────────────────────────────
    ("Zoroastrianism", "Persian"),

    # ── Indigenous ─────────────────────────────────────────────────────────
    ("North American",      "Indigenous"),
    ("Mesoamerican",        "Indigenous"),
    ("South American",      "Indigenous"),
    ("African",             "Indigenous"),
    ("Oceanian",            "Indigenous"),
    ("Aboriginal Australian", "Indigenous"),

    # ── Ancient / Historical (defunct traditions) ──────────────────────────
    ("Greek",          "Ancient / Historical"),
    ("Roman",          "Ancient / Historical"),
    ("Egyptian",       "Ancient / Historical"),
    ("Mesopotamian",   "Ancient / Historical"),
    ("Norse / Germanic", "Ancient / Historical"),
    ("Celtic",         "Ancient / Historical"),

    # ── New Religious Movements ────────────────────────────────────────────
    ("Scientology",              "New Religious Movements"),
    ("Bahá'í",                   "New Religious Movements"),
    ("Neo-Paganism / Wicca",     "New Religious Movements"),
    ("Other modern movements",   "New Religious Movements"),

    # ── Non Sacred ─────────────────────────────────────────────────────────
    ("Philosophy",  "Non Sacred"),
    ("Scientific",  "Non Sacred"),
    ("Literature",  "Non Sacred"),
    ("Plays",       "Non Sacred"),
    ("Speeches",    "Non Sacred"),
    ("Historical",  "Non Sacred"),
]


def seed_taxonomy(session: Session | None = None) -> None:
    if session is not None:
        _seed(session)
        return

    with get_session() as s:
        _seed(s)
        s.commit()


def _seed(session: Session) -> None:
    name_to_id: dict[str, int] = {}
    created = 0

    for name, parent_name in _NODES:
        existing = session.execute(
            select(Taxonomy).where(Taxonomy.name == name)
        ).scalar_one_or_none()

        if existing is not None:
            name_to_id[name] = existing.id
            continue

        parent_id = name_to_id[parent_name] if parent_name else None
        level = 0 if parent_name is None else (
            session.get(Taxonomy, parent_id).level + 1
        )

        node = Taxonomy(name=name, parent_id=parent_id, level=level)
        session.add(node)
        session.flush()

        name_to_id[name] = node.id
        created += 1

    print(f"[seed_taxonomy] {created} nodes created, {len(_NODES) - created} already existed")


if __name__ == "__main__":
    seed_taxonomy()
    print("done")
