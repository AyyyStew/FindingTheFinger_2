"""Parser for Khuddaka Nikaya from Handful of Leaves EPUB."""

from pipeline.parsers.sutta_pitaka_common import parse_khuddaka_nikaya as _parse


def parse_khuddaka_nikaya(epub_path: str):
    return _parse(epub_path)
