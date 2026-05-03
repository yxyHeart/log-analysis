from contextlib import asynccontextmanager

import chromadb
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import documents, search
from app.services.embedding import get_model
from app.services.bm25 import BM25Service


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load embedding model on startup
    get_model()
    # Initialize ChromaDB
    app.state.chroma_client = chromadb.PersistentClient(path="./chroma_data")
    # Initialize BM25 service and rebuild from existing ChromaDB data
    bm25_service = BM25Service()
    collection = app.state.chroma_client.get_or_create_collection("logscope_kb")
    if not bm25_service.index and collection.count() > 0:
        bm25_service.rebuild_from_collection(collection)
    app.state.bm25_service = bm25_service
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
