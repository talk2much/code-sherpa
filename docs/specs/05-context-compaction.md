# 05 Context 压缩规格

## 决策确认

- **LLM**：DeepSeek V4 Pro，128K 上下文窗口
- **挑战**：LPGJ 单个文件可达几千行，10,000 文件总量巨大，无法全量加载
- **目标**：在保持分析精度的前提下，将代码上下文压缩到 LLM 可处理的范围

---

## 三层压缩策略

```
原始代码上下文
      │
      ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  行级压缩     │ → │  符号级压缩   │ → │  语义级压缩   │
│ Line Compact │    │ Symbol Compact│    │ Semantic Compact│
└──────────────┘    └──────────────┘    └──────────────┘
      │                  │                  │
      ▼                  ▼                  ▼
  删除空行/注释      只保留签名/接口      自然语言摘要
  保留行号映射       删除实现体          替代代码块
```

---

## Layer 1: 行级压缩（Line Compact）

**目标**：减少文件内容的 Token 数，同时保留可定位性

### 规则

```typescript
function lineCompact(content: string): CompactResult {
  const lines = content.split('\n');
  const compacted: CompactLine[] = [];
  let removedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 1. 删除纯空行（但保留行号映射）
    if (trimmed === '') {
      removedCount++;
      continue;
    }

    // 2. 删除纯注释行（JSDoc 保留前 2 行）
    if (trimmed.startsWith('//') && !trimmed.startsWith('///')) {
      removedCount++;
      continue;
    }

    // 3. 压缩连续 import 块（保留前 3 个和最后 1 个，中间用注释省略）
    if (isImportLine(trimmed)) {
      if (isInImportBlock(lines, i)) {
        // 处理见下方
      }
    }

    // 4. 保留行号信息
    compacted.push({
      originalLineNumber: i + 1,
      text: line,
    });
  }

  return {
    lines: compacted,
    removedLines: removedCount,
    compressionRatio: compacted.length / lines.length,
  };
}
```

### 效果预估

| 文件类型 | 原始行数 | 压缩后行数 | 压缩率 |
|---------|---------|-----------|--------|
| 普通 TS 文件 | 300 | 220 | 27% |
| 大 Contract 文件 | 3000 | 1800 | 40% |
| 类型定义文件 | 500 | 350 | 30% |
| 测试文件 | 800 | 500 | 38% |

---

## Layer 2: 符号级压缩（Symbol Compact）

**目标**：当需要展示多个相关文件时，只保留每个文件的"骨架"

### 策略：接口保留，实现省略

```typescript
function symbolCompact(content: string, filePath: string): string {
  // 使用 AST 提取符号骨架
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true
  );

  const skeleton: string[] = [];

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isInterfaceDeclaration(node)) {
      // 保留接口定义，但省略注释和装饰器
      skeleton.push(`interface ${node.name.text} {`);
      node.members.forEach((member) => {
        skeleton.push(`  ${member.getText(sourceFile).split('\n')[0]};`);
      });
      skeleton.push(`}`);
    }
    else if (ts.isFunctionDeclaration(node) && node.name) {
      // 保留函数签名，省略实现
      const signature = `function ${node.name.text}(${node.parameters.map(p => p.getText(sourceFile)).join(', ')}): ${node.type?.getText(sourceFile) ?? 'void'};`;
      skeleton.push(signature);
    }
    else if (ts.isTypeAliasDeclaration(node)) {
      // 保留类型别名（通常较短）
      skeleton.push(`type ${node.name.text} = ${node.type.getText(sourceFile)};`);
    }
    // ... 其他符号类型
  });

  return skeleton.join('\n');
}
```

### 示例

原始文件（150 行）：
```typescript
// 大量实现...
export async function createOrder(input: CreateOrderInput): Promise<CustomerOrder> {
  // 50 行验证逻辑
  // 30 行数据库操作
  // 20 行返回处理
}
```

Symbol Compact 后（1 行）：
```typescript
function createOrder(input: CreateOrderInput): Promise<CustomerOrder>;
```

### 使用场景

- **影响面分析**：展示"哪些文件受影响"时，只给每个文件的符号骨架
- **多文件对比**：同时查看 5 个相关文件时，每个文件压缩到 < 50 行

---

## Layer 3: 语义级压缩（Semantic Compact）

**目标**：当代码块太长但语义明确时，用自然语言摘要替代

### 策略

```typescript
interface SemanticCompactOptions {
  maxLines: number;         // 超过此行数才触发
  strategy: 'summarize' | 'extract_signatures' | 'show_callsite';
}

async function semanticCompact(
  filePath: string,
  content: string,
  options: SemanticCompactOptions
): Promise<string> {
  const lines = content.split('\n');

  if (lines.length <= options.maxLines) {
    return content;  // 不需要压缩
  }

  switch (options.strategy) {
    case 'summarize':
      // 用 LLM 生成摘要（仅在必要时，因为耗时）
      return await llmSummarize(content, filePath);

    case 'extract_signatures':
      // 提取所有导出符号的签名
      return symbolCompact(content, filePath);

    case 'show_callsite':
      // 只展示被查询符号的调用点，省略其他
      return extractCallSites(content, targetSymbol);
  }
}
```

### LLM 摘要 Prompt 模板

```
请用 3-5 句话概括以下代码文件的核心功能。
保留关键类型名、函数名和架构决策。
不要描述实现细节。

文件路径: {filePath}
代码:
{content}

摘要格式:
- 用途: [一句话]
- 关键导出: [符号列表]
- 依赖: [主要依赖的模块]
- 注意: [任何特殊设计]
```

### 使用场景

- **超大文件（>2000 行）**：先展示摘要，用户需要时再 `file_read` 加载具体区域
- **历史版本对比**：展示 Git diff 的语义摘要而非原始 diff

---

## 压缩决策树

Agent 在加载代码上下文时，按以下决策树选择压缩策略：

```
文件内容长度？
  │
  ├── ≤ 100 行 ──→ 不压缩，全文加载
  │
  ├── 100-500 行 ──→ Line Compact（删除空行/注释）
  │
  ├── 500-2000 行 ──→ Symbol Compact（保留骨架）
  │      │
  │      └── 如果用户问具体实现 ──→ file_read 按需加载相关区域
  │
  └── > 2000 行 ──→ Semantic Compact（LLM 摘要）
         │
         └── 如果用户追问细节 ──→ file_read offset + limit 精确加载
```

---

## Token 预算管理

### 单次查询的 Token 分配

DeepSeek V4 Pro 128K 上下文分配策略：

```
总预算: 128K tokens
  │
  ├── System Prompt（含 Skill + 领域知识）: ~4K tokens
  │
  ├── Tool Definitions: ~2K tokens
  │
  ├── Workspace Memory 注入: ~2K tokens
  │
  ├── 对话历史（messages）: ~10K tokens
  │
  ├── Tool Results（代码上下文）: ~100K tokens ★ 主要变量
  │      │
  │      ├── file_read 结果: 按文件大小动态分配
  │      ├── grep_search 结果: 最多 20 条，每条 < 200 tokens
  │      ├── ast_query 结果: 精确结果，通常 < 5K tokens
  │      └── vector_search 结果: Top 5 代码块，每块 < 2K tokens
  │
  └── 推理空间: ~10K tokens
```

### 动态预算调整

```typescript
interface TokenBudget {
  total: number;        // 128K
  used: number;         // 已用
  remaining: number;    // 剩余

  // 分配策略
  allocateForTool(toolName: string, estimatedResult: string): number;
  // 如果剩余不足，触发 Context Compact
}

function beforeToolCall(
  budget: TokenBudget,
  toolCall: ToolCall
): void {
  const estimatedTokens = estimateToolResultTokens(toolCall);

  if (budget.remaining - estimatedTokens < 10000) {
    // 预留 10K 给推理，不足则压缩
    compactContext(messages, budget);
  }
}
```

### Context Compact 触发时机

1. **预防性**：每次迭代前检查预算，不足先压缩
2. **反应性**：LLM API 返回 413（context too long）时紧急压缩
3. **策略性**：主动丢弃低相关度的 Tool Results

---

## 压缩质量保障

### 原则：可逆性

所有压缩必须保留**解压线索**，确保 Agent 能获取原始信息：

```typescript
interface CompactResult {
  compactedContent: string;
  compressionType: 'line' | 'symbol' | 'semantic';
  originalLineCount: number;
  lineMap?: Record<number, number>;  // 压缩后行号 -> 原始行号
  fullContentAvailable: boolean;     // 是否可以通过 file_read 获取全文
  filePath: string;                  // 用于按需加载原文
}
```

### Agent 使用规范

```
## Context 压缩规范

1. 优先使用 symbol_graph_query 和 ast_query，它们返回精确结果，Token 效率高
2. file_read 时始终指定 offset + limit，避免加载整文件
3. 如果 Tool Result 被压缩，明确告知用户"内容已压缩，需要完整内容请指定行号范围"
4. 单次迭代中，所有 Tool Results 的总 Token 数不得超过 80K
```

---

## 与 learn-claude-code 的对应

| learn-claude-code | code-sherpa |
|-------------------|-------------|
| s08 Context Compact | 三层压缩体系 |
| snipCompact | Line Compact（删除空行/注释） |
| microCompact | Symbol Compact（保留骨架） |
| toolResultBudget | Token 预算管理 |
| autoCompact | 动态压缩触发 |

**关键差异**：learn-claude-code 的 compact 主要针对对话历史，code-sherpa 的 compact 主要针对**代码文件内容**——这是代码治理 Agent 的核心挑战。
