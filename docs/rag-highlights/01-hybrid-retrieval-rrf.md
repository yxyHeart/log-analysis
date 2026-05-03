# 混合检索 + Reciprocal Rank Fusion 融合

BM25（关键词匹配）+ 向量语义搜索并行执行，通过 Reciprocal Rank Fusion 融合两路结果。既不漏掉精确关键词命中的文档，也能捕获语义相关的内容。

## 关键调用链路

```
search.py: _run_pipeline()
  ├─ _search_single_query(query, req, collection, bm25_service)
  │    ├─ if use_hybrid:
  │    │    ├─ _bm25_search(bm25_service, query, 50)    → bm25.py: BM25Service.search()
  │    │    │    └─ jieba 中文分词 + BM25Okapi.get_scores() → top-50
  │    │    └─ _vector_search(query, 50, collection)     → embedding.py: encode()
  │    │         └─ all-MiniLM-L6-v2 编码 → ChromaDB collection.query() → top-50
  │    └─ fusion.reciprocal_rank_fusion([bm25_results, vector_results])
  │         └─ score += 1/(k + rank_i), k=60, 按总分降序
  └─ candidates 合并去重 → 进入下一阶段
```

## 核心细节

- **BM25 分词**（`bm25.py:_tokenize`）：中文走 jieba 分词，英文走空格切分，混合文本自动拆段处理
- **RRF 公式**：`score = Σ 1/(60 + rank_i)`，k=60 是经验值，对排名靠前的结果给予更高权重但避免极端差距
- **双路标记**：同一文档被两路都召回时 `retriever` 标记为 `"both"`，便于后续分析

## 面试话术

> 我们用了 BM25 + 向量检索的混合方案，BM25 负责精确关键词匹配，向量检索负责语义相似度，两路并行检索后用 RRF 融合。选 RRF 而不是简单加权，是因为 RRF 只依赖排名不依赖原始分数，这样 BM25 的分值和向量的距离度量就不需要归一化对齐，实现更简洁也更鲁棒。实测下来混合检索比单路向量检索在日志场景下 recall 提升明显，因为日志里经常有精确的类名、方法名，纯语义检索容易漏掉。
