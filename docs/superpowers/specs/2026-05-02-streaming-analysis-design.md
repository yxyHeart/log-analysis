# 流式分析设计文档

## 背景

当前 LogScope 的分析功能使用 `generateObject()` 返回完整结果，用户在分析完成前只能看到 loading 状态，无法了解 AI 的分析进展。聊天功能已经使用了 `streamText()` 实现流式展示。本设计将分析过程也改为实时显示，让用户在等待期间能看到 AI 的思考过程，并在结构化结果可用时逐步渲染。

## 方案：串行双端点

采用两个独立 API 端点，串行调用：

```
前端 → POST /api/analyze/thinking (streamText) → 实时显示思考文本
                                                   ↓ 流完成
前端 → POST /api/analyze (generateObject)      → 显示结构化结果
```

**为什么选双端点**：思考流和结构化结果用不同的 API 形式（`streamText` vs `generateObject`），分开更清晰。串行调用避免两个流同时管理的复杂性，且用户体验上先看思考再看结果也更自然。

## 后端 API

### 新增：`/api/analyze/thinking`

- 方法：POST
- 使用 `streamText()` 流式返回 AI 分析思考过程的纯文本
- 请求参数与现有 `/api/analyze` 相同：`logData`, `provider`, `model`, `apiKey`, `baseUrl`, `ragServiceUrl`
- RAG 集成：同样在调用 LLM 前检索知识库（与 `/api/analyze` 一致，非阻塞）
- 返回：`.toTextStreamResponse()`（文本流）
- 大日志处理：复用 splitter 的 condense 逻辑生成摘要，不分块合并（思考阶段做概览）

### 现有：`/api/analyze`

- 行为不变，仍用 `generateObject()` 返回完整 `AnalysisResult`
- 保持现有分块合并逻辑

## 前端 UI

### 思考区域

在 AnalysisPanel 顶部新增可折叠的 "Thinking" 区域：

- **展开状态**：显示流式进入的思考文本，终端风格打字效果，带闪烁光标动画
- **折叠状态**：一行 "AI 思考过程 (已折叠)"，可点击展开
- **颜色**：使用 `--accent-cyan` 区分思考文本和正式分析结果
- **默认行为**：思考阶段自动展开，流结束后自动折叠
- 用户可随时手动折叠/展开

### 分析流程状态

`page.tsx` 新增状态：

- `thinkingText: string` — 累积的思考文本
- `isThinking: boolean` — 思考流是否进行中
- `isAnalyzing: boolean` — 结构化分析是否进行中

流程时序：
1. 用户提交日志 → `isThinking = true`，思考区域展开，流式文本开始显示
2. 思考流完成 → `isThinking = false`，`isAnalyzing = true`，思考区域自动折叠，调用 `/api/analyze`
3. 结构化结果返回 → `isAnalyzing = false`，AnalysisPanel 正常渲染

### 指示器

- 思考阶段：顶部进度条 + 标题显示 "THINKING"（替代现有 "SCANNING"）
- 分析阶段：进度条继续 + 标题显示 "ANALYZING"
- 思考区域有闪烁光标动画表示正在接收

## 思考 Prompt

在 `lib/prompts.ts` 新增 `buildThinkingPrompt()`：

- 不要求结构化输出，引导 LLM 自由叙述分析思路
- 内容导向：概述日志关键发现、指出可疑错误模式、解释推理思路
- 简洁原则：指示 LLM 简要总结发现，不做完整分析（完整分析留给结构化端点）
- 同样接受 `ragContext` 参数

## 需要修改的文件

| 文件 | 修改内容 |
|------|---------|
| `src/app/api/analyze/thinking/route.ts` | **新增** — 思考流端点 |
| `src/lib/prompts.ts` | 新增 `buildThinkingPrompt()` |
| `src/app/page.tsx` | 新增 thinkingText/isThinking 状态，串行调用两个端点，修改指示器文本 |
| `src/components/AnalysisPanel.tsx` | 新增可折叠思考区域，接收 thinkingText/isThinking props |
| `src/lib/types.ts` | 无需修改（AnalysisResult 类型不变） |

## 验证

1. 启动 dev server，粘贴日志提交分析
2. 确认思考文本实时流式显示在可折叠区域
3. 确认思考流结束后自动折叠，结构化结果正常渲染
4. 确认可手动折叠/展开思考区域
5. 测试大日志（>20k tokens）的思考阶段是否正常工作
6. 测试 RAG 不可用时思考和分析是否都能正常完成
7. 测试 OpenAI provider（无 thinking 特性）是否正常走思考端点
