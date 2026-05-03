# 内置评估管线

`/search/evaluate` 端点可以用标注数据跑 recall/MRR/nDCG，不用额外工具就能量化调优效果。

## 关键调用链路

```
search.py: /search/evaluate
  └─ for each eval_item in req.evaluations:
       ├─ 构造 SearchRequest → 复用 _run_pipeline() 执行完整检索
       ├─ 从 chunk_id 提取 doc_id（格式: {doc_id}_chunk_{i}）
       └─ evaluation.calculate_metrics(retrieved_doc_ids, relevant_doc_ids, k)
            ├─ recall_at_k: |top-k ∩ relevant| / |relevant|
            ├─ mrr: 1 / (第一个相关文档的排名)
            └─ ndcg_at_k: DCG / IDCG，考虑位置折扣

  计算所有查询的平均值 → overall: {recall, mrr, ndcg}
```

## 核心细节

- **指标选取**：Recall 衡量查全率，MRR 衡量第一个正确结果的位置，nDCG 衡量整体排序质量
- **chunk → doc 映射**：评估以文档为单位而非 chunk，从 `chunk_id` 中提取 `doc_id` 去重
- **复用管线**：评估走的是和线上完全相同的 `_run_pipeline()`，确保指标可信
- **批量评估**：`SearchEvaluateRequest` 支持多组 query + 标注，一次请求算完所有指标

## 面试话术

> RAG 系统最大的痛点是很难量化效果，我们内置了评估管线，支持传一组 query + 人工标注的相关文档，跑完整个检索管线后算 recall、MRR、nDCG 三个指标。关键是评估复用了线上的完整检索流程，包括混合检索、重排、查询改写，这样调参前后可以用同一组标注数据对比，确保优化是真实的而不是巧合。我们选 nDCG 而不只是 recall，是因为排序质量在 RAG 场景下很重要——top-1 的相关性直接决定 LLM 的回答质量。
