# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workspace Layout

- `src/` — Main app: AI-powered log analysis tool (Next.js 16 + Vercel AI SDK v6)
- `rag-service/` — Python FastAPI microservice for RAG (knowledge base). Uses sentence-transformers + ChromaDB.
- `docs/superpowers/specs/` — Product design specs in Chinese (architecture, UI/UX, validation criteria)

## Runtime Requirements

- **Node.js 22+** (Docker uses `node:22-alpine`)
- **Python 3.12** for rag-service (Docker uses `python:3.12-slim`)

## Breaking-Change Notes

This project uses versions with breaking changes from what training data may suggest. Always check before using patterns from older versions:

- **Next.js 16** — Read `node_modules/next/dist/docs/` before using unfamiliar APIs. This version has breaking changes from Next.js 14/15.
- **Vercel AI SDK v6** — Use `createOpenAI()` / `createAnthropic()` for provider instances (not `openai()` directly). The analyze API uses `generateObject` (not `streamObject`). The chat/thinking APIs use `streamText` with `.toTextStreamResponse()`.
- **Tailwind CSS v4** — Uses `@import "tailwindcss"` syntax and `@theme inline` for custom tokens (no `tailwind.config.js`).
- **React 19** — No legacy context patterns.
- **Zod v4** — Bundled with AI SDK, used for structured output schema in analyze API.
- **motion** (Framer Motion v12) — Used for UI animations (not `framer-motion` package name).

## Commands

```bash
npm run dev      # Dev server on port 3000
npm run build    # Production build (includes type-check)
npm run start    # Start production server
npm run lint     # ESLint
```

No test framework is configured yet.

## Key Architecture

Source lives under `src/` with path alias `@/*` mapping to `./src/*`.

```
Raw log text → detector.ts → parser.ts → splitter.ts → /api/analyze (generateObject) → AnalysisPanel
                                                           → /api/chat (streamText) → ChatPanel
```

**Pipeline:**
1. `lib/detector.ts` — Detects log format (JSON/text/mixed) and framework (Pino, Winston, Log4j, Spring, Django)
2. `lib/parser.ts` — Raw text → `ParsedLog[]` with level, timestamp, message, stack-trace detection. Also returns `LogMetadata`
3. `lib/splitter.ts` — Token-based chunking: <4k whole, 4k-20k condensed (ERROR/WARN + context window), >20k chunked with LLM merge
4. `lib/prompts.ts` — Three prompt templates: analysis (4-stage), chat follow-up, chunk merge
5. `lib/llm.ts` — Provider factory supporting OpenAI and Anthropic (including compatible endpoints with `authToken` + signature patching)
6. `lib/types.ts` — Shared types: `ParsedLog`, `LogMetadata`, `AnalysisResult`, `TimelineEvent`, `RootCause`, `FixSuggestion`

**API routes:**
- `app/api/analyze/route.ts` — `generateObject` with zod schema (`analysisSchema`), handles chunked merge flow
- `app/api/analyze/thinking/route.ts` — `streamText` for quick-thinking overview (single chunk only, no merge)
- `app/api/chat/route.ts` — `streamText` with log+analysis context, returns `.toTextStreamResponse()`
- `app/api/test-connection/route.ts` — Connection validation

**UI:** Single-page app in `page.tsx` with two view modes (`input` / `analysis`). All state in React hooks. Settings (provider, model, API key, baseUrl) persist to localStorage. Components: `LogInput`, `LogViewer`, `AnalysisPanel`, `ChatPanel`, `TimelineView`, `KnowledgeBasePanel`, `SettingsPanel`.

## Design System

"Phosphor Noir" theme defined via CSS variables in `globals.css`. Key tokens: `--bg-void`/`--bg-deep`/`--bg-surface` backgrounds, `--accent-green: #00ff88` phosphor glow, `--accent-red`/`--accent-amber`/`--accent-cyan` for log levels. Utility classes: `text-phosphor`, `glass-panel`, `glow-border-hover`, `animate-float-up`, `scanlines`, `noise-bg`.

## LLM Provider Setup

`lib/llm.ts` uses `createOpenAI()` / `createAnthropic()` from AI SDK. For Anthropic-compatible endpoints (non-official), it:
- Uses `authToken` instead of `apiKey`
- Normalizes base URL to append `/v1`
- Patches fetch to add missing `signature` field on thinking blocks (workaround for compatible endpoints that omit it)

## RAG Integration

Both `/api/analyze` and `/api/chat` call the Python RAG service (`rag-service/`) before the LLM to retrieve knowledge base context. RAG is non-blocking — if the service is down or the KB is empty, analysis/chat proceeds without it.

- `lib/rag.ts` — Client module for RAG service HTTP calls (search, upload, list, delete, incident report upload, assertion evaluation)
- `lib/types.ts` — `KBDocument`, `RAGResult`, `RootCauseMetadata`, `RAGCheckerMetrics`, `PipelineTrace` types for RAG data
- `lib/prompts.ts` — Both `buildAnalysisPrompt` and `buildChatPrompt` accept optional `ragContext` parameter
- RAG service URL is configurable in Settings (default `http://localhost:8000`)

## Working in rag-service/

### Commands

```bash
cd rag-service
pip install -r requirements.txt   # Install dependencies (requires Elasticsearch running)
uvicorn app.main:app --port 8000  # Start dev server
```

### Architecture

- FastAPI app with `/documents/upload`, `/documents/url`, `/documents/incident`, `/documents`, `/documents/{doc_id}`, `/search`, `/search/evaluate`, `/search/evaluate/assertion`, `/health` endpoints
- `all-MiniLM-L6-v2` embedding model (384-dim, CPU-only)
- **Elasticsearch 8.x** for vector storage + native BM25 + hybrid search with RRF (replaces ChromaDB + rank-bm25)
- ES index `logscope_kb` with dense_vector (384-dim cosine), keyword, text, and metadata fields
- **Semantic-aware chunking** (~500 tokens, 50-token overlap) with 3-priority separators, bracket balance detection, and metadata injection via `services/chunking.py`
- Metadata extraction: root cause category, affected services, error type, severity, call chain via `services/metadata_extractor.py`
- URL crawling via `httpx` + `beautifulsoup4`

**Search pipeline** — two modes:

1. **LangGraph state machine** (when hybrid/reranker/query-rewriting enabled): `Query_Analysis → Hybrid_Retrieval → Rerank → Quality_Gate → Response_Generation`. Quality gate can loop back to Query_Analysis (max 2 attempts) when retrieval quality is low.
2. **Legacy linear** (simple vector-only search): `vector search → top-K`

Both pipelines use ES native `knn + match + rank.rrf` for hybrid retrieval. The LangGraph pipeline is in `services/graph.py` with nodes in `services/nodes/`.

`/search/evaluate` runs document-level evaluation (recall/MRR/nDCG). `/search/evaluate/assertion` runs RAGChecker-style assertion-level evaluation (claim recall/precision/F1/faithfulness).

### Key Files

- `app/main.py` — FastAPI app setup, CORS, Elasticsearch lifecycle
- `app/routes/` — `documents.py` (CRUD + upload/URL/incident), `search.py` (search pipeline + evaluation)
- `app/services/` — `embedding.py`, `chunking.py`, `elasticsearch.py`, `es_client.py`, `metadata_extractor.py`, `reranker.py`, `query_rewriter.py`, `evaluation.py`, `rag_checker.py`, `crawler.py`, `graph.py`
- `app/services/nodes/` — `query_analysis.py`, `hybrid_retrieval.py`, `rerank_node.py`, `quality_gate.py`, `response_generation.py`
- `app/models/schemas.py` — Pydantic request/response types

## Running with Docker

```bash
docker compose up        # Starts logscope (3000), rag-service (8000), and elasticsearch (9200)
docker compose up rag-service  # Run only the RAG service + ES for local dev
```

Docker Compose uses named volumes for `rag-es-data`, `rag-uploads`, and `rag-model-cache` (HuggingFace model cache). Elasticsearch runs on port 9200 with single-node discovery and security disabled. The rag-service depends on ES health check before starting. Both services communicate on the `logscope-net` bridge network; rag-service reaches ES at `http://elasticsearch:9200` (via `ES_HOST`/`ES_PORT` env vars).

## Environment Variables

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `RAG_SERVICE_URL` | Next.js (docker) | `http://localhost:8000` | RAG service endpoint; set to `http://rag-service:8000` in Docker |
| `ES_HOST` | rag-service (docker) | `localhost` | Elasticsearch host; set to `elasticsearch` in Docker |
| `ES_PORT` | rag-service (docker) | `9200` | Elasticsearch port |
| Provider config (apiKey, baseUrl, model) | Browser localStorage | — | Set via SettingsPanel, passed per-request to API routes |

## Design Spec

`docs/superpowers/specs/2026-05-02-logscope-design.md` defines the full product spec (Chinese): modules, UI layout, interaction flow, validation criteria. Use it when adding features or verifying completeness. `docs/superpowers/specs/2026-05-02-streaming-analysis-design.md` covers the streaming analysis design.
