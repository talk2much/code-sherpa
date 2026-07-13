# 04 Memory 系统规格

## 决策确认

- **架构**：单 Agent（MVP），但 Memory 按三级设计，预留多 Agent 扩展
- **持久化**：文件系统（JSONL / SQLite）
- **目标**：支持长期运行中的知识积累和自我改进

---

## 三级记忆架构

```
┌─────────────────────────────────────────────┐
│              用户查询（Query）                │
└─────────────────┬───────────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    ▼             ▼             ▼
┌────────┐  ┌──────────┐  ┌──────────┐
│ Session│  │ 工作区   │  │  长期    │
│  Memory│  │ Memory   │  │ Memory   │
│(当前会话)│  │(当前项目) │  │(跨项目)  │
└────┬───┘  └────┬─────┘  └────┬─────┘
     │           │             │
     ▼           ▼             ▼
  短期缓存    符号图/索引    用户偏好
  对话历史    领域知识       修正记录
  中间结果    文件访问模式   全局模式
```

---

## Level 1: Session Memory（会话级）

**生命周期**：一次 CLI 命令执行期间
**存储**：内存（Map/对象）
**容量**：无限制（但受限于 LLM 上下文窗口）

### 内容

```typescript
interface SessionMemory {
  // 1. 对话历史
  messages: Message[];

  // 2. 已访问文件缓存（避免重复读取）
  fileCache: Map<string, FileCacheEntry>;

  // 3. 已查询符号缓存
  symbolCache: Map<string, SymbolInfo>;

  // 4. 中间分析结果
  partialResults: Map<string, any>;

  // 5. 当前迭代计数（防止无限循环）
  iterationCount: number;

  // 6. 已使用 Tools（用于去重和审计）
  executedTools: ToolCall[];
}

interface FileCacheEntry {
  content: string;
  lines: number;
  lastRead: number;    // 时间戳
  accessCount: number; // 访问次数（用于 LRU）
}
```

### 行为

- **文件缓存**：同一个文件在单次查询中只读一次，后续从缓存取
- **LRU 淘汰**：如果缓存超过 50 个文件，淘汰最少访问的
- **不会话间共享**：每次 `code-sherpa` 命令结束后清空

---

## Level 2: Workspace Memory（工作区级）

**生命周期**：绑定特定目标代码库（如 LPGJ），持久化存储
**存储**：`index/{target}/workspace-memory.jsonl`
**容量**：MB 级

### 内容

```typescript
interface WorkspaceMemory {
  target: string;           // "lpgj"
  lastUpdated: number;

  // 1. 项目结构知识（加速定位）
  projectMap: {
    packages: string[];     // ["@lpgj/contracts", "@lpgj/database", ...]
    apps: string[];         // ["server", "admin-web", "user-miniapp", ...]
    keyFiles: Record<string, string>;  // 别名 -> 路径映射
  };

  // 2. 高频访问模式（用于预加载建议）
  accessPatterns: {
    filePath: string;
    accessCount: number;
    lastAccess: number;
    typicalQueries: string[];  // 该文件通常被什么查询访问
  }[];

  // 3. 领域知识摘要（预生成的 LPGJ 知识）
  domainKnowledge: {
    ubiquitousLanguage: Record<string, string>;  // 术语 -> 定义
    keyConcepts: string[];
    architectureSummary: string;
  };

  // 4. 查询历史（用于相似查询推荐）
  queryHistory: {
    query: string;
    timestamp: number;
    answer: string;
    relevantFiles: string[];
  }[];

  // 5. 修正记录（用户纠正过 Agent 的错误）
  corrections: {
    originalAnswer: string;
    correction: string;
    filePath: string;
    timestamp: number;
  }[];
}
```

### 用途

- **加速启动**：Agent 启动时加载 workspace memory，无需重新了解项目结构
- **相似查询**：用户问"Order 相关"时，推荐之前成功的查询路径
- **错误避免**：如果之前某次分析被用户纠正过，下次遇到类似场景提醒 Agent

### 写入时机

```typescript
// 查询结束后，如果用户明确给出反馈（👍 / 👎 / 修正）
// 或者查询涉及新的高频文件，自动更新 accessPatterns

async function updateWorkspaceMemory(
  session: SessionMemory,
  userFeedback?: UserFeedback
): Promise<void> {
  const memory = loadWorkspaceMemory(target);

  // 更新访问模式
  for (const [path, entry] of session.fileCache) {
    updateAccessPattern(memory, path, entry.accessCount);
  }

  // 记录查询
  memory.queryHistory.push({
    query: session.messages[0].content,
    timestamp: Date.now(),
    answer: session.messages[session.messages.length - 1].content,
    relevantFiles: [...session.fileCache.keys()],
  });

  // 记录修正
  if (userFeedback?.type === 'correction') {
    memory.corrections.push({
      originalAnswer: userFeedback.original,
      correction: userFeedback.correction,
      filePath: userFeedback.filePath,
      timestamp: Date.now(),
    });
  }

  await saveWorkspaceMemory(memory);
}
```

---

## Level 3: Long-term Memory（长期记忆）

**生命周期**：跨项目、跨会话，长期积累
**存储**：`~/.code-sherpa/long-term-memory.jsonl`
**容量**：GB 级（但定期压缩）

### 内容

```typescript
interface LongTermMemory {
  // 1. 用户偏好（跨项目通用）
  userPreferences: {
    preferredOutputFormat: 'detailed' | 'summary' | 'json';
    maxIterationsPreference: number;
    commonlyUsedTargets: string[];
  };

  // 2. 全局模式识别（跨项目通用知识）
  globalPatterns: {
    pattern: string;           // 如 "Fastify + ts-rest + Zod 架构"
    description: string;       // 该架构的典型文件组织方式
    seenIn: string[];          // 在哪些项目见过
  }[];

  // 3. 工具使用经验（什么场景用什么 Tool 最有效）
  toolExperience: {
    scenario: string;          // 查询场景描述
    recommendedTools: string[]; // 推荐 Tool 组合
    successRate: number;       // 成功率（基于用户反馈）
  }[];

  // 4. 跨项目符号别名（如不同项目都可能有 "User" 类型）
  symbolAliases: Record<string, string[]>;
}
```

### 用途

- **跨项目迁移**：如果你在 LPGJ 上学会了"ts-rest 契约追踪"，在下一个项目遇到类似架构时自动应用
- **个人化**：记住你喜欢详细输出还是摘要

---

## 记忆注入 Prompt 的策略

不同级别的记忆以不同方式注入 System Prompt：

```
[System Prompt 组装]
  │
  ├── Level 3 (长期记忆)
  │     └─ 用户偏好："用户喜欢详细输出，包含文件路径和行号"
  │
  ├── Level 2 (工作区记忆)
  │     ├─ 领域知识摘要（预生成）
  │     ├─ 高频文件 Top 10（快速参考）
  │     └─ 相关修正（如果有相似查询历史）
  │
  └── Level 1 (会话记忆)
        └─ 当前对话历史（messages 数组）
```

### 注入规则

| 记忆级别 | 注入方式 | Token 预算 |
|---------|---------|-----------|
| Level 3 | 用户偏好摘要（< 200 tokens） | 固定 |
| Level 2 | 领域知识 + 最近 5 次查询（< 2K tokens） | 动态 |
| Level 1 | 完整对话历史 | 剩余全部 |

---

## 记忆压缩（与 s08 Context Compact 联动）

当工作区记忆过大时：

```typescript
function compactWorkspaceMemory(memory: WorkspaceMemory): WorkspaceMemory {
  // 1. 查询历史只保留最近 100 条
  memory.queryHistory = memory.queryHistory.slice(-100);

  // 2. 低频访问模式淘汰（保留 Top 50）
  memory.accessPatterns = memory.accessPatterns
    .sort((a, b) => b.accessCount - a.accessCount)
    .slice(0, 50);

  // 3. 修正记录按文件聚合（同一文件的多次修正合并为最新）
  memory.corrections = dedupeByFilePath(memory.corrections);

  return memory;
}
```

---

## 与 learn-claude-code 的对应

| learn-claude-code | code-sherpa |
|-------------------|-------------|
| s09 Memory（选择/提取/固化） | 三级记忆体系 |
| Session 级 Memory | Level 1 Session Memory |
| 文件持久化 Memory | Level 2 Workspace Memory |
| 无跨项目 Memory | Level 3 Long-term Memory（新增） |
| Context Compact（snip/micro/budget） | 记忆压缩 + 分级注入 |

---

## Phase 2 扩展：多 Agent 记忆共享

当引入 Multi-Agent 时，Workspace Memory 增加：

```typescript
interface MultiAgentWorkspaceMemory extends WorkspaceMemory {
  // Agent 间共享的上下文
  sharedContext: {
    taskGraph: TaskRecord[];     // s12 Task System
    agentStates: Record<string, AgentState>;  // 各 Agent 当前状态
    messageBus: Message[];       // s15 Agent Teams 的 mailbox
  };
}
```
