# RAGChecker 断言级评估

传统 RAG 评估用文档级 recall（"正确文档是否在 top-k 里"），但这无法衡量检索质量对生成质量的影响——正确的文档被检索到了，但如果 LLM 只用了其中 30% 的信息，文档级 recall 仍然是 100%。RAGChecker 把评估粒度从"文档"降到"原子断言"：先分解为可验证的事实声明，再逐一验证。

## 关键调用链路

```
search.py: POST /search/evaluate/assertion
  └─ for each eval_item:
       ├─ _run_pipeline_legacy(search_req, es)     # 执行检索管线
       ├─ context = 拼接 top-5 chunks
       │
       ├─ rag_checker.extract_assertions_from_context(context, query, config)
       │    └─ LLM: "从检索上下文中提取与查询相关的原子断言"
       │       → [{"claim": "payment-gateway 的超时阈值是 30 秒", "source_chunk_index": 0}, ...]
       │
       ├─ rag_checker.extract_assertions_from_ground_truth(ground_truth, config)
       │    └─ LLM: "从标准答案中提取原子断言"
       │       → [{"claim": "支付网关超时阈值配置为 30 秒"}, ...]
       │
       ├─ for each context_assertion:
       │    └─ rag_checker.verify_assertion(assertion, ground_truth, config)
       │         └─ LLM: "判定断言与标准答案的关系"
       │            → {"verdict": "supported"|"contradicted"|"unverifiable", "reason": "..."}
       │
       └─ compute_rag_checker_metrics()
            ├─ claim_precision = supported / total_assertions
            ├─ claim_recall = ground_truth_claims_covered / total_gt_claims
            ├─ claim_f1 = 2 * P * R / (P + R)
            ├─ faithfulness = supported / total (与 precision 等价，检索评估)
            └─ 传统指标: document_recall, document_mrr, document_ndcg
```

## 核心细节

### 断言提取

```
输入: "payment-gateway 超时 30 秒后返回 504，导致 order-service 和
       order-fulfillment 级联失败。Redis 连接池因重试背压耗尽。"

提取为:
  A1: payment-gateway 的超时阈值是 30 秒
  A2: 超时后返回 HTTP 504
  A3: order-service 受到级联影响
  A4: order-fulfillment 受到级联影响
  A5: Redis 连接池耗尽的原因是重试背压
```

### 断言验证

```
断言: "payment-gateway 的超时阈值是 30 秒"
标准答案: "支付网关配置了 30s 读超时和 5s 连接超时..."
→ verdict: "supported"  (明确被标准答案支持)

断言: "Redis 连接池耗尽是因为内存不足"
标准答案: "Redis 连接池因重试背压耗尽..."
→ verdict: "contradicted"  (与标准答案矛盾)
```

### 双层评估对比

| 指标 | 文档级 | 断言级 |
|------|--------|--------|
| 粒度 | 整个文档是否被检索到 | 每个事实声明是否被支持 |
| 盲区 | 无法区分"检索到但没用" vs "检索到且充分利用" | 精确到每个事实 |
| 误判 | 文档被检索到 = 100% recall，但可能只用了 30% 的信息 | claim_recall 准确反映覆盖度 |
| 典型结果 | Recall@5 = 62% → 85% (混合检索提升) | claim_recall 提供更细粒度的诊断 |

### 评估输出示例

```json
{
  "overall": {
    "claim_recall": 0.85,
    "claim_precision": 0.91,
    "claim_f1": 0.88,
    "faithfulness": 0.91,
    "document_recall": 0.73,
    "document_mrr": 0.80,
    "document_ndcg": 0.76,
    "total_assertions": 45,
    "supported_count": 41,
    "contradicted_count": 2,
    "unverifiable_count": 2
  }
}
```

同时返回断言级和文档级指标，可以对比展示优化效果。

## 面试话术

> RAG 评估的痛点是文档级 recall 太粗了——正确文档被检索到就算成功，但 LLM 实际可能只用了 30% 的信息。我们引入了 RAGChecker 的断言级评估：先用 LLM 把检索上下文和标准答案分别分解成原子断言（可验证的事实声明），然后逐个验证每个断言是 supported、contradicted 还是 unverifiable。这样 claim_recall 能精确反映"标准答案中的事实有多少被检索覆盖了"，claim_precision 反映"检索出的断言有多少是靠谱的"。我们还同时跑传统文档级指标做对比，比如混合检索把文档 recall 从 62% 提到 85%，但断言级能告诉你具体是哪些事实被漏掉了，方便针对性优化。
