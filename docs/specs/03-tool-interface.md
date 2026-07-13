# 03 Tool 接口规格

## 设计原则

1. **原子性**：每个 Tool 只做一件事，可组合
2. **可验证**：Tool 返回的结果必须有明确的校验方式
3. **只读**：所有 Tool 对 LPGJ 只读
4. **结构化**：返回 JSON，不是自由文本

---

## Tool 清单（MVP 期）

| # | Tool | 用途 | 对应 learn-claude-code |
|---|------|------|----------------------|
| 1 | `file_read` | 读取文件内容 | s02 Read |
| 2 | `grep_search` | 文本搜索 | s02 Grep |
| 3 | `ast_query` | AST 精确查询（找引用、找定义） | 扩展 |
| 4 | `symbol_graph_query` | 符号依赖图查询 | 新增 |
| 5 | `vector_search` | 语义搜索代码片段 | 新增 |
| 6 | `db_schema_read` | 读取 Prisma schema | 新增 |
| 7 | `contract_trace` | ts-rest 契约追踪 | 新增 |
| 8 | `git_log` | Git 历史查询 | 扩展 |

---

## Tool 1: file_read

```typescript
interface FileReadInput {
  file_path: string;        // 相对 LPGJ root 的路径
  offset?: number;          // 起始行（1-based），默认 1
  limit?: number;           // 读取行数，默认 50
}

interface FileReadOutput {
  file_path: string;
  total_lines: number;
  lines: {
    line_number: number;
    text: string;
  }[];
  truncated: boolean;       // 是否被截断
}

// 使用约束：
// - 单文件最大返回 200 行（防止 Token 爆炸）
// - 超大文件（>5000 行）读取时必须指定 offset
// - 返回内容包含行号，便于 Agent 引用
```

**示例**：

```json
// Input
{
  "file_path": "packages/contracts/src/order.contract.ts",
  "offset": 1,
  "limit": 30
}

// Output
{
  "file_path": "packages/contracts/src/order.contract.ts",
  "total_lines": 156,
  "lines": [
    { "line_number": 1, "text": "import { z } from 'zod';" },
    { "line_number": 2, "text": "" },
    { "line_number": 3, "text": "export const CustomerOrder = z.object({" }
  ],
  "truncated": true
}
```

---

## Tool 2: grep_search

```typescript
interface GrepSearchInput {
  pattern: string;          // 搜索正则或字符串
  path?: string;            // 限定目录（相对路径）
  file_pattern?: string;    // 文件过滤，如 "*.ts"
  max_results?: number;     // 最大返回数，默认 20
}

interface GrepSearchOutput {
  results: {
    file_path: string;
    line_number: number;
    text: string;           // 匹配行内容
    match_start: number;    // 匹配起始列
    match_end: number;      // 匹配结束列
  }[];
  total_matches: number;
  truncated: boolean;       // 是否超过 max_results
}

// 实现：封装 ripgrep (rg)
// 优势： respects .gitignore，速度极快
```

**示例**：

```json
// Input
{
  "pattern": "CustomerOrder",
  "file_pattern": "*.ts",
  "max_results": 10
}

// Output
{
  "results": [
    {
      "file_path": "apps/server/src/routes/order.ts",
      "line_number": 23,
      "text": "import { CustomerOrder } from '@lpgj/contracts';",
      "match_start": 10,
      "match_end": 23
    }
  ],
  "total_matches": 47,
  "truncated": true
}
```

---

## Tool 3: ast_query

**最核心 Tool**，基于 TypeScript Compiler API 做精确查询。

```typescript
interface ASTQueryInput {
  file_path: string;        // 目标文件
  query_type: 
    | 'find_references'      // 找某个符号的所有引用
    | 'find_definition'      // 找符号定义位置
    | 'find_imports'         // 找文件所有 import
    | 'find_exports'         // 找文件所有 export
    | 'find_callers'         // 找调用某个函数的所有位置
    | 'get_type_info';       // 获取类型信息
  symbol_name?: string;     // 符号名（find_references / find_definition 需要）
}

interface ASTQueryOutput {
  query_type: string;
  results: {
    file_path: string;
    line_number: number;
    column: number;
    text: string;            // 相关代码片段
    context: string;         // 前后 2 行上下文
  }[];
}

// 实现：利用预构建的 Symbol Graph
// 优势：比 grep 精确（区分类型引用和值引用）
// 速度：O(1) 查图，无需解析 AST
```

**示例**：

```json
// Input
{
  "query_type": "find_references",
  "symbol_name": "CustomerOrder",
  "file_path": "packages/contracts/src/order.contract.ts"
}

// Output
{
  "query_type": "find_references",
  "results": [
    {
      "file_path": "apps/server/src/routes/order.ts",
      "line_number": 45,
      "column": 12,
      "text": "const order: CustomerOrder = ...",
      "context": "  async function createOrder() {\n    const order: CustomerOrder = ...\n    return order;"
    }
  ]
}
```

---

## Tool 4: symbol_graph_query

直接查询预构建的符号依赖图。

```typescript
interface SymbolGraphQueryInput {
  operation:
    | 'get_symbol_info'      // 获取符号基本信息
    | 'get_direct_refs'      // 直接引用（一层）
    | 'get_transitive_refs'  // 传递引用（多层，需限制深度）
    | 'get_importers'        // 哪些模块 import 了本模块
    | 'get_dependencies';    // 本模块依赖哪些模块
  symbol_id?: string;        // 符号全局 ID
  module_id?: string;        // 模块 ID
  max_depth?: number;        // 传递查询最大深度，默认 3
}

interface SymbolGraphQueryOutput {
  nodes: SymbolNode[];
  edges: ReferenceEdge[];
  // 图数据，可直接用于可视化或进一步分析
}
```

**示例**：查询 CustomerOrder 的传递影响面

```json
// Input
{
  "operation": "get_transitive_refs",
  "symbol_id": "lpgj:packages/contracts/src/order.contract.ts:CustomerOrder",
  "max_depth": 2
}

// Output（部分）
{
  "nodes": [
    { "id": "...", "name": "CustomerOrder", "kind": "type", "file_path": "..." },
    { "id": "...", "name": "createOrder", "kind": "function", "file_path": "..." },
    { "id": "...", "name": "OrderList", "kind": "component", "file_path": "..." }
  ],
  "edges": [
    { "source": "...", "target": "...", "kind": "type_ref", "file_path": "..." }
  ]
}
```

---

## Tool 5: vector_search

语义搜索代码片段。

```typescript
interface VectorSearchInput {
  query: string;            // 自然语言描述
  top_k?: number;           // 返回数量，默认 5
  file_pattern?: string;    // 限定文件类型
}

interface VectorSearchOutput {
  results: {
    file_path: string;
    start_line: number;
    end_line: number;
    content: string;         // 代码片段
    score: number;           // 相似度分数
    symbols: string[];       // 该片段包含的符号
  }[];
}

// 实现：查询 HNSW 向量索引
// 用途：当 Agent 不知道精确符号名时，用自然语言找相关代码
```

**示例**：

```json
// Input
{
  "query": "处理退款和售后返修的逻辑",
  "top_k": 5
}

// Output
{
  "results": [
    {
      "file_path": "apps/server/src/services/refund/process.ts",
      "start_line": 45,
      "end_line": 89,
      "content": "async function processRefund(...) { ... }",
      "score": 0.89,
      "symbols": ["processRefund", "RefundStatus"]
    }
  ]
}
```

---

## Tool 6: db_schema_read

读取 Prisma schema，理解数据模型。

```typescript
interface DBSchemaReadInput {
  model_name?: string;      // 特定模型，不传则返回所有模型列表
  include_fields?: boolean; // 是否包含字段详情，默认 true
}

interface DBSchemaReadOutput {
  models: {
    name: string;
    fields: {
      name: string;
      type: string;
      isOptional: boolean;
      isRelation: boolean;
      relationTo?: string;
      documentation?: string;
    }[];
    relations: {
      name: string;
      type: string;          // "1:1" | "1:n" | "n:m"
      related_model: string;
    }[];
  }[];
}

// 实现：解析 packages/database/prisma/schema.prisma
// 用途：Agent 理解代码中的数据流向
```

---

## Tool 7: contract_trace

ts-rest 契约追踪——LPGJ 的核心通信机制。

```typescript
interface ContractTraceInput {
  contract_name: string;    // 如 "orderContract"
  operation?: 'request' | 'response' | 'both'; // 追踪方向
}

interface ContractTraceOutput {
  contract: {
    name: string;
    file_path: string;
    routes: {
      path: string;
      method: string;
      request_type: string;
      response_type: string;
    }[];
  };
  server_impl: {             // 服务端实现位置
    file_path: string;
    line_number: number;
  }[];
  client_usage: {            // 前端调用位置
    file_path: string;
    line_number: number;
  }[];
}

// 用途：回答"改了这个 API 契约，前后端哪里会受影响"
```

**示例**：

```json
// Input
{ "contract_name": "orderContract" }

// Output
{
  "contract": {
    "name": "orderContract",
    "file_path": "packages/contracts/src/order.contract.ts",
    "routes": [
      { "path": "/orders", "method": "POST", "request_type": "CreateOrderInput", "response_type": "CustomerOrder" }
    ]
  },
  "server_impl": [
    { "file_path": "apps/server/src/routes/order.ts", "line_number": 23 }
  ],
  "client_usage": [
    { "file_path": "apps/admin-web/src/api/order.ts", "line_number": 12 },
    { "file_path": "apps/user-miniapp/src/pages/order/create.ts", "line_number": 34 }
  ]
}
```

---

## Tool 8: git_log

代码考古必备。

```typescript
interface GitLogInput {
  file_path?: string;       // 特定文件历史
  symbol_name?: string;     // 特定符号历史（通过 git pickaxe -S）
  limit?: number;           // 返回条数，默认 10
  since?: string;           // 时间过滤，如 "2024-01-01"
}

interface GitLogOutput {
  commits: {
    hash: string;
    author: string;
    date: string;
    message: string;
    files_changed: string[];
    diff_summary: string;    // 该提交的关键变更摘要
  }[];
}

// 实现：封装 git log + git show
// 增强：用 LLM 对 diff 生成自然语言摘要
```

---

## Tool Registry 实现

```typescript
// src/tools/registry.ts

const TOOL_REGISTRY: Record<string, ToolHandler> = {
  file_read: handleFileRead,
  grep_search: handleGrepSearch,
  ast_query: handleASTQuery,
  symbol_graph_query: handleSymbolGraphQuery,
  vector_search: handleVectorSearch,
  db_schema_read: handleDBSchemaRead,
  contract_trace: handleContractTrace,
  git_log: handleGitLog,
};

export async function executeTool(
  toolCall: ToolCall,
  config: AgentLoopConfig
): Promise<ToolResult> {
  const handler = TOOL_REGISTRY[toolCall.function.name];
  if (!handler) {
    throw new Error(`Unknown tool: ${toolCall.function.name}`);
  }

  // 只读检查
  enforceReadOnly(config.target);

  // 执行
  const result = await handler(JSON.parse(toolCall.function.arguments), config);

  // 硬校验：如果 Tool 返回了文件路径，验证其存在
  validateToolResult(result, config.target);

  return result;
}
```

---

## Tool 使用规范（注入 System Prompt）

```
## Tool 使用规范

1. 优先使用 symbol_graph_query 而非 grep_search，前者精确且快速
2. 读取文件时使用 offset + limit，避免加载整个大文件
3. 每次迭代最多调用 3 个 Tool
4. 所有引用必须包含准确的 file_path 和 line_number
5. 如果 Tool 返回空结果，明确说明"未找到引用"，不要编造
```
