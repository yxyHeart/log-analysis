# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workspace Layout

- `logscope/` — Main app: AI-powered log analysis tool (Next.js 16 + Vercel AI SDK v6). See `logscope/CLAUDE.md` for breaking-change notes and details.
- `rag-service/` — Python FastAPI microservice for RAG (knowledge base). Uses sentence-transformers + ChromaDB. See below.
- `docs/superpowers/specs/` — Product design specs in Chinese (architecture, UI/UX, validation criteria)

## Working in logscope/

Always read `logscope/CLAUDE.md` before making changes — it documents breaking-change notes for Next.js 16, AI SDK v6, Tailwind v4, React 19, and Zod v4.

### Commands

```bash
cd logscope
npm run dev      # Dev server on port 3000
npm run build    # Production build (includes type-check)
npm run start    # Start production server
npm run lint     # ESLint
```

No test framework is configured yet.

### Key Architecture

Source lives under `logscope/src/` (not `logscope/` root — the app uses `src/` directory structure). Path alias `@/*` maps to `./src/*`.

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
- `app/api/chat/route.ts` — `streamText` with log+analysis context, returns `.toTextStreamResponse()`
- `app/api/test-connection/route.ts` — Connection validation

**UI:** Single-page app in `page.tsx` with two view modes (`input` / `analysis`). All state in React hooks. Settings (provider, model, API key, baseUrl) persist to localStorage. Components: `LogInput`, `LogViewer`, `AnalysisPanel`, `ChatPanel`, `TimelineView`, `KnowledgeBasePanel`, `SettingsPanel`.

### Design System

"Phosphor Noir" theme defined via CSS variables in `globals.css`. Key tokens: `--bg-void`/`--bg-deep`/`--bg-surface` backgrounds, `--accent-green: #00ff88` phosphor glow, `--accent-red`/`--accent-amber`/`--accent-cyan` for log levels. Utility classes: `text-phosphor`, `glass-panel`, `glow-border-hover`, `animate-float-up`, `scanlines`, `noise-bg`.

### LLM Provider Setup

`lib/llm.ts` uses `createOpenAI()` / `createAnthropic()` from AI SDK. For Anthropic-compatible endpoints (non-official), it:
- Uses `authToken` instead of `apiKey`
- Normalizes base URL to append `/v1`
- Patches fetch to add missing `signature` field on thinking blocks (workaround for compatible endpoints that omit it)

### RAG Integration

Both `/api/analyze` and `/api/chat` call the Python RAG service (`rag-service/`) before the LLM to retrieve knowledge base context. RAG is non-blocking — if the service is down or the KB is empty, analysis/chat proceeds without it.

- `lib/rag.ts` — Client module for RAG service HTTP calls (search, upload, list, delete)
- `lib/types.ts` — `KBDocument`, `RAGResult` types for RAG data
- `lib/prompts.ts` — Both `buildAnalysisPrompt` and `buildChatPrompt` accept optional `ragContext` parameter
- RAG service URL is configurable in Settings (default `http://localhost:8000`)

## Working in rag-service/

### Commands

```bash
cd rag-service
pip install -r requirements.txt   # Install dependencies
uvicorn app.main:app --port 8000  # Start dev server
```

### Architecture

- FastAPI app with `/documents/upload`, `/documents/url`, `/documents`, `/documents/{doc_id}`, `/search`, `/search/evaluate`, `/health` endpoints
- `all-MiniLM-L6-v2` embedding model (384-dim, CPU-only)
- ChromaDB with `PersistentClient` for vector storage (single collection `logscope_kb`)
- Vector data persisted in `rag-service/chroma_data/` (gitignored)
- Paragraph-aware chunking (~500 tokens, 50-token overlap) via `services/chunking.py`
- URL crawling via `httpx` + `beautifulsoup4`
- BM25 index rebuilt from ChromaDB at startup (`services/bm25.py`)

**Search pipeline** (in `routes/search.py`): supports simple vector search or a multi-stage hybrid pipeline:
1. Query rewriting — LLM-based query expansion (`services/query_rewriter.py`), optional, requires `llm_config`
2. Hybrid retrieval — parallel BM25 (`services/bm25.py`) + vector search, fused via reciprocal rank fusion (`services/fusion.py`)
3. Reranking — cross-encoder rerank of top candidates (`services/reranker.py`), optional

All stages are controlled by flags on the `SearchRequest`: `use_hybrid`, `use_reranker`, `use_query_rewriting`.

`/search/evaluate` runs the pipeline against labeled data and computes recall/MRR/nDCG (`services/evaluation.py`).

### Key Files

- `app/main.py` — FastAPI app setup, CORS, ChromaDB + BM25 lifecycle
- `app/routes/documents.py` — KB document management (CRUD + upload/URL ingestion)
- `app/routes/search.py` — Search pipeline (hybrid, reranking, evaluation)
- `app/services/embedding.py` — Sentence transformer wrapper
- `app/services/chunking.py` — Text splitting for uploads
- `app/services/bm25.py` — BM25 keyword search index
- `app/services/fusion.py` — Reciprocal rank fusion for hybrid results
- `app/services/reranker.py` — Cross-encoder reranking
- `app/services/query_rewriter.py` — LLM query expansion
- `app/services/evaluation.py` — Search quality metrics (recall, MRR, nDCG)
- `app/services/crawler.py` — URL content extraction
- `app/models/schemas.py` — Pydantic request/response types

## Running with Docker

```bash
docker compose up        # Starts both logscope (port 3000) and rag-service (port 8000)
docker compose up rag-service  # Run only the RAG service for local dev
```

Docker Compose uses named volumes for `rag-chroma-data`, `rag-uploads`, and `rag-model-cache` (HuggingFace model cache). The rag-service has a health check (`/health`) that logscope depends on before starting. Both services communicate on the `logscope-net` bridge network; logscope reaches RAG at `http://rag-service:8000` (overridden via `RAG_SERVICE_URL` env var).

## Design Spec

`docs/superpowers/specs/2026-05-02-logscope-design.md` defines the full product spec (Chinese): modules, UI layout, interaction flow, validation criteria. Use it when adding features or verifying completeness. `docs/superpowers/specs/2026-05-02-streaming-analysis-design.md` covers the streaming analysis design.
