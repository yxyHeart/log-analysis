# 非阻塞集成

RAG 服务不可用或知识库为空时，日志分析流程照常进行——RAG 是增强而非依赖。

## 关键调用链路

```
logscope 前端:
  lib/rag.ts: searchKnowledgeBase(query, topK, ragUrl, options)
    └─ fetch(`${ragUrl}/search`, { method: "POST", body: ... })

  app/api/analyze/route.ts & app/api/chat/route.ts:
    ├─ try: ragResults = await searchKnowledgeBase(...)
    ├─ if 成功: buildAnalysisPrompt(log, metadata, ragContext)
    └─ if 失败 or 服务不可用: buildAnalysisPrompt(log, metadata)  ← ragContext 为空，照常分析

  rag.ts: checkHealth(ragUrl)
    └─ AbortSignal.timeout(3000) → 3 秒超时，失败返回 false
```

## 核心细节

- **双层容错**：前端 `checkHealth` 检测服务状态，后端 API 路由层 try-catch 包裹 RAG 调用
- **优雅降级**：`buildAnalysisPrompt` 和 `buildChatPrompt` 的 `ragContext` 参数是可选的，为空时 prompt 不包含知识库上下文
- **超时控制**：健康检查 3 秒超时，避免 RAG 服务慢响应拖垮主流程

## 面试话术

> 我们把 RAG 设计成非阻塞的增强层而不是必经链路。两层保障：前端先 checkHealth 探活，3 秒超时；后端 API 层 try-catch 包裹，RAG 调用失败就跳过。prompt 构建函数的 ragContext 参数是可选的，没有知识库上下文时 LLM 依然能基于日志本身做分析。这个设计让系统在 RAG 服务宕机、知识库为空、或者用户没配置 RAG 的情况下都能正常工作，降低了部署和运维的复杂度。
