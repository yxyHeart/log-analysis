import logging
import re

from app.models.schemas import LLMConfig

logger = logging.getLogger(__name__)

INTENT_RULES = {
    "error_lookup": [r"\bexception\b", r"\berror\b", r"\bfailure\b", r"\bstack\s*trace\b"],
    "service_chain": [r"->", r"→", r"\bcalls?\b", r"\bchain\b", r"\bupstream\b", r"\bdownstream\b"],
    "category_browse": [r"\btimeout\b", r"\boom\b", r"\bconnection\b", r"\bconfig\b", r"\bauth\b"],
    "symptom_match": [r"\bslow\b", r"\blag\b", r"\bspike\b", r"\bexhausted\b", r"\bfailing\b"],
}


def _rule_based_intent(query: str) -> str:
    query_lower = query.lower()
    best_intent = "general"
    best_count = 0
    for intent, patterns in INTENT_RULES.items():
        count = sum(1 for p in patterns if re.search(p, query_lower))
        if count > best_count:
            best_count = count
            best_intent = intent
    return best_intent


def _extract_filters_from_query(query: str) -> dict:
    """Extract structured filters from the query text."""
    filters = {}
    from app.services.metadata_extractor import extract_affected_services, extract_error_type

    services = extract_affected_services(query)
    if services:
        filters["affected_services"] = services

    error = extract_error_type(query)
    if error:
        filters["error_type"] = error

    return filters


def _classify_intent_llm(query: str, config: LLMConfig) -> dict:
    """Use LLM to classify query intent and extract filters."""
    import json
    import httpx

    prompt = f"""Given this root cause analysis query, classify its intent and extract structured filters.

Intent categories: error_lookup, service_chain, category_browse, symptom_match, general

Query: {query}

Respond in JSON only:
{{"intent": "...", "filters": {{"affected_services": [...], "root_cause_category": "...", "error_type": "...", "severity": "..."}}}}"""

    try:
        if config.provider == "openai":
            base = (config.base_url or "https://api.openai.com/v1").rstrip("/")
            url = f"{base}/chat/completions"
            model = config.model or "gpt-4o-mini"
            resp = httpx.post(
                url,
                headers={"Authorization": f"Bearer {config.api_key}"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "You are a query analysis agent for a root cause analysis RAG system."},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.1,
                    "max_tokens": 200,
                },
                timeout=10.0,
            )
            resp.raise_for_status()
            raw = resp.json()["choices"][0]["message"]["content"]
        else:
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
                    "system": "You are a query analysis agent for a root cause analysis RAG system.",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.1,
                },
                timeout=10.0,
            )
            resp.raise_for_status()
            raw = resp.json()["content"][0]["text"]

        return json.loads(raw)
    except Exception:
        logger.warning("LLM intent classification failed, falling back to rules", exc_info=True)
        return {"intent": _rule_based_intent(query), "filters": _extract_filters_from_query(query)}


def query_analysis_node(state: dict) -> dict:
    """Query analysis: intent classification + query rewriting + filter extraction."""
    query = state["query"]
    llm_config = state.get("llm_config")
    rewrite_attempts = state.get("rewrite_attempts", 0)

    updates = {"pipeline_steps": state.get("pipeline_steps", []) + ["query_analysis"]}

    # Classify intent
    if llm_config and llm_config.api_key:
        result = _classify_intent_llm(query, llm_config)
        updates["query_intent"] = result.get("intent", _rule_based_intent(query))
        extracted = result.get("filters", {})
    else:
        updates["query_intent"] = _rule_based_intent(query)
        extracted = _extract_filters_from_query(query)

    # Merge with metadata_filters from request
    request_filters = state.get("metadata_filters") or {}
    merged_filters = {**request_filters, **extracted}
    updates["extracted_filters"] = merged_filters

    # Generate rewritten queries
    if rewrite_attempts > 0:
        # Aggressive rewrite on retry — broaden scope
        updates["rewritten_queries"] = _generate_retry_queries(query, updates["query_intent"])
    else:
        updates["rewritten_queries"] = [query]

    return updates


def _generate_retry_queries(original: str, intent: str) -> list[str]:
    """Generate broader/rephrased queries for retry after poor retrieval."""
    queries = [original]

    # Add a simplified version (remove specific details)
    simplified = re.sub(r'\b[\w.-]+Exception\b', 'exception', original, flags=re.IGNORECASE)
    simplified = re.sub(r'\b[\w.-]+-service\b', 'service', simplified, flags=re.IGNORECASE)
    if simplified != original:
        queries.append(simplified)

    # Add a category-focused version
    if intent != "general":
        queries.append(f"{intent} incident root cause")

    return queries
