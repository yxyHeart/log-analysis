# 全链路根因分析场景

RAG 系统的包装需要一个有说服力的业务场景。参考项目用"到手价计算"（电商价格公式），我们用"全链路根因分析"（微服务调用链故障诊断）——知识库存储历史故障报告和根因分析案例，RAG 帮助从历史案例中找到与当前问题匹配的解决方案。

## 场景定义

```
用户问题: "order-service 调用 payment-gateway 超时，Redis 连接池耗尽"
                    │
                    ▼
          ┌─────────────────────┐
          │  RAG 知识库检索       │
          │  匹配历史故障案例      │
          └─────────┬───────────┘
                    │
                    ▼
  "找到相似案例 INC-2024-0312:
   payment-gateway 下游欺诈检测服务部署引入 N+1 查询，
   导致支付超时，Redis 连接池因重试背压耗尽。
   解决方案: 回滚部署 + 熔断器 + Redis 池隔离"
                    │
                    ▼
          ┌─────────────────────┐
          │  LLM 结合检索上下文   │
          │  生成根因分析和建议    │
          └─────────────────────┘
```

## 知识库文档结构

### 事件报告模板

```markdown
# Incident Report: Payment Gateway Timeout (INC-2024-0312)

## Summary
Order service calls to payment-gateway timed out at 504 after 30s,
causing cascading failures in order-fulfillment and notification services.

## Affected Services
gateway -> order-service -> payment-gateway -> redis (cache)

## Error Signatures
- java.net.SocketTimeoutException: timeout reading from payment-gateway:443
- org.springframework.web.client.ResourceAccessException: I/O error on POST
- redis.clients.jedis.exceptions.JedisConnectionException

## Timeline
1. 14:23:01 - payment-gateway latency spike to 12s (normally 200ms)
2. 14:23:31 - order-service starts logging SocketTimeoutException
3. 14:24:15 - Redis connection pool exhausted from retry backpressure
4. 14:25:00 - order-fulfillment dead-letter queue fills

## Root Cause
The payment-gateway dependency on a downstream fraud-detection service
experienced a deployment at 14:22 that introduced a N+1 query pattern.

## Resolution
Rolled back fraud-detection deployment. Implemented circuit breaker
with 5s timeout on payment-gateway client. Added bulkhead for redis pool.
```

### ES 索引元数据字段

| 字段 | 类型 | 示例 | 用途 |
|------|------|------|------|
| `root_cause_category` | keyword | `timeout` | 按故障类型过滤 |
| `affected_services` | keyword[] | `["order-service", "payment-gateway", "redis"]` | 按服务名过滤 |
| `error_type` | keyword | `SocketTimeoutException` | 按异常类名精确匹配 |
| `severity` | keyword | `P0` | 按严重度过滤 |
| `call_chain` | keyword | `gateway.order-service.payment-gateway.redis` | 按调用链路径匹配 |
| `stack_trace_present` | boolean | `true` | 区分有无堆栈的 chunk |
| `resolution_status` | keyword | `resolved` | 按解决状态过滤 |
| `semantic_summary` | text | LLM 生成的 1-2 句摘要 | 缓解向量稀释 |

## 查询模式与元数据过滤

| 查询模式 | 示例查询 | 自动提取的过滤 |
|---------|---------|--------------|
| 错误类型查找 | "SocketTimeoutException in payment service" | `error_type: SocketTimeoutException`, `affected_services: payment-gateway` |
| 服务链查找 | "order-service → payment-gateway failures" | `call_chain: order-service.payment-gateway` |
| 分类浏览 | "all timeout incidents" | `root_cause_category: timeout` |
| 症状匹配 | "redis connection pool exhaustion" | `affected_services: redis` |
| 严重度筛选 | "P0 incidents with connection_reset" | `severity: P0`, `root_cause_category: connection_reset` |
| 跨服务级联 | "cascading failure after deployment" | 无过滤（纯语义匹配） |

## 结构化上传端点

除了普通文件上传，还支持结构化事件报告上传：

```python
POST /documents/incident
{
  "title": "Payment Gateway Timeout (INC-2024-0312)",
  "content": "# Incident Report\n...",
  "root_cause_category": "timeout",
  "affected_services": ["order-service", "payment-gateway", "redis"],
  "severity": "P0",
  "call_chain": "gateway.order-service.payment-gateway.redis",
  "resolution_status": "resolved"
}
```

元数据会被自动注入到每个 chunk 中，无需手动标注。

## 面试话术

> 我们的 RAG 场景是全链路根因分析——知识库存储历史故障报告，当用户遇到新问题时，系统从历史案例中检索匹配的根因和解决方案。场景设计的核心是结构化元数据：每个事件报告有故障类型（timeout/oom/connection_reset 等）、受影响服务列表、异常类名、严重度、调用链路径。这些 keyword 字段支持 ES 精确过滤，和向量语义检索互补——比如用户查"SocketTimeoutException in payment-service"，系统能同时做语义匹配和 `error_type: SocketTimeoutException` + `affected_services: payment-gateway` 的精确过滤，比纯向量检索精准得多。而且上传事件报告时可以传这些元数据，不需要事后手动标注，降低了知识库的维护成本。
