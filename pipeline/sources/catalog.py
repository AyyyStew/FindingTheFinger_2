"""Compatibility shim forwarding to canonical source catalog implementation."""

from pipeline.pipeline.sources.catalog import SourceCatalogEntry, get_source_entry

__all__ = ["SourceCatalogEntry", "get_source_entry"]
