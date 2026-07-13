# code-sherpa 技术规格总览

> 面向大型 TypeScript monorepo 的智能代码治理 Agent
> 
> 测试场：LPGJ（10,000+ TS 文件）
> 
> LLM：DeepSeek V4 Pro
> 
> 架构原则：单 Loop + 多 Skill（MVP），预构建索引，硬校验输出

---

## 规格清单

| 编号 | 规格 | 状态 | 核心决策 |
|------|------|------|---------|
| 00 | [工作区配置](00-workspace-config.md) | Draft | 三项目平行目录，code-sherpa 只读 LPGJ |
| 01 | [Agent 核心架构](01-agent-core-architecture.md) | Draft | 单 Loop + Tool Registry + Skill Loading |
| 02 | [代码索引与 RAG](02-code-indexing-rag.md) | Draft | 预构建符号图 + 增量更新 + 向量片段 |
| 03 | [Tool 接口](03-tool-interface.md) | Draft | 8 个核心 Tool，强类型 Schema |
| 04 | [Memory 系统](04-memory-system.md) | Draft | 三级记忆：Session / 工作区 / 长期 |
| 05 | [Context 压缩](05-context-compaction.md) | Draft | 三层压缩：行级 / 符号级 / 语义级 |
| 06 | [CLI 交互](06-cli-interface.md) | Draft | 命令式 + 交互式双模式 |
| 07 | [测试 Fixtures](07-testing-fixtures.md) | Draft | LPGJ 子集隔离 + 确定性验证 |
| 08 | [错误恢复](08-error-recovery.md) | Draft | 三级降级：重试 / 简化 / 人工 |
| 09 | [为什么不用 Claude Code](09-why-not-claude-code.md) | Draft | 符号依赖图 vs grep，硬校验 vs LLM 推测 |

---

## 与 learn-claude-code 的映射

```
learn-claude-code          code-sherpa
-----------------          -----------
s01 Agent Loop       →     01-agent-core-architecture.md
s02 Tool Use         →     03-tool-interface.md
s03 Permission       →     00-workspace-config.md（只读边界）
s04 Hooks            →     01-agent-core-architecture.md（扩展点）
s05 TodoWrite        →     01-agent-core-architecture.md（Planning）
s06 Subagent         →     预留（Phase 2 多 Agent）
s07 Skill Loading    →     01-agent-core-architecture.md（Skill 系统）
s08 Context Compact  →     05-context-compaction.md
s09 Memory           →     04-memory-system.md
s10 System Prompt    →     01-agent-core-architecture.md（Prompt 组装）
s11 Error Recovery   →     08-error-recovery.md
s12 Task System      →     预留（Phase 2 持久化任务）
s15-s18 Teams        →     预留（Phase 2 多 Agent 协作）
s19 MCP Plugin       →     预留（Phase 3 外部能力接入）
s20 Comprehensive    →     全部 specs 的集成目标
```

---

## Phase 规划

### Phase 1：MVP（影响面分析）
- 预构建索引：符号依赖图
- 5 个核心 Tool
- 单 Agent + 2 个 Skill
- CLI 命令行接口

### Phase 2：多 Agent + 持久化
- 3 个 Specialist Agent（Impact / Archaeology / DocSync）
- Task System + 后台索引更新
- 交互式 CLI

### Phase 3：生态集成
- VS Code Extension
- MCP Server 形态
- 支持多代码库同时治理
