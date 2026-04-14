from __future__ import annotations

import sys
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import torch
from sqlalchemy.orm import Session
from tqdm import tqdm


@dataclass(frozen=True)
class EmbeddingItem:
    id: int
    text: str
    token_cost: int


AddEmbedding = Callable[[Session, int, Any], None]


def select_device(requested: str | None) -> str:
    if requested:
        return requested
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def estimate_token_cost(text: str) -> int:
    return max(1, int(len(text.split()) * 1.3))


def make_embedding_items(items: list[tuple[int, str]]) -> list[EmbeddingItem]:
    return [
        EmbeddingItem(id=item_id, text=text, token_cost=estimate_token_cost(text))
        for item_id, text in items
    ]


def _initial_token_budget(items: list[EmbeddingItem], batch_size: int) -> int:
    sample = items[:batch_size]
    if not sample:
        return 1
    return max(1, sum(item.token_cost for item in sample))


def _next_batch(
    items: list[EmbeddingItem],
    start: int,
    max_items: int,
    token_budget: int,
) -> list[EmbeddingItem]:
    batch: list[EmbeddingItem] = []
    batch_tokens = 0

    for item in items[start:]:
        would_exceed_items = len(batch) >= max_items
        would_exceed_tokens = batch and batch_tokens + item.token_cost > token_budget
        if would_exceed_items or would_exceed_tokens:
            break
        batch.append(item)
        batch_tokens += item.token_cost

    return batch or [items[start]]


def _clear_cuda_cache() -> None:
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def embed_items_adaptive(
    *,
    session: Session,
    items: list[tuple[int, str]],
    model_name: str,
    batch_size: int,
    dry_run: bool,
    device: str,
    description: str,
    add_embedding: AddEmbedding,
    max_seq_length: int = 8192,
    recover_after_base: int = 5,
) -> None:
    prepared = make_embedding_items(items)
    prepared.sort(key=lambda item: (item.token_cost, len(item.text)), reverse=True)

    print(f"{description} to embed: {len(prepared):,}", file=sys.stderr)
    if dry_run or not prepared:
        return

    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(model_name, trust_remote_code=True, device=device)
    model.max_seq_length = max_seq_length

    target_items = max(1, batch_size)
    target_tokens = _initial_token_budget(prepared, target_items)
    current_items = target_items
    current_tokens = target_tokens
    clean_streak = 0
    recover_after = recover_after_base
    inserted = 0
    start = 0

    with tqdm(total=len(prepared), desc=description, unit="item", file=sys.stderr) as progress:
        while start < len(prepared):
            batch = _next_batch(prepared, start, current_items, current_tokens)
            batch_tokens = sum(item.token_cost for item in batch)
            batch_texts = [item.text for item in batch]

            try:
                vecs = model.encode(
                    batch_texts,
                    batch_size=min(current_items, len(batch_texts)),
                    show_progress_bar=False,
                    normalize_embeddings=True,
                )
            except torch.OutOfMemoryError:
                clean_streak = 0
                recover_after = min(recover_after * 2, 64)
                _clear_cuda_cache()

                if len(batch) == 1 and current_items == 1:
                    item = batch[0]
                    tqdm.write(
                        f"OOM on single item id={item.id}; skipping it.",
                        file=sys.stderr,
                    )
                    start += 1
                    progress.update(1)
                    continue

                new_items = max(1, current_items // 2)
                new_tokens = max(1, current_tokens // 2)
                tqdm.write(
                    "OOM - reducing batch limits "
                    f"items {current_items}->{new_items}, "
                    f"tokens {current_tokens}->{new_tokens} "
                    f"(next recovery threshold: {recover_after})",
                    file=sys.stderr,
                )
                current_items = new_items
                current_tokens = new_tokens
                continue

            for item, vec in zip(batch, vecs):
                add_embedding(session, item.id, vec)
            session.commit()

            inserted += len(batch)
            start += len(batch)
            clean_streak += 1
            progress.update(len(batch))
            progress.set_postfix(
                inserted=inserted,
                batch=len(batch),
                max_items=current_items,
                token_budget=current_tokens,
                batch_tokens=batch_tokens,
            )

            if clean_streak >= recover_after and (
                current_items < target_items or current_tokens < target_tokens
            ):
                new_items = min(target_items, max(current_items + 1, current_items * 2))
                new_tokens = min(target_tokens, max(current_tokens + 1, current_tokens * 2))
                tqdm.write(
                    f"{recover_after} clean batches - recovering limits "
                    f"items {current_items}->{new_items}, "
                    f"tokens {current_tokens}->{new_tokens}",
                    file=sys.stderr,
                )
                current_items = new_items
                current_tokens = new_tokens
                clean_streak = 0
                if current_items == target_items and current_tokens == target_tokens:
                    recover_after = recover_after_base

    print(f"{description} done. Inserted {inserted:,} embeddings.", file=sys.stderr)
