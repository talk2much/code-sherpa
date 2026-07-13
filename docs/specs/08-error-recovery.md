# 08 错误恢复规格

## 决策确认

- **校验策略**：A（硬校验）——所有 Agent 输出必须经过验证
- **目标**：Agent 系统必须优雅处理不确定性，不能"沉默地错"

---

## 错误分类体系

```
错误
├── 1. 工具执行错误
│   ├── 文件不存在
│   ├── 路径遍历攻击
│   ├── 索引未构建/过期
│   └── 外部命令失败（git/rg）
│
├── 2. LLM 推理错误
│   ├── 幻觉：编造不存在的文件/符号
│   ├── 误解：错误理解用户意图
│   ├── 循环：重复调用相同 Tool
│   └── 越界：超出 Token 限制
│
├── 3. 索引数据错误
│   ├── 符号图与实际代码不一致（代码已改，索引未更新）
│   ├── AST 解析失败（语法错误文件）
│   └── 向量索引失效（embedding 模型变更）
│
└── 4. 系统性错误
    ├── LLM API 不可用
    ├── 内存不足（加载大索引）
    └── 磁盘空间不足
```

---

## 三级降级策略

### Level 1: 重试（Retry）

**适用**：瞬时错误、API 超时、网络抖动

```typescript
async function executeWithRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries: 3;
    backoff: 'exponential';  // 1s, 2s, 4s
    retryableErrors: string[];
  }
): Promise<T> {
  for (let i = 0; i < options.maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryable(error) || i === options.maxRetries - 1) {
        throw error;
      }
      await sleep(Math.pow(2, i) * 1000);
    }
  }
}
```

**应用场景**：
- LLM API 429（Rate Limit）
- `git log` 命令超时
- `rg` 搜索大目录超时

### Level 2: 简化（Fallback）

**适用**：主要路径失败，但有替代方案

```typescript
async function queryWithFallback(
  primaryQuery: () => Promise<Result>,
  fallbackQuery: () => Promise<Result>,
  simpleQuery: () => Promise<Result>
): Promise<Result> {
  try {
    return await primaryQuery();  // 首选：精确 AST 查询
  } catch (error) {
    log.warn('Primary query failed, falling back:', error.message);
    try {
      return await fallbackQuery();  // 降级：符号图查询
    } catch (error2) {
      log.warn('Fallback failed, using simple query:', error2.message);
      return await simpleQuery();  // 最终：文本搜索
    }
  }
}
```

**具体降级链**：

| 场景 | 首选 | 降级 1 | 降级 2 |
|------|------|--------|--------|
| 找引用 | `ast_query`（精确） | `symbol_graph_query`（预建索引） | `grep_search`（文本） |
| 语义搜索 | `vector_search`（向量索引） | `grep_search`（关键词） | `file_read`（人工指定） |
| 代码考古 | `git_log` + LLM 摘要 | `git_log` 原始输出 | 文件修改时间 |
| 类型理解 | `ast_query`（类型信息） | `file_read`（类型定义） | 注释/文档 |

### Level 3: 人工接管（Escalation）

**适用**：Agent 无法自信回答，或检测到严重不一致

```typescript
interface EscalationResult {
  status: 'escalated';
  reason: string;           // 为什么无法自动完成
  partialResult?: any;      // 已收集的部分信息
  suggestedActions: string[]; // 建议用户手动执行的步骤
}

function escalate(reason: string, context: any): EscalationResult {
  return {
    status: 'escalated',
    reason,
    partialResult: context.partial,
    suggestedActions: generateSuggestions(context),
  };
}
```

**触发条件**：
- 连续 3 次迭代无进展
- 置信度 < 50%
- 检测到索引与实际代码严重不一致（如符号图说有引用但文件不存在）
- LLM 连续两次给出矛盾的回答

---

## 硬校验实现（Hard Validation）

### 1. 文件路径校验

```typescript
function validateFilePath(
  claimedPath: string,
  target: TargetConfig
): ValidationResult {
  const absolutePath = path.join(target.root, claimedPath);

  // 1. 路径遍历检查
  if (!absolutePath.startsWith(target.root)) {
    return { valid: false, error: 'Path traversal detected' };
  }

  // 2. 文件存在性检查
  if (!fs.existsSync(absolutePath)) {
    return { valid: false, error: 'File does not exist' };
  }

  // 3. 行号有效性检查
  if (claimedLineNumber) {
    const lines = fs.readFileSync(absolutePath, 'utf-8').split('\n');
    if (claimedLineNumber > lines.length) {
      return { valid: false, error: 'Line number out of range' };
    }
    // 4. 内容匹配检查（声称的行号处是否真的有该符号）
    const lineContent = lines[claimedLineNumber - 1];
    if (!lineContent.includes(claimedSymbol)) {
      return {
        valid: false,
        error: 'Symbol not found at claimed location',
        actualContent: lineContent,
      };
    }
  }

  return { valid: true };
}
```

### 2. 符号引用校验

```typescript
function validateSymbolReferences(
  agentResult: ImpactAnalysisResult,
  target: TargetConfig
): ValidatedResult {
  const validated = { ...agentResult };

  validated.directReferences = agentResult.directReferences.filter(ref => {
    const v = validateFilePath(ref.filePath, target);
    if (!v.valid) {
      log.warn('Invalid reference filtered:', ref, v.error);
      return false;
    }

    // 额外：验证符号确实出现在该位置
    const content = readFileLines(ref.filePath, ref.lineNumber, 1);
    if (!content.includes(ref.symbolName || '')) {
      log.warn('Symbol mismatch at', ref.filePath, ref.lineNumber);
      return false;
    }

    return true;
  });

  validated.filteredCount =
    agentResult.directReferences.length - validated.directReferences.length;

  return validated;
}
```

### 3. 置信度评估

```typescript
function calculateConfidence(result: AgentResult): number {
  let score = 1.0;

  // 1. 引用验证通过率
  const refValidationRate = result.validatedReferences / result.totalReferences;
  score *= (0.3 + 0.7 * refValidationRate);

  // 2. 迭代次数惩罚（迭代越多，越可能是在"猜"）
  if (result.iterations > 10) {
    score *= 0.9;
  }
  if (result.iterations > 15) {
    score *= 0.8;
  }

  // 3. Tool 使用多样性（只用 grep 可能不够精确）
  const uniqueTools = new Set(result.executedTools.map(t => t.tool));
  if (uniqueTools.size < 2) {
    score *= 0.9;
  }

  // 4. 不确定性声明（Agent 自己说"可能"、"也许"）
  const uncertaintyWords = ['可能', '也许', '大概', 'should', 'might', 'probably'];
  const uncertaintyCount = uncertaintyWords.reduce(
    (count, word) => count + (result.answer.match(new RegExp(word, 'gi'))?.length ?? 0),
    0
  );
  score *= Math.max(0.7, 1 - uncertaintyCount * 0.05);

  return Math.round(score * 100) / 100;
}
```

---

## 幻觉检测机制

### 常见幻觉模式

| 幻觉类型 | 示例 | 检测方法 |
|---------|------|---------|
| 编造文件 | "在 apps/server/src/utils/order-helper.ts 中..." | 文件存在性检查 |
| 编造符号 | "OrderProcessor 类处理..." | 符号图查询验证 |
| 错误行号 | "第 999 行..."（文件只有 100 行） | 行号范围检查 |
| 张冠李戴 | "Album 组件在 order.tsx 中..." | 内容匹配检查 |
| 过时信息 | "使用旧版 API..."（已重构） | 索引时间戳对比 |

### 主动检测

```typescript
async function detectHallucination(
  agentAnswer: string,
  target: TargetConfig
): Promise<HallucinationReport> {
  const issues: HallucinationIssue[] = [];

  // 1. 提取所有声称的文件路径
  const claimedPaths = extractFilePaths(agentAnswer);
  for (const path of claimedPaths) {
    if (!fs.existsSync(path.join(target.root, path))) {
      issues.push({ type: 'fake_file', claimed: path });
    }
  }

  // 2. 提取所有声称的符号名
  const claimedSymbols = extractSymbols(agentAnswer);
  for (const symbol of claimedSymbols) {
    const exists = await querySymbolGraph(symbol);
    if (!exists) {
      issues.push({ type: 'fake_symbol', claimed: symbol });
    }
  }

  // 3. 提取所有行号引用
  const claimedLines = extractLineReferences(agentAnswer);
  for (const { path, line } of claimedLines) {
    const valid = validateLineNumber(path, line, target);
    if (!valid) {
      issues.push({ type: 'invalid_line', claimed: `${path}:${line}` });
    }
  }

  return { issues, severity: issues.length > 2 ? 'high' : issues.length > 0 ? 'medium' : 'none' };
}
```

---

## 错误恢复的用户体验

### 输出格式

当发生错误或降级时，Agent 必须在输出中明确说明：

```
═══════════════════════════════════════════════
  ⚠ 部分结果可能不准确
═══════════════════════════════════════════════

原因:
  - 索引已过期（最后更新: 2024-06-01, 建议运行: code-sherpa index:update）
  - 2 处引用未通过验证，已过滤

可靠结果（已验证）:
  - apps/server/src/routes/order.ts:45 ✓
  - apps/admin-web/src/pages/orders/columns.tsx:12 ✓

未验证结果（需人工确认）:
  - apps/user-miniapp/src/pages/order/detail.tsx:8 ⚠
    （该文件在索引中存在，但符号匹配失败）

建议操作:
  1. 运行 code-sherpa index:update --target lpgj
  2. 手动确认 user-miniapp 的引用
═══════════════════════════════════════════════
```

---

## 与 learn-claude-code 的对应

| learn-claude-code s11 | code-sherpa |
|-----------------------|-------------|
| Token escalation | Token 预算管理 + Context Compact |
| Fallback model | 三级降级策略（Retry → Fallback → Escalation） |
| Retry strategies | 工具级重试 + 查询级降级 |
| 无硬校验概念 | **新增**：硬校验 + 幻觉检测 |

**关键差异**：learn-claude-code 主要处理"LLM 不给力怎么办"，code-sherpa 还需要处理"LLM 说错了怎么办"——这是代码治理 Agent 特有的挑战，因为错误的代码分析比不分析更危险。

---

## 监控与告警（Phase 2）

```typescript
interface AgentTelemetry {
  query: string;
  skill: string;
  duration: number;
  iterations: number;
  toolsUsed: string[];
  confidence: number;
  validationRate: number;
  hallucinationCount: number;
  errors: ErrorRecord[];
}

// 定期生成报告
async function generateHealthReport(): Promise<void> {
  const telemetry = loadTelemetry();

  // 关键指标
  const avgConfidence = average(telemetry.map(t => t.confidence));
  const hallucinationRate = telemetry.filter(t => t.hallucinationCount > 0).length / telemetry.length;
  const validationFailureRate = telemetry.filter(t => t.validationRate < 0.9).length / telemetry.length;

  // 告警条件
  if (avgConfidence < 0.7) {
    alert('Agent 平均置信度过低，建议检查索引质量');
  }
  if (hallucinationRate > 0.1) {
    alert('幻觉率超过 10%，建议增强校验规则');
  }
}
```
