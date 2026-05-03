import httpx
from bs4 import BeautifulSoup


async def fetch_and_extract(url: str, timeout: float = 10.0) -> str:
    async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
        resp = await client.get(url)
        resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")

    # Remove scripts, styles, nav, footer
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()

    # Try semantic containers first
    for selector in ["main", "article", "[role='main']"]:
        container = soup.select_one(selector)
        if container:
            return _clean_text(container.get_text(separator="\n"))

    # Fallback: body
    body = soup.find("body")
    if body:
        return _clean_text(body.get_text(separator="\n"))

    return _clean_text(soup.get_text(separator="\n"))


def _clean_text(text: str) -> str:
    lines = [line.strip() for line in text.splitlines()]
    # Collapse multiple blank lines
    cleaned: list[str] = []
    prev_blank = False
    for line in lines:
        if not line:
            if not prev_blank:
                cleaned.append("")
            prev_blank = True
        else:
            cleaned.append(line)
            prev_blank = False
    return "\n".join(cleaned).strip()
