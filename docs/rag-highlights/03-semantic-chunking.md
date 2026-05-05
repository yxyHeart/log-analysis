# 语义感知分块 + 向量稀释缓解

传统固定长度分块在日志/根因分析场景下有三个致命问题：打断堆栈跟踪、拆散 JSON 日志、长 chunk 的嵌入向量被"稀释"（关键信号被噪声淹没）。我们用三级优先分隔符 + 括号平衡检测 + 元数据注入解决这三个问题。

## 关键调用链路

```
chunking.py: chunk_text_with_metadata()
  ├─ _split_priority1(text)                    # 硬边界：## 标题、--- 分隔线
  │    → sections: list[str]
  │
  ├─ for section in sections:
  │    ├─ _estimate_tokens(section) <= 500?
  │    │    └─ 累积到 current chunk
  │    └─ > 500:
  │         ├─ _split_priority2(section)       # 软边界：空行、**Label:** 模式
  │         └─ 仍 > 500:
  │              └─ _split_priority3(part)     # 兜底：句子边界、堆栈帧边界
  │                   ├─ _is_stack_trace_block() → 保持为整体
  │                   └─ _check_balance() → 跳过不平衡切分点
  │
  ├─ _add_overlap(chunks)                      # 滑动窗口重叠 (50 tokens)
  │
  └─ for each chunk:
       ├─ metadata_extractor.classify_root_cause()    # 规则分类器
       ├─ metadata_extractor.detect_stack_trace()     # 堆栈检测
       ├─ metadata_extractor.extract_error_type()     # 异常类名提取
       ├─ metadata_extractor.extract_affected_services()  # 服务名提取
       ├─ metadata_extractor.extract_call_chain()     # 调用链提取
       └─ 预置父文档引用头: [Document: source | Chunk i/N | Category: timeout]
```

## 核心细节

### 三级优先分隔符

| 优先级 | 分隔符 | 场景 |
|--------|--------|------|
| P1（必切） | `##`/`###` 标题、`---` 分隔线 | 确保大逻辑块（"根因"、"时间线"、"解决方案"）不混在一起 |
| P2（超限才切） | 空行 `\n\n`、`**Label:**` 模式 | 在目标大小内尽量保持段落完整 |
| P3（兜底） | 句子边界、堆栈帧 `at com.` | 只在前两级都无法满足大小时使用 |

### 括号平衡检测

```python
chunking.py: _check_balance(text) → bool
  stack = []
  pairs = {"(": ")", "[": "]", "{": "}"}
  for ch in text:
    if ch in pairs: stack.append(ch)
    elif ch in pairs.values():
      if stack[-1] 对应 ch: stack.pop()
      else: return False
  return len(stack) == 0
```

切分点若导致 `()`, `[]`, `{}` 不平衡，跳至下一个平衡点。这对日志场景至关重要：
- JSON 日志：`{"timestamp": "2024-03-12T14:23:01", "level": "ERROR", ...}`
- 堆栈跟踪：`at com.example.Service.method(Service.java:142)`
- 异常链：`Caused by: java.lang.RuntimeException: ...`

### 堆栈跟踪块保护

```python
chunking.py: _is_stack_trace_block(text) → bool
  # 连续 "at com." / "Caused by:" 行占比 > 50%
  # → 识别为堆栈块，P3 分割时保持为整体不拆散
```

### 元数据注入缓解向量稀释

**问题**：长 chunk 的嵌入向量是"平均语义"，关键信息（异常名、服务名）被噪声淹没，导致检索时余弦相似度偏低——这就是向量稀释。

**三个对抗措施**：

1. **聚焦分块**：三级分隔符确保每个 chunk 主题聚焦（500 tokens），减少噪声
2. **语义摘要**（`semantic_summary` 字段）：LLM 生成 1-2 句摘要存入元数据，摘要的嵌入更聚焦
3. **父文档引用头**：每个 chunk 前置 `[Document: source | Chunk i/N | Category: timeout]`，提供结构化上下文

### 根因分类器

```python
metadata_extractor.py: CATEGORY_RULES
  "timeout": ["timeout", "timed out", "SocketTimeout", ...]
  "oom": ["OutOfMemory", "OOM", "heap space", ...]
  "connection_reset": ["Connection reset", "Broken pipe", ...]
  "config_error": ["config", "misconfigured", ...]
  "auth_failure": ["401", "403", "Unauthorized", ...]
  "dependency_failure": ["dependency", "upstream", ...]
  "race_condition": ["race condition", "deadlock", ...]
  "resource_exhaustion": ["pool exhausted", "rate limit", ...]
```

分类结果存入 `root_cause_category` keyword 字段，支持 ES `term` 过滤精准检索。

## 面试话术

> 分块策略上我们做了三层优化。第一层是三级优先分隔符，硬边界（标题、分隔线）必切，软边界（空行、标签）超限才切，兜底用句子边界，确保日志文档的结构不被破坏。第二层是括号平衡检测——日志里大量 JSON 和堆栈跟踪，比如 `{"level": "ERROR", "message": "..."}` 这种如果被从中间切断，下游 LLM 会产生幻觉。我们用栈式检测跳过所有不平衡的切分点，还特别保护堆栈块（连续 `at com.` 行）不被拆散。第三层是元数据注入缓解向量稀释——长文档的嵌入是"平均语义"，关键信号被噪声淹没。我们给每个 chunk 加了父文档引用头和根因分类标签，还用规则分类器自动提取异常类型、受影响服务、调用链等元数据，这些 keyword 字段支持 ES 精确过滤，不需要完全依赖向量匹配。
