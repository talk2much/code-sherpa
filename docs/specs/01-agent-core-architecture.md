# 01 Agent 核心架构规格

## 决策确认

- **架构模式**：A（单 Loop + 多 Skill，MVP 期）
- **参考基础**：learn-claude-code s01-s07 + s20 Comprehensive
- **演化路径**：Phase 2 引入 Multi-Agent（s15-s18）

---

## 核心公式

```
code-sherpa Agent = One Loop + Tools + Skills + Memory + Context Control
```

---

## Agent Loop 设计

### 基本结构（源自 s01，适配代码治理）

```typescript
// src/core/loop.ts

interface AgentLoopConfig {
  model: string;           // "deepseek-chat" (V4 Pro)
  maxTokens: number;       // 根据任务动态调整
  temperature: number;     // 分析任务 0.1-0.3，探索任务 0.5-0.7
  skill: Skill;            // 当前加载的 Skill
  target: TargetConfig;    // 目标代码库
}

async function agentLoop(
  query: string,
  config: AgentLoopConfig
): Promise<AgentResult> {
  const messages: Message[] = [
    { role: 'system', content: buildSystemPrompt(config) },
    { role: 'user', content: query },
  ];

  const executedTools: ToolCall[] = [];

  while (executedTools.length < MAX_ITERATIONS) {
    const response = await deepseek.chat.completions.create({
      model: config.model,
      messages,
      tools: getToolDefinitions(config.skill),
      tool_choice: 'auto',
    });

    const assistantMsg = response.choices[0].message;
    messages.push(assistantMsg);

    // 没有 Tool Call，直接返回
    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      return {
        answer: assistantMsg.content,
        executedTools,
        iterations: executedTools.length,
      };
    }

    // 执行 Tool Calls
    const results = await Promise.all(
      assistantMsg.tool_calls.map(async (tc) => {
        const result = await executeTool(tc, config);
        executedTools.push({ tool: tc.function.name, args: tc.function.arguments });
        return {
          tool_call_id: tc.id,
          role: 'tool' as const,
          content: JSON.stringify(result),
        };
      })
    );

    messages.push(...results);
  }

  throw new Error(`Max iterations (${MAX_ITERATIONS}) reached`);
}
```

### 关键参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `MAX_ITERATIONS` | 15 | 防止无限循环 |
| `MODEL` | `deepseek-chat` | DeepSeek V4 Pro |
| `MAX_TOKENS` | 动态 | 简单查询 4K，复杂分析 64K，全文加载 128K |
| `TEMPERATURE` | 0.2 | 代码分析需要确定性 |

---

## Skill 系统设计（源自 s07）

### Skill 定义

```typescript
// src/core/skill.ts

interface Skill {
  name: string;
  description: string;
  systemPromptTemplate: string;    // Markdown 文件 body，含 {{占位符}}
  availableTools: string[];        // 该 Skill 可使用的 Tool 白名单
  planningStrategy: PlanningStrategy;
}

type PlanningStrategy = 
  | 'single_shot'      // 一次完成，不拆解
  | 'sequential'       // 按步骤顺序执行
  | 'map_reduce';      // 分片处理再聚合
```

### Skill 源文件格式

Skill 以 `.skill.md` 文件维护——**Markdown 是源，人是作者，LLM 是读者**。Frontmatter 定义元数据，body 直接就是 System Prompt 模板：

```markdown
---
name: impact-analysis
description: 分析修改某个符号会影响的代码范围
tools:
  - file_read
  - grep_search
  - ast_query
  - db_schema_read
  - contract_trace
planning: sequential
---

# 角色
你是代码影响面分析专家。你的任务是追踪符号在代码库中的所有引用。

# 分析步骤
1. 找到直接引用
2. 找到间接引用
3. 检查数据库模型
4. 检查前端页面
5. 生成报告

# 输出要求
- 必须提供准确的文件路径和行号
- 不确定时要明确标注"推测"

{{domain_knowledge}}
{{project_structure}}
```

运行时由 loader 解析 frontmatter 拿到结构化字段，body 作为 `systemPromptTemplate`，替换 `{{占位符}}` 后注入最终 System Prompt。

> **为什么选 Markdown？** Skill 的核心资产是 prompt 文本，不是数据结构。Markdown 让人能以自然段落、标题层级、列表来组织 prompt——这些在 TS 字符串数组里全部丢失。Frontmatter 解决结构化元数据（name、tools、planning），body 解决 prompt 文本，各司其职。Claude Code（`.claude/agents/*.md`）、Cursor（`.cursorrules`）都选了这条路，这是行业共识。MVP 期只有 2 个 skill 时 TS 对象也能用，但 `.skill.md` 格式从一开始就为扩展留好了空间——新增 skill 就是新增一个文件，零代码改动。

### MVP 期两个 Skill

#### 1. impact-analysis（影响面分析）

文件：`skills/impact-analysis.skill.md`（内容如上）

#### 2. code-archaeology（代码考古）

文件：`skills/code-archaeology.skill.md`

### Skill 加载机制

```typescript
// src/core/skill-loader.ts

import { parse as parseFrontmatter } from 'yaml';

function loadSkill(name: string, target: TargetConfig): Skill {
  // 1. 读取 .skill.md 文件
  const raw = readFile(`skills/${name}.skill.md`);

  // 2. 解析 frontmatter → { name, description, tools, planning }
  const { frontmatter, body } = parseFrontmatter(raw);

  // 3. 构建 Skill 对象：body 作为模板，运行时注入上下文
  return {
    name: frontmatter.name,
    description: frontmatter.description,
    systemPromptTemplate: body,      // MD body 原样保留，含 {{占位符}}
    availableTools: frontmatter.tools,
    planningStrategy: frontmatter.planning,
  };
}

function buildSystemPrompt(config: AgentLoopConfig): string {
  // 运行时上下文
  const runtimeSections = {
    domain_knowledge: loadDomainKnowledge(config.target),
    project_structure: loadProjectStructure(config.target),
  };

  // 替换模板中的 {{占位符}}
  let prompt = config.skill.systemPromptTemplate;
  for (const [key, value] of Object.entries(runtimeSections)) {
    prompt = prompt.replaceAll(`{{${key}}}`, value);
  }

  // 外围框架
  const sections = [
    baseSystemPrompt,           // Agent 基础行为约束
    prompt,                     // Skill 模板（已注入运行时上下文）
    toolUsageGuidelines,        // Tool 使用规范
    outputFormatRequirements,   // 输出格式要求
  ];
  return sections.join('\n\n---\n\n');
}
```

---

## System Prompt 组装（源自 s10）

### 运行时组装结构

```
[Base Agent Identity]
  └─ 你是 code-sherpa，代码治理 Agent。你严格只读，不修改代码。

[Skill Template（来自 .skill.md body）]  ← 已替换 {{占位符}}
  ├─ Skill 角色定义
  ├─ 分析步骤
  ├─ {{domain_knowledge}}    → 替换为 LPGJ 领域知识摘要
  └─ {{project_structure}}   → 替换为项目结构地图

[Tool Usage Guidelines]
  └─ 当前 Skill 可用的 Tools

[Output Format Requirements]
  └─ 必须包含文件路径和行号
  └─ 不确定时标注置信度
  └─ 引用必须经过验证
```

> **设计决策**：Domain Knowledge 和 Project Structure 不作为独立段落注入，而是通过 `{{占位符}}` 替换到 Skill 模板中。这样 Skill 作者可以自由决定这些信息出现在 prompt 中的位置——放在角色定义之后、放在步骤说明之中、还是放在末尾作为附录。

### 领域知识压缩

LPGJ 的文档很大，不能直接全塞进 Prompt。采用摘要 + 按需加载：

```typescript
function loadDomainKnowledge(target: TargetConfig): string {
  // 预生成的知识摘要（手工维护或自动提炼）
  return `
# LPGJ 领域知识（摘要）

## 核心概念
- RawPhoto: 商家上传的原始照片
- BaseRetouch: AI 初修后的预览级资产
- StandardRetouch: 常规可售卖精修
- MasterRetouch: 专家+AI 深度加工的高溢价资产
- Album: 一次拍摄的照片集合
- ProductionOrder: 修图生产工单

## 关键约束
- 照片从上传到售卖有严格状态机
- 专家资源有限，需要调度
- 交易涉及分账结算

## 架构要点
- Monorepo: apps/ + packages/
- API: Fastify + ts-rest + Zod
- DB: Prisma + PostgreSQL
- 前端: React + Vite + 微信小程序
`;
}
```

---

## 扩展点设计（源自 s04 Hooks）

预留以下生命周期钩子：

```typescript
interface HookRegistry {
  'pre:tool_use': (toolCall: ToolCall, config: AgentLoopConfig) => Promise<void>;
  'post:tool_use': (toolCall: ToolCall, result: ToolResult, config: AgentLoopConfig) => Promise<void>;
  'pre:iteration': (messages: Message[], config: AgentLoopConfig) => Promise<void>;
  'post:iteration': (messages: Message[], config: AgentLoopConfig) => Promise<void>;
}
```

MVP 期只实现 `post:tool_use` 用于日志记录。

---

## Phase 2：Multi-Agent 演化（预留）

当单 Agent 无法处理复杂查询时，引入 Specialist Agent：

```
User Query: "为什么订单模块这么复杂？"
  │
  ▼
[Router Agent] —— 判断需要代码考古
  │
  ├──> [Code Archaeologist] —— 查 Git 历史、架构文档
  │      └── 返回：历史演变时间线
  │
  ├──> [Impact Analyst] —— 查当前依赖关系
  │      └── 返回：模块耦合图
  │
  └──> [Synthesizer Agent] —— 聚合结果，生成回答
         └── 返回：完整解释
```

实现时机：当单 Agent 的迭代次数经常触达 MAX_ITERATIONS 时。

---

## 与 learn-claude-code 的差异

| 维度 | learn-claude-code | code-sherpa |
|------|-------------------|-------------|
| 领域 | 通用教学 | 代码治理专用 |
| Tool 集 | Bash/Read/Edit/Glob/Grep 通用 | AST/Contract/Git/Schema 专用 |
| 目标 | 理解原理 | 解决真实问题 |
| Skill 切换 | 手动 | 基于查询自动选择 |
| 输出 | 教学代码 | 可验证的分析报告 |
