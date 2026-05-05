import re

# Rule-based root cause category classifier
CATEGORY_RULES: dict[str, list[str]] = {
    "timeout": [
        "timeout", "timed out", "sockettimeout", "deadline exceeded",
        "connection timed out", "read timed out",
    ],
    "oom": [
        "outofmemory", "oom", "heap space", "exit code 137",
        "oomkilled", "memory limit exceeded",
    ],
    "connection_reset": [
        "connection reset", "broken pipe", "econnreset",
        "connection refused", "econnrefused",
    ],
    "config_error": [
        "config", "property", "misconfigured", "missing configuration",
        "invalid configuration", "configmap",
    ],
    "auth_failure": [
        "401", "403", "unauthorized", "authentication failed",
        "access denied", "permission denied",
    ],
    "dependency_failure": [
        "dependency", "upstream", "downstream", "third-party",
        "external service", "service unavailable",
    ],
    "race_condition": [
        "race condition", "concurrent", "deadlock", "mutex",
        "concurrentmodification",
    ],
    "resource_exhaustion": [
        "pool exhausted", "rate limit", "throttle", "circuit breaker",
        "too many connections", "connection pool",
    ],
    "data_corruption": [
        "data corruption", "inconsistent", "checksum mismatch",
        "data integrity", "corrupted",
    ],
}

# Stack trace detection patterns
STACK_TRACE_PATTERNS = [
    r'^\s*at\s+[\w.$]+\(',
    r'^\s*Caused by:',
    r'^\s*\.\.\.\s+\d+\s+more',
    r'^\s*at\s+[\w.$]+\.\w+\(',
    r'^\s*java\.\w+\.\w+Exception',
    r'^\s*org\.\w+\.\w+Exception',
    r'^\s*com\.\w+\.\w+Exception',
    r'^\s*Traceback\s*\(most recent call last\)',
    r'^\s*File\s+"[^"]+",\s+line\s+\d+',
]


def classify_root_cause(text: str) -> str | None:
    """Classify text into a root cause category using rule-based matching."""
    text_lower = text.lower()
    best_category = None
    best_count = 0

    for category, keywords in CATEGORY_RULES.items():
        count = sum(1 for kw in keywords if kw in text_lower)
        if count > best_count:
            best_count = count
            best_category = category

    return best_category


def detect_stack_trace(text: str) -> bool:
    """Detect if text contains a stack trace."""
    match_count = 0
    for pattern in STACK_TRACE_PATTERNS:
        if re.search(pattern, text, re.MULTILINE):
            match_count += 1
    return match_count >= 2


def extract_error_type(text: str) -> str | None:
    """Extract the primary exception/error type from text."""
    # Java exception patterns
    java_match = re.search(
        r'((?:java|org|com|net)\.[\w.]+(?:Exception|Error|Failure))',
        text,
    )
    if java_match:
        return java_match.group(1).split(".")[-1]

    # Python exception patterns
    py_match = re.search(r'(\w+Error|\w+Exception):\s', text)
    if py_match:
        return py_match.group(1)

    # Generic error patterns
    generic_match = re.search(r'(ERROR|FATAL|CRITICAL)[:\s]+(\w+)', text)
    if generic_match:
        return generic_match.group(2)

    return None


def extract_affected_services(text: str) -> list[str]:
    """Extract service names from text (heuristic)."""
    services = set()
    # Common service naming patterns: xxx-service, xxx-service, xxx.svc
    for match in re.finditer(r'([\w-]+(?:-service|-svc|-api|-gateway|-worker|-aggregator))', text, re.IGNORECASE):
        services.add(match.group(1).lower())
    # Also detect service.name patterns in call chains
    for match in re.finditer(r'(?:->|→|calls?)\s*([\w-]+(?:-service|-svc|-api|-gateway))', text, re.IGNORECASE):
        services.add(match.group(1).lower())
    return sorted(services)


def extract_call_chain(text: str) -> str | None:
    """Extract call chain path from text."""
    # Pattern: gateway -> order-service -> payment-gateway
    chain_match = re.search(r'([\w-]+(?:\s*[-→>]+\s*[\w-]+){2,})', text)
    if chain_match:
        return chain_match.group(1)
    return None
