import json
import logging

import httpx

from app.models.schemas import LLMConfig

logger = logging.getLogger(__name__)

ASSERTION_EXTRACTION_PROMPT = """Given the following retrieved context and a query, extract atomic assertions (factual claims) from the context that are relevant to the query.
Each assertion should be a single, verifiable statement.

Context:
{context}

Query: {query}

Respond in JSON only:
{{"assertions": [{{"claim": "...", "source_chunk_index": N}}, ...]}}"""

ASSERTION_VERIFICATION_PROMPT = """Given the following assertion and a set of relevant ground-truth documents, determine if the assertion is:
- "supported": clearly supported by ground truth
- "contradicted": contradicted by ground truth
- "unverifiable": cannot be verified from ground truth alone

Assertion: {assertion}

Ground truth:
{ground_truth}

Respond in JSON only:
{{"verdict": "supported" | "contradicted" | "unverifiable", "reason": "..."}}"""

GROUND_TRUTH_ASSERTION_PROMPT = """Given the following ground-truth answer, decompose it into atomic assertions (factual claims).
Each assertion should be a single, verifiable statement.

Ground truth answer:
{answer}

Respond in JSON only:
{{"assertions": [{{"claim": "..."}}, ...]}}"""


def _call_llm(config: LLMConfig, prompt: str) -> str:
    """Call LLM with the given prompt."""
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
                    {"role": "system", "content": "You are an assertion extraction and verification agent."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.1,
                "max_tokens": 500,
            },
            timeout=15.0,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]
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
                "max_tokens": 500,
                "system": "You are an assertion extraction and verification agent.",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1,
            },
            timeout=15.0,
        )
        resp.raise_for_status()
        return resp.json()["content"][0]["text"]


def extract_assertions_from_context(
    context: str, query: str, config: LLMConfig
) -> list[dict]:
    """Extract atomic assertions from retrieved context."""
    prompt = ASSERTION_EXTRACTION_PROMPT.format(context=context[:3000], query=query)
    try:
        raw = _call_llm(config, prompt)
        parsed = json.loads(raw)
        return parsed.get("assertions", [])
    except Exception:
        logger.warning("Assertion extraction failed", exc_info=True)
        return []


def extract_assertions_from_ground_truth(
    answer: str, config: LLMConfig
) -> list[dict]:
    """Extract atomic assertions from ground-truth answer."""
    prompt = GROUND_TRUTH_ASSERTION_PROMPT.format(answer=answer[:2000])
    try:
        raw = _call_llm(config, prompt)
        parsed = json.loads(raw)
        return parsed.get("assertions", [])
    except Exception:
        logger.warning("Ground truth assertion extraction failed", exc_info=True)
        return []


def verify_assertion(
    assertion: str, ground_truth: str, config: LLMConfig
) -> dict:
    """Verify a single assertion against ground truth."""
    prompt = ASSERTION_VERIFICATION_PROMPT.format(
        assertion=assertion, ground_truth=ground_truth[:2000]
    )
    try:
        raw = _call_llm(config, prompt)
        return json.loads(raw)
    except Exception:
        logger.warning("Assertion verification failed", exc_info=True)
        return {"verdict": "unverifiable", "reason": "verification_error"}


def compute_rag_checker_metrics(
    context_assertions: list[dict],
    ground_truth_assertions: list[dict],
    verification_results: list[dict],
) -> dict:
    """Compute RAGChecker assertion-level metrics."""
    total = len(context_assertions)
    supported = sum(1 for v in verification_results if v.get("verdict") == "supported")
    contradicted = sum(1 for v in verification_results if v.get("verdict") == "contradicted")
    unverifiable = sum(1 for v in verification_results if v.get("verdict") == "unverifiable")

    # Claim precision: fraction of extracted assertions that are supported
    claim_precision = supported / max(total, 1)

    # Faithfulness: same as claim_precision for retrieval-only eval
    faithfulness = claim_precision

    # Claim recall: fraction of ground-truth claims found in retrieved context
    # This requires checking if ground truth assertions are covered by context assertions
    # Simple heuristic: count ground truth assertions that have a matching supported context assertion
    gt_claims = [a["claim"].lower() for a in ground_truth_assertions]
    ctx_claims = [a["claim"].lower() for a in context_assertions]

    covered = 0
    for gt_claim in gt_claims:
        for ctx_claim in ctx_claims:
            # Simple word overlap check
            gt_words = set(gt_claim.split())
            ctx_words = set(ctx_claim.split())
            overlap = len(gt_words & ctx_words) / max(len(gt_words), 1)
            if overlap > 0.6:
                covered += 1
                break

    claim_recall = covered / max(len(gt_claims), 1)

    # Claim F1
    claim_f1 = (
        2 * claim_precision * claim_recall / max(claim_precision + claim_recall, 1e-10)
    )

    return {
        "claim_recall": round(claim_recall, 4),
        "claim_precision": round(claim_precision, 4),
        "claim_f1": round(claim_f1, 4),
        "faithfulness": round(faithfulness, 4),
        "total_assertions": total,
        "supported_count": supported,
        "contradicted_count": contradicted,
        "unverifiable_count": unverifiable,
    }
