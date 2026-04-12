"""Parser for Digha Nikaya from Handful of Leaves EPUB."""

from pipeline.parsers.sutta_pitaka_common import NikayaSpec, parse_standard_nikaya


def parse_digha_nikaya(epub_path: str):
    return parse_standard_nikaya(
        epub_path,
        NikayaSpec(
            code="DN",
            corpus_name="Digha Nikaya",
            description="Long Discourses of the Buddha",
        ),
    )
