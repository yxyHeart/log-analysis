# LLM 查询改写

搜索前可选地用 LLM 将用户查询扩展为多个变体，再对每个变体分别检索，最后合并去重。对日志分析场景尤其有用——用户描述问题的方式往往和日志中的措辞不一致。

## 关键调用链路

```
search.py: _run_pipeline()
  └─ if use_query_rewriting and llm_config:
       queries = query_rewriter.rewrite_and_expand(query, config)
         ├─ _call_openai / _call_anthropic(config, "Original query: ...")
         │    └─ system prompt: 要求返回 JSON {"rewritten": "...", "variants": [...]}
         ├─ 解析 JSON → 1 个改写 + 2 个变体
         └─ 去重保序 → [original, rewritten, variant1, variant2]

  对每个 query 变体并行执行 _search_single_query()
  └─ asyncio.gather(*search_tasks) → 合并所有变体结果到 all_candidates
```

## 核心细节

- **Prompt 设计**：要求 LLM 做两件事——提取关键词生成优化版本 + 生成两个不同措辞的变体
- **容错**：LLM 调用失败时静默回退到原始查询 `[query]`，不阻塞检索流程
- **并行执行**：多个查询变体通过 `asyncio.gather` 并行检索，不增加延迟
- **去重合并**：所有变体的检索结果按 doc id 合并，相同文档只保留一份

## 面试话术

> 查询改写的动机是日志场景的词汇鸿沟问题——用户说"服务启动失败"，但日志里写的是 `ApplicationStartupException`。我们用 LLM 把原始查询扩展成改写版和两个变体，比如改写成 "ApplicationStartupException error"，变体可能是 "Spring boot startup failure"。每个变体独立检索，结果合并去重。关键设计是失败了不影响正常检索，直接 fallback 到原始查询，而且多变体检索是并行的不增加延迟。
