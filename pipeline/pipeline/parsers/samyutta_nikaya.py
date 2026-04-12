"""Parser for Samyutta Nikaya from Handful of Leaves EPUB."""

from pipeline.parsers.sutta_pitaka_common import NikayaSpec, parse_standard_nikaya


def parse_samyutta_nikaya(epub_path: str):
    return parse_standard_nikaya(
        epub_path,
        NikayaSpec(
            code="SN",
            corpus_name="Samyutta Nikaya",
            description="Connected Discourses of the Buddha",
        ),
    )
