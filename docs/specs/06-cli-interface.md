# 06 CLI 交互规格

## 设计原则

1. **命令式为主**：快速执行，适合集成到工作流
2. **交互式为辅**：复杂分析时支持追问和探索
3. **输出可验证**：所有引用包含文件路径和行号，可直接跳转
4. **进度可见**：索引构建、复杂查询展示进度

---

## 命令结构

```
code-sherpa <command> [options]

Commands:
  index:build       全量构建索引
  index:update      增量更新索引
  index:verify      验证索引完整性
  index:stats       查看索引统计

  analyze           执行分析查询（核心命令）
  chat              交互式对话模式

  skill:list        列出可用 Skills
  skill:switch      切换当前 Skill

  config:init       初始化目标代码库配置
  config:show       查看当前配置

Options:
  --target, -t      目标代码库（默认 lpgj）
  --skill, -s       使用的 Skill（默认 auto）
  --format, -f      输出格式: text | json | markdown
  --output, -o      输出到文件
  --verbose, -v     显示详细日志
  --dry-run         只显示会做什么，不实际执行
```

---

## 核心命令详解

### 1. index:build（索引构建）

```bash
# 首次构建
code-sherpa index:build --target lpgj

# 输出示例：
# [info] Scanning /Users/zhumingyang/Desktop/project/LPGJ...
# [info] Found 10,247 TS/TSX files
# [progress] Parsing symbols: 100% (10247/10247) ████████████ 45s
# [progress] Building vector index: 100% ████████████ 120s
# [success] Index built successfully
# [stats] Symbols: 87,432 | References: 1,234,567 | Chunks: 45,200
# [stats] Index size: 156 MB
# [success] Ready for queries
```

### 2. index:update（增量更新）

```bash
# 检测变更并更新
code-sherpa index:update --target lpgj

# 输出示例：
# [info] Checking for changes...
# [info] Changed files: 12 | New files: 3 | Deleted files: 1
# [progress] Updating index: 100% ████████████ 3s
# [success] Index updated
```

### 3. analyze（分析查询）

```bash
# 影响面分析（默认 Skill）
code-sherpa analyze "改了 CustomerOrder 会影响哪里？" --target lpgj

# 指定 Skill
code-sherpa analyze "为什么订单模块这么复杂？" --skill code-archaeology

# JSON 输出（供其他工具消费）
code-sherpa analyze "CustomerOrder 的所有引用" --format json

# 输出到文件
code-sherpa analyze "..." --output report.md
```

#### 输出格式示例（text）

```
═══════════════════════════════════════════════
  影响面分析: CustomerOrder
  查询时间: 2.3s | 迭代次数: 5 | 使用 Tools: 4
═══════════════════════════════════════════════

## 直接引用（23 处）

  packages/contracts/src/order.contract.ts:45
    └─ export type CustomerOrder = z.infer<typeof CustomerOrderSchema>;

  apps/server/src/routes/order.ts:23
    └─ import { CustomerOrder } from '@lpgj/contracts';

  apps/server/src/services/order/create.ts:67
    └─ async function createOrder(): Promise<CustomerOrder> {

  apps/admin-web/src/pages/orders/columns.tsx:12
    └─ type OrderColumn = ColumnDef<CustomerOrder>;

  ... (18 more)

## 间接引用（7 处）

  apps/server/src/services/payment/verify.ts:89
    └─ 引用 createOrder，间接依赖 CustomerOrder

## 数据库映射

  packages/database/prisma/schema.prisma:156
    └─ model Order { ... }
    ⚠ 风险: CustomerOrder 的 status 字段与 Prisma Order.status 类型不一致

## 前端页面

  apps/user-miniapp/src/pages/order/detail.tsx:8
    └─ 展示 CustomerOrder 详情

## 建议

  1. [高优先级] 同步 packages/database/prisma/schema.prisma
  2. [中优先级] 检查 apps/admin-web/src/pages/orders/columns.tsx 的渲染逻辑
  3. [低优先级] 运行类型检查: pnpm --filter contracts check

═══════════════════════════════════════════════
  置信度: 92% | 不确定项: 2 处（已标注）
═══════════════════════════════════════════════
```

#### 输出格式示例（json）

```json
{
  "query": "改了 CustomerOrder 会影响哪里？",
  "skill": "impact-analysis",
  "duration": 2.3,
  "iterations": 5,
  "confidence": 0.92,
  "uncertainties": 2,
  "results": {
    "directReferences": [
      {
        "filePath": "apps/server/src/routes/order.ts",
        "lineNumber": 23,
        "context": "import { CustomerOrder } from '@lpgj/contracts';",
        "confidence": 1.0
      }
    ],
    "indirectReferences": [...],
    "databaseMappings": [...],
    "suggestions": [...]
  },
  "executedTools": [
    { "tool": "symbol_graph_query", "duration": 0.1 },
    { "tool": "file_read", "duration": 0.05 }
  ]
}
```

### 4. chat（交互式模式）

```bash
code-sherpa chat --target lpgj

# 进入交互式会话：
# > 改了 CustomerOrder 会影响哪里？
# [Agent 回答...]
#
# > 详细看看 apps/server/src/routes/order.ts
# [Agent 加载文件...]
#
# > 为什么这里用 zod 而不是 io-ts？
# [Agent 考古...]
#
# > exit
```

交互特性：
- **上下文保持**：同一会话内记住之前的查询和文件
- **Tab 补全**：文件路径、符号名自动补全
- **快捷命令**：
  - `/read <file>` - 快速读文件
  - `/goto <file:line>` - 标记跳转点
  - `/save` - 保存会话记录
  - `/feedback <correction>` - 纠正 Agent 错误

---

## 输出样式规范

### 颜色编码

| 元素 | 颜色 | 说明 |
|------|------|------|
| 文件路径 | 蓝色 | 可点击跳转（终端支持时） |
| 行号 | 灰色 | 精确位置 |
| 代码片段 | 白色 | 原样展示 |
| 风险/警告 | 黄色 | 需要注意 |
| 错误 | 红色 | 严重问题 |
| 置信度 >90% | 绿色 | 高可信 |
| 置信度 <70% | 黄色 | 需要验证 |
| 不确定 | 灰色 | 推测性内容 |

### 文件路径格式

所有文件路径采用**相对 LPGJ root** 的格式，便于用户直接复制使用：

```
# 正确
packages/contracts/src/order.contract.ts:45

# 错误（不要加绝对路径）
/Users/zhumingyang/Desktop/project/LPGJ/packages/contracts/src/order.contract.ts:45
```

---

## 与 IDE 集成（预留）

### VS Code Extension（Phase 3）

```typescript
// 命令面板
// > code-sherpa: Analyze Impact
// > code-sherpa: Trace Contract

// 编辑器右键菜单
// [右键符号] → "code-sherpa: 查看影响面"
// [右键文件] → "code-sherpa: 代码考古"

// Hover 提示
// 鼠标悬停在符号上，显示快速引用计数和关键引用位置
```

### 跳转协议

终端输出中的文件路径支持 `file://` 协议跳转：

```
file:///Users/zhumingyang/Desktop/project/LPGJ/packages/contracts/src/order.contract.ts#L45
```

VS Code、iTerm 等终端可点击直接打开。

---

## 日志级别

```bash
# 静默模式（只输出结果）
code-sherpa analyze "..." --quiet

# 详细模式（展示每一步思考）
code-sherpa analyze "..." --verbose

# 调试模式（展示 Tool Calls 和 Raw Responses）
code-sherpa analyze "..." --debug
```

---

## 与 learn-claude-code 的对应

learn-claude-code 是 CLI 工具（Claude Code），其交互模式直接作为参考：

| learn-claude-code | code-sherpa |
|-------------------|-------------|
| 自然语言对话 | `chat` 模式 |
| `/command` 斜杠命令 | 交互式快捷命令 |
| 文件编辑建议 | 只读分析，不编辑 |
| worktree 隔离 | 多 target 支持 |
