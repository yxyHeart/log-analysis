import re

CHUNK_SIZE = 500  # target tokens
CHUNK_OVERLAP = 50  # overlap tokens
TOKEN_RATIO = 4  # approximate chars per token for English

# Priority-1: hard boundaries (always split here)
P1_SPLITTER = re.compile(r'(?=^#{2,}\s)|(?=^---+\s*$)|(?=^\*\*\*\s*$)', re.MULTILINE)

# Priority-2: soft boundaries (split when chunk exceeds target)
P2_SPLITTER = re.compile(r'\n\s*\n|(?=\*\*\w+[^*]*:\*\*)')

# Priority-3: emergency boundaries (within paragraphs)
P3_SPLITTER = re.compile(r'(?<=[.!?])\s+|(?=\n\s*at\s+[\w.]+)|(?=\n\s*Caused by:)|(?=,\s*(?:and|or|but)\s)')


def _estimate_tokens(text: str) -> int:
    return len(text) // TOKEN_RATIO


def _check_balance(text: str) -> bool:
    """Return True if brackets/braces/parens are balanced."""
    stack = []
    pairs = {"(": ")", "[": "]", "{": "}"}
    for ch in text:
        if ch in pairs:
            stack.append(ch)
        elif ch in pairs.values():
            if not stack:
                return False
            opening = stack[-1]
            if pairs.get(opening) != ch:
                return False
            stack.pop()
    return len(stack) == 0


def _is_stack_trace_block(text: str) -> bool:
    """Check if text looks like a stack trace block."""
    lines = text.strip().split("\n")
    trace_lines = sum(
        1 for l in lines
        if re.match(r'^\s*at\s+[\w.$]+', l) or re.match(r'^\s*Caused by:', l)
    )
    return trace_lines >= 2 and trace_lines / max(len(lines), 1) > 0.5


def _split_priority1(text: str) -> list[str]:
    """Split by hard boundaries: headers and horizontal rules."""
    sections = P1_SPLITTER.split(text)
    return [s.strip() for s in sections if s.strip()]


def _split_priority2(section: str) -> list[str]:
    """Split by soft boundaries: blank lines and label patterns."""
    parts = P2_SPLITTER.split(section)
    return [p.strip() for p in parts if p.strip()]


def _split_priority3(part: str) -> list[str]:
    """Split by emergency boundaries: sentences, stack frames, clauses."""
    # Keep stack trace blocks as units
    if _is_stack_trace_block(part):
        return [part]

    fragments = P3_SPLITTER.split(part)
    return [f.strip() for f in fragments if f.strip()]


def _find_balanced_split_point(text: str, target_tokens: int) -> int:
    """Find a split point near target_tokens that preserves bracket balance."""
    target_chars = target_tokens * TOKEN_RATIO
    # Try splitting at each candidate position near the target
    for offset in range(0, max(len(text) - target_chars, 0) + 1, TOKEN_RATIO):
        for direction, check in [(0, target_chars), (1, target_chars - offset), (-1, target_chars + offset)]:
            pos = check
            if pos <= 0 or pos >= len(text):
                continue
            # Find nearest newline or sentence boundary
            boundary = _find_nearest_boundary(text, pos)
            if boundary > 0 and _check_balance(text[:boundary]):
                return boundary
    # Fallback: just return the full text
    return len(text)


def _find_nearest_boundary(text: str, pos: int) -> int:
    """Find nearest paragraph or sentence boundary near pos."""
    # Look for newline within ±100 chars
    for delta in range(0, 200):
        for p in [pos + delta, pos - delta]:
            if 0 < p < len(text) and text[p] == '\n':
                return p
    # Look for sentence end
    for delta in range(0, 200):
        for p in [pos + delta, pos - delta]:
            if 0 < p < len(text) and text[p] in '.!?' and p + 1 < len(text) and text[p + 1] == ' ':
                return p + 1
    return pos


def _build_chunks(sections: list[str]) -> list[str]:
    """Build chunks from sections respecting size limits and bracket balance."""
    chunks: list[str] = []
    current = ""

    for section in sections:
        section_tokens = _estimate_tokens(section)

        if section_tokens <= CHUNK_SIZE:
            candidate = (current + "\n\n" + section).strip() if current.strip() else section
            if _estimate_tokens(candidate) > CHUNK_SIZE and current.strip():
                chunks.append(current.strip())
                current = section
            else:
                current = candidate
        else:
            # Section exceeds chunk size — try priority-2 split
            if current.strip():
                chunks.append(current.strip())
                current = ""

            sub_parts = _split_priority2(section)
            sub_chunk = ""
            for part in sub_parts:
                part_tokens = _estimate_tokens(part)
                if part_tokens > CHUNK_SIZE:
                    # Flush current sub-chunk
                    if sub_chunk.strip():
                        chunks.append(sub_chunk.strip())
                        sub_chunk = ""
                    # Try priority-3 split
                    fragments = _split_priority3(part)
                    frag_chunk = ""
                    for frag in fragments:
                        if _estimate_tokens(frag_chunk + " " + frag) > CHUNK_SIZE and frag_chunk.strip():
                            # Verify bracket balance before committing
                            if _check_balance(frag_chunk):
                                chunks.append(frag_chunk.strip())
                                frag_chunk = frag
                            else:
                                frag_chunk = (frag_chunk + " " + frag).strip()
                        else:
                            frag_chunk = (frag_chunk + " " + frag).strip()
                    if frag_chunk.strip():
                        sub_chunk = frag_chunk
                else:
                    candidate = (sub_chunk + "\n\n" + part).strip() if sub_chunk.strip() else part
                    if _estimate_tokens(candidate) > CHUNK_SIZE and sub_chunk.strip():
                        chunks.append(sub_chunk.strip())
                        sub_chunk = part
                    else:
                        sub_chunk = candidate

            if sub_chunk.strip():
                current = sub_chunk

    if current.strip():
        chunks.append(current.strip())

    return chunks


def _add_overlap(chunks: list[str]) -> list[str]:
    """Add sliding-window overlap: prepend tail of previous chunk."""
    if len(chunks) <= 1:
        return chunks

    overlapped = [chunks[0]]
    for i in range(1, len(chunks)):
        prev = chunks[i - 1]
        overlap_words = prev.split()[-CHUNK_OVERLAP:]
        overlap_text = " ".join(overlap_words)
        overlapped.append(overlap_text + "\n\n" + chunks[i])

    return overlapped


def chunk_text(text: str) -> list[str]:
    """Legacy chunking function — returns list of chunk strings."""
    sections = _split_priority1(text)
    if not sections:
        return []
    chunks = _build_chunks(sections)
    return _add_overlap(chunks)


def chunk_text_with_metadata(
    text: str,
    source: str = "",
    source_type: str = "file",
    doc_id: str = "",
) -> list[tuple[str, dict]]:
    """Semantic-aware chunking with metadata injection.

    Returns list of (chunk_text, metadata) tuples.
    """
    sections = _split_priority1(text)
    if not sections:
        return []

    chunks = _build_chunks(sections)
    chunks = _add_overlap(chunks)

    from app.services.metadata_extractor import classify_root_cause, detect_stack_trace

    results = []
    total = len(chunks)
    for i, chunk in enumerate(chunks):
        category = classify_root_cause(chunk)
        has_stack = detect_stack_trace(chunk)

        # Prepend parent document reference header
        header_parts = [f"Document: {source}" if source else "", f"Chunk {i+1}/{total}"]
        if category:
            header_parts.append(f"Category: {category}")
        header = " | ".join(p for p in header_parts if p)
        enriched_chunk = f"[{header}]\n{chunk}" if header else chunk

        metadata = {
            "doc_id": doc_id,
            "source": source,
            "source_type": source_type,
            "chunk_index": i,
            "root_cause_category": category,
            "stack_trace_present": has_stack,
        }
        results.append((enriched_chunk, metadata))

    return results
