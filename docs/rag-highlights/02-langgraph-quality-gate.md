# LangGraph 状态机 + 质量门控

用 LangGraph 构建有状态的 RAG 管道，核心亮点是**条件反馈循环**：检索质量不达标时自动回退到查询分析节点，用更激进的策略重写查询重新检索，最多循环 2 次。这不是传统的线性管道（检索→重排→返回），而是一个能自我修正的闭环系统。

## 关键调用链路

```
graph.py: build_rag_graph()
  ┌─────────────────────────────────────────────────┐
  │  LangGraph StateGraph(AgentState)               │
  │                                                  │
  │  START ──→ query_analysis ──→ hybrid_retrieval   │
  │                ↑                   │             │
  │                │              rerank             │
  │                │                   │             │
  │                │            quality_gate          │
  │                │              ╱         ╲         │
  │          ┌─────┘        passed    not_passed     │
  │          │              ╱              ╲         │
  │     rewrite < 2   response_generation  accept    │
  │     (回退重写)        │               │          │
  │                       └───────┬───────┘          │
  │                               ▼                  │
  │                              END                 │
  └─────────────────────────────────────────────────┘
```

### AgentState 关键字段

```python
class AgentState(TypedDict, total=False):
    query: str                      # 原始查询
    rewritten_queries: list[str]    # 重写后的变体
    query_intent: str               # 意图分类
    extracted_filters: dict         # 结构化过滤
    rewrite_attempts: int           # 已重写次数
    max_rewrite_attempts: int       # 最大重写次数 (2)
    quality_score: float            # 质量分数 0-1
    quality_passed: bool            # 是否通过
    pipeline_steps: list[str]       # 审计追踪
```

### Quality Gate 决策逻辑

```python
quality_gate.py: _compute_quality_score()
  ├─ score_norm = top_score 归一化 × 0.5     # top-1 结果分数
  ├─ gap_factor = 间距因子 × 0.3             # top-1 与 top-2 差距
  ├─ count_factor = 候选数因子 × 0.2          # 结果数量充足度
  └─ quality = 加权求和
      ├─ >= 0.4 → 通过 → response_generation
      └─ < 0.4:
           ├─ rewrite_attempts < 2 → 回退 query_analysis（更激进重写）
           └─ rewrite_attempts >= 2 → 接受最佳结果 → response_generation
```

### 回退重写策略

```python
query_analysis.py: _generate_retry_queries()
  ├─ 简化版: 替换具体类名为通用词 (SocketTimeoutException → exception)
  ├─ 分类版: 按 intent 生成分类查询 ("timeout incident root cause")
  └─ 保留原始查询: 确保至少和第一次一样好的结果不会丢
```

## 核心细节

- **LangGraph 只用图引擎**：不依赖 LangChain 的文档加载器、向量存储等抽象，ES 客户端、嵌入模型、重排器都是自研代码
- **最大 2 次重写**：防止无限循环，最差情况接受最佳结果
- **动态 K 调整**：top-k 边界附近分数差距 < 0.05 时自动放宽 K，避免"差一点就被截断"的问题
- **审计追踪**：`pipeline_steps` 记录实际执行路径，便于调试和回放
- **自动切换**：`use_hybrid`/`use_reranker`/`use_query_rewriting` 任一为 true 时自动使用 LangGraph 管线；否则走轻量线性管线

## 面试话术

> 传统的 RAG 管道是线性的——检索、重排、返回，检索质量差也没办法。我们用 LangGraph 构建了一个有状态的状态机管线，核心是 Quality Gate 节点：检索完后先评估质量分数（基于 top-1 分数归一化、分数间距、候选数三个维度），如果质量低于阈值就自动回退到查询分析节点，用更激进的策略重写查询重新检索，最多循环 2 次。比如第一次查"SocketTimeoutException in payment-service"没找到好结果，回退后会自动简化为"exception in service"这种更宽泛的查询重新检索。这个条件反馈循环是状态机架构的核心优势，线性管道做不到自我修正。
