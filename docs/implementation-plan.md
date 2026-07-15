# code-sherpa 实现计划

> 编写顺序遵循：先做零依赖积木，再做组装胶水。每个阶段产出独立可测的小闭环。

---

## 依赖关系图

```
Phase 0  项目骨架           (零依赖)
   │
Phase 1  配置加载器          (零依赖)
   │
Phase 2  8 个 Tool          (依赖 Phase 1)
   │
Phase 3  代码索引系统        (依赖 Phase 1)
   │
   ├──→ Phase 4.1 System Prompt
   ├──→ Phase 4.2 Skill 定义
   ├──→ Phase 4.3 Agent Loop  (依赖 Phase 2 + 3 + 4.1 + 4.2)
   ├──→ Phase 4.4 Context 压缩 (依赖 Phase 4.3)
   └──→ Phase 4.5 Memory 系统  (依赖 Phase 4.3)
          │
Phase 5  错误恢复 & 硬校验   (依赖 Phase 4.3)
          │
Phase 6  CLI 接口           (依赖 Phase 4 + 5)
          │
Phase 7  测试 Fixtures      (依赖 Phase 6)
```

---

## Phase 0：项目骨架 ✅

**目标**：项目能 `pnpm install && pnpm build`

**产出**：
- `package.json` — pnpm + TypeScript + 依赖声明
- `tsconfig.json` — strict, NodeNext, ES2022
- `.gitignore` — dist/, index/, .env, *.log
- `config/targets/lpgj.yaml` — 目标代码库配置（严格只读）
- `src/types/` — 从 specs 提取的共享类型定义（6 个领域文件）
- `src/index.ts` — 空白入口

**类型文件对应关系**：

| 文件 | 来源 spec | 内容 |
|------|----------|------|
| `config.ts` | 00 | TargetConfig, IndexConfig |
| `agent.ts` | 01 | Skill, AgentLoopConfig, Message, ToolCall, ToolHandler, ToolRegistry, HookRegistry |
| `tools.ts` | 03 | 8 个 Tool 的 I/O 接口 + ToolInput/ToolOutput 联合类型 |
| `indexer.ts` | 02 | SymbolNode, ReferenceEdge, ModuleNode, CodeChunk, FileEntry |
| `memory.ts` | 04 | SessionMemory, WorkspaceMemory, LongTermMemory |
| `validate.ts` | 08+08a | ConfidenceResult, DecisionInput, ActionDecision, EscalationResult |

**验证**：`pnpm install && pnpm build` 零错误通过

---

## Phase 1：配置加载器

**对应 spec**：[00-workspace-config.md](specs/00-workspace-config.md)

**做什么**：
- `src/config/loader.ts` — 读 YAML，解析路径，校验 `read_only: true`
- 路径遍历防护 `resolvePath()`
- 只读 enforcement `enforceReadOnly()`

**为什么第二个做**：所有 Tool、索引、功能都依赖 `TargetConfig`

**可验证**：`pnpm config:show --target lpgj` 打印解析后的配置

---

## Phase 2：8 个 Tool 逐个实现

**对应 spec**：[03-tool-interface.md](specs/03-tool-interface.md)

**实现顺序（从简单到复杂）**：

| 顺序 | Tool | 依赖 | 说明 |
|------|------|------|------|
| 1 | `file_read` | 无 | 纯文件系统 |
| 2 | `grep_search` | 无（封装 ripgrep） | 命令行调用 |
| 3 | `db_schema_read` | 无 | 解析 Prisma schema 文本 |
| 4 | `git_log` | 无（封装 git 命令） | 命令行调用 |
| 5 | `ast_query` | TS Compiler API | 部分查询需索引 |
| 6 | `symbol_graph_query` | 符号图索引 | 依赖 Phase 3 |
| 7 | `contract_trace` | grep + ast_query | 组合 Tool |
| 8 | `vector_search` | 向量索引 | Phase 2 才启用 |

**每个 Tool 写完都要有单元测试**——Tool 是 Agent 的"感官"，感官不可靠，后面一切白做。

**可验证**：每个 Tool 独立调用，对 LPGJ 真实文件跑一遍

---

## Phase 3：代码索引系统

**对应 spec**：[02-code-indexing-rag.md](specs/02-code-indexing-rag.md)

**子步骤**：

| 顺序 | 模块 | 说明 |
|------|------|------|
| 3.1 | `src/indexer/file-manifest.ts` | 扫描文件，计算 hash，输出 manifest.json |
| 3.2 | `src/indexer/symbol-graph.ts` | TS Compiler API 构建符号依赖图 |
| 3.3 | `src/indexer/incremental.ts` | 对比 manifest 做增量更新 |
| 3.4 | `src/indexer/query.ts` | getDirectRefs / getTransitiveRefs 等查询接口 |

**可验证**：
```bash
pnpm index:build --target lpgj    # 全量构建
pnpm index:verify --target lpgj   # 验证完整性
pnpm index:stats --target lpgj    # 查看统计
```

---

## Phase 4：Agent 核心

**对应 spec**：[01-agent-core-architecture.md](specs/01-agent-core-architecture.md)

**子步骤**：

| 顺序 | 模块 | 说明 |
|------|------|------|
| 4.1 | `src/core/prompt.ts` | System Prompt 组装（base + domain + structure） |
| 4.2 | `src/core/skill.ts` + `src/skills/` | Skill 定义 + impact-analysis + code-archaeology |
| 4.3 | `src/core/loop.ts` | 核心循环：send → receive tool_calls → execute → repeat |
| 4.4 | `src/core/compact/` | 三层压缩（行级 / 符号级 / 语义级），Token 预算管理 |
| 4.5 | `src/memory/` | 三级记忆（Session / Workspace / Long-term） |

**4.5 放最后的原因**：Memory 是对 Loop 的"增强"，需要 Loop 跑起来产生数据后才能验证

---

## Phase 5：错误恢复 & 硬校验

**对应 spec**：[08-error-recovery.md](specs/08-error-recovery.md) + [08a-error-recovery-decision-routing.md](specs/08a-error-recovery-decision-routing.md)

**子步骤**：

| 顺序 | 模块 | 说明 |
|------|------|------|
| 5.1 | `src/validate/file-validator.ts` | 文件存在性 + 行号范围 + 内容匹配 |
| 5.2 | `src/validate/claim-parser.ts` | 从 LLM 文本提取声称的文件/符号/行号 |
| 5.3 | `src/validate/channels.ts` | 快通道（同步 ≤50ms）+ 慢通道（异步 ≤300ms） |
| 5.4 | `src/validate/confidence.ts` | 四因子置信度评估 |
| 5.5 | `src/validate/decision.ts` | decideAction() — execute / degrade / escalate |
| 5.6 | `src/recovery/` | 三级降级：Retry → Fallback → Escalation |

**为什么在 Agent 之后**：校验是 Agent 的"安全网"，Agent 先跑起来才知道什么东西需要校验

---

## Phase 6：CLI 接口

**对应 spec**：[06-cli-interface.md](specs/06-cli-interface.md)

**做什么**：
- `src/cli.ts` — 入口，命令路由
- `src/cli/commands/` — index:build / analyze / chat 等命令实现
- `src/cli/output-formatter.ts` — text / json / markdown 格式化

**为什么最后做**：CLI 是"外壳"，所有功能都要先有

**可验证**：
```bash
code-sherpa analyze "改了 CustomerOrder 会影响哪里？" --target lpgj
```

---

## Phase 7：测试 Fixtures & 集成测试

**对应 spec**：[07-testing-fixtures.md](specs/07-testing-fixtures.md)

**做什么**：
- 从 LPGJ 提取 `tests/fixtures/lpgj-sample/`
- 录制 LLM mock 数据
- 端到端集成测试 + 性能基准测试

---

## 总时间估算

| Phase | 内容 | 预估（业余时间） |
|-------|------|-----------------|
| 0 | 项目骨架 | 1 天 |
| 1 | 配置加载器 | 1 天 |
| 2 | 8 个 Tool | 5-7 天 |
| 3 | 代码索引 | 5-7 天 |
| 4 | Agent 核心 | 5-7 天 |
| 5 | 错误恢复 | 3-4 天 |
| 6 | CLI 接口 | 2-3 天 |
| 7 | 测试 Fixtures | 2-3 天 |
| **总计** | | **4-6 周** |

---

## 设计原则

1. **每步产出独立可测**——不等到最后才"连起来看看"
2. **只引入一个新概念**——每步依赖的前置概念都在前面步骤中看过了
3. **所有实现决策必须有 spec 依据**——不自创需求
4. **写完的模块写 README.md**——解释职责边界和关键设计决策
