"""
ftf/db/session.py

Engine and session factory.
DATABASE_URL is read from the environment (or a .env file).

Usage:
    from ftf.db.session import get_session

    with get_session() as session:
        session.add(...)
        session.commit()
"""

import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

load_dotenv()

_DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql+psycopg://ftf:ftf@localhost:5432/ftf")

_engine = create_engine(_DATABASE_URL, echo=False)


def get_engine():
    return _engine


def get_session() -> Session:
    return Session(_engine)
