"""
webapp/backend/deps.py

FastAPI dependency for database sessions.
"""
from typing import Generator

from sqlalchemy.orm import Session

from db.session import get_engine


def get_db() -> Generator[Session, None, None]:
    session = Session(get_engine())
    try:
        yield session
    finally:
        session.close()
