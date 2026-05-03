import re

CHUNK_SIZE = 500  # target tokens
CHUNK_OVERLAP = 50  # overlap tokens
TOKEN_RATIO = 4  # approximate chars per token for English


def _estimate_tokens(text: str) -> int:
    return len(text) // TOKEN_RATIO


def _split_sentences(text: str) -> list[str]:
    parts = re.split(r'(?<=[.!?])\s+', text)
    return [p.strip() for p in parts if p.strip()]


def chunk_text(text: str) -> list[str]:
    paragraphs = re.split(r'\n\s*\n', text)
    paragraphs = [p.strip() for p in paragraphs if p.strip()]

    if not paragraphs:
        return []

    chunks: list[str] = []
    current = ""

    for para in paragraphs:
        para_tokens = _estimate_tokens(para)

        # If single paragraph exceeds chunk size, split by sentences
        if para_tokens > CHUNK_SIZE:
            # Flush current chunk first
            if current.strip():
                chunks.append(current.strip())
                current = ""

            sentences = _split_sentences(para)
            sent_chunk = ""
            for sent in sentences:
                if _estimate_tokens(sent_chunk + " " + sent) > CHUNK_SIZE and sent_chunk.strip():
                    chunks.append(sent_chunk.strip())
                    sent_chunk = sent
                else:
                    sent_chunk = (sent_chunk + " " + sent).strip()
            if sent_chunk.strip():
                current = sent_chunk
            continue

        # Try adding paragraph to current chunk
        candidate = (current + "\n\n" + para).strip() if current.strip() else para
        if _estimate_tokens(candidate) > CHUNK_SIZE and current.strip():
            chunks.append(current.strip())
            current = para
        else:
            current = candidate

    if current.strip():
        chunks.append(current.strip())

    # Add overlap: prepend tail of previous chunk to next chunk
    if len(chunks) <= 1:
        return chunks

    overlapped = [chunks[0]]
    for i in range(1, len(chunks)):
        prev = chunks[i - 1]
        overlap_words = prev.split()[-CHUNK_OVERLAP:]
        overlap_text = " ".join(overlap_words)
        overlapped.append(overlap_text + "\n\n" + chunks[i])

    return overlapped
