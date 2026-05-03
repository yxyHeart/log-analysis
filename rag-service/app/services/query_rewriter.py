import json
import logging

import httpx

from app.models.schemas import LLMConfig

logger = logging.getLogger(__name__)

REWRITE_SYSTEM_PROMPT = """You are a search query optimizer for a RAG (Retrieval-Augmented Generation) system.
Given a user query, produce:
1. A "rewritten" version optimized for keyword search (extract key terms, remove filler words)
2. Two "variants" — alternative phrasings that might match different documents

Respond in JSON only:
{"rewritten": "...", "variants": ["...", "..."]}"""


def _call_openai(config: LLMConfig, prompt: str) -> str:
    base = (config.base_url or "https://api.openai.com/v1").rstrip("/")
    url = f"{base}/chat/completions"
    model = config.model or "gpt-4o-mini"
    resp = httpx.post(
        url,
        headers={"Authorization": f"Bearer {config.api_key}"},
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": REWRITE_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.3,
            "max_tokens": 200,
        },
        timeout=15.0,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def _call_anthropic(config: LLMConfig, prompt: str) -> str:
    base = (config.base_url or "https://api.anthropic.com").rstrip("/")
    url = f"{base}/v1/messages"
    model = config.model or "claude-haiku-4-5-20251001"
    resp = httpx.post(
        url,
        headers={
            "x-api-key": config.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": model,
            "max_tokens": 200,
            "system": REWRITE_SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
        },
        timeout=15.0,
    )
    resp.raise_for_status()
    return resp.json()["content"][0]["text"]


def rewrite_and_expand(query: str, config: LLMConfig | None = None) -> list[str]:
    """
    Rewrite query for better retrieval and generate search variants.
    Returns list of query strings. Falls back to [original] on failure.
    """
    if not config or not config.api_key:
        return [query]

    try:
        prompt = f"Original query: {query}"
        if config.provider == "openai":
            raw = _call_openai(config, prompt)
        else:
            raw = _call_anthropic(config, prompt)

        parsed = json.loads(raw)
        rewritten = parsed.get("rewritten", query)
        variants = parsed.get("variants", [])
        result = [query, rewritten] + [v for v in variants if v != rewritten]
        # Deduplicate while preserving order
        seen = set()
        unique = []
        for q in result:
            if q not in seen:
                seen.add(q)
                unique.append(q)
        return unique
    except Exception:
        logger.warning("Query rewriting failed, using original query", exc_info=True)
        return [query]
