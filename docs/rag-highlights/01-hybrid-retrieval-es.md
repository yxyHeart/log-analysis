# Elasticsearch 原生混合检索

用 ES 8.x 的 `knn` + `match` + `rank.rrf` 单查询实现混合检索，替代传统的双引擎（ChromaDB + rank-bm25）+ Python RRF 融合方案。BM25 和向量搜索在引擎内部完成融合，避免跨引擎分数对齐问题。

## 关键调用链路

```
es_client.py: hybrid_search()
  ├─ if use_hybrid:
  │    body = {
  │      "knn": {
  │        "field": "embedding",            # 384维 cosine 向量
  │        "query_vector": query_embedding,
  │        "k": top_k,
  │        "num_candidates": top_k * 4,     # HNSW 搜索宽度
  │      },
  │      "query": {
  │        "bool": {
  │          "must": [{"match": {"chunk_text": query}}],   # ES 原生 BM25
  │          "filter": metadata_filters,                   # 预过滤
  │        }
  │      },
  │      "rank": {"rrf": {"window_size": top_k, "rank_constant": 60}},
  │      "size": top_k,
  │    }
  └─ else:
       body = {"knn": {...}, "size": top_k}   # 纯向量检索
```

## 核心细节

- **单查询融合**：BM25 和 kNN 在同一个 ES 查询中执行，由 ES 内部 `rank.rrf` 融合，不需要 Python 端手动合并两路结果
- **预过滤**：ES 8.x 支持 `knn` 子句内嵌 `filter`，先过滤再搜索（不是先搜后过滤），对元数据过滤场景性能提升显著
- **HNSW 搜索宽度**：`num_candidates = k * 4`，经验值确保 95%+ recall，延迟 < 50ms
- **RRF rank_constant=60**：与参考方案一致，只依赖排名不依赖原始分数，天然解决 BM25 分值（无界）和向量相似度（[0,1]）的归一化问题
- **索引映射**：`dense_vector` dims=384, similarity=cosine，对应 `all-MiniLM-L6-v2` 模型

## 为什么选 ES 而不是 ChromaDB

| 对比维度 | ChromaDB + rank-bm25 | Elasticsearch 8.x |
|---------|---------------------|-------------------|
| 混合检索 | Python 端拼接两路结果，需要手动 RRF | 引擎内原生 kNN+BM25+RRF |
| BM25 | jieba 分词 + rank-bm25（Python 实现） | Lucene 原生 BM25（Java，工业级） |
| 预过滤 | ChromaDB 不支持 knn 内过滤 | ES 8.9+ 原生支持 knn + filter |
| 运维 | ChromaDB + 独立 BM25 pickle 持久化 | 单 ES 集群，统一索引管理 |
| 全文搜索 | 无（需额外 BM25 服务） | 原生支持，含中文分词插件 |

## 面试话术

> 我们选 ES 8.x 做向量数据库，核心原因是混合检索的效率。ES 8.9+ 原生支持 knn + BM25 + RRF 在单查询内完成，不需要在 Python 端手动合并两路结果。之前用 ChromaDB + rank-bm25 的方案，BM25 是 Python 纯实现的，分词靠 jieba，每次启动还要从 ChromaDB 重建 pickle 索引。换成 ES 之后，Lucene 的 BM25 是工业级实现，kNN 内支持预过滤（先过滤再搜索，不是先搜后过滤），RRF 融合在引擎内部完成，延迟和准确率都有提升。而且 ES 本身就是运维成熟的组件，不需要额外维护一个独立的向量数据库。
