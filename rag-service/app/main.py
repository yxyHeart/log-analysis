from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import documents, search
from app.services.embedding import get_model
from app.services.es_client import get_client, ensure_index


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load embedding model on startup
    get_model()
    # Initialize Elasticsearch
    es = get_client()
    await ensure_index(es)
    app.state.es_client = es
    yield


app = FastAPI(title="LogScope RAG Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://logscope:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents.router)
app.include_router(search.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
