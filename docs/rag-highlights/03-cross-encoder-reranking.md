# 交叉编码器重排

检索后的候选集通过 Cross-encoder 做精排，先粗筛 50 条再精排取 top-k，平衡召回率和精度。

## 关键调用链路

```
search.py: _run_pipeline()
  └─ if use_reranker and candidates:
       candidates = loop.run_in_executor(None, rerank, query, candidates, 20)
         └─ reranker.py: rerank()
              ├─ get_reranker() → 加载 cross-encoder/ms-marco-MiniLM-L-12-v2
              ├─ pairs = [(query, chunk_text) for each candidate]
              ├─ model.predict(pairs) → 逐对打分（非 Bi-encoder 的独立编码）
              ├─ 用交叉编码器分数覆盖原分数
              └─ 按新分数降序排列 → 返回 reranked top-k
```

## 核心细节

- **模型**：`cross-encoder/ms-marco-MiniLM-L-12-v2`，12 层 MiniLM，推理速度可接受
- **精排池**：CANDIDATE_POOL=50 粗筛，RERANK_POOL=20 送入交叉编码器
- **重打分**：用交叉编码器的分数直接替换检索分数，`retriever` 标记更新为 `"reranker"`
- **线程执行**：rerank 是 CPU 密集型，通过 `run_in_executor` 放到线程池避免阻塞事件循环

## 面试话术

> 粗检索用 Bi-encoder（双编码器）速度快但精度有限，因为查询和文档是独立编码的，缺少交互。所以我们加了一个 Cross-encoder 重排阶段，把 query 和每个候选文档拼在一起过模型，让注意力机制在 query-document 对之间做细粒度交互。具体用了 ms-marco-MiniLM-L-12-v2，从 50 个候选里取前 20 个做重排，控制计算量。这个两阶段检索是信息检索里经典的 coarse-to-fine 范式。
