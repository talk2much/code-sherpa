# 02 代码索引与 RAG 规格

## 决策确认

- **文件规模**：10,000+ TS/TSX 文件
- **策略**：预构建索引 + 增量更新（实时解析不可行）
- **LLM**：DeepSeek V4 Pro，128K 上下文，需处理几千行大文件

---

## 核心挑战

10,000 个 TS 文件意味着：
- **全量解析时间**：TypeScript Compiler API 扫描整个 LPGJ 约需 30-60 秒
- **符号总数**：估计 50,000-100,000+ 个导出符号
- **依赖边数**：百万级别 import/reference 关系
- **查询延迟要求**：用户等待时间 < 3 秒

**结论：必须预构建索引，查询时读索引而非实时解析。**

---

## 索引体系架构

采用**三层索引**，不同查询走不同层：

```
┌─────────────────────────────────────────┐
│           查询入口（Query）               │
└─────────────────┬───────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    ▼             ▼             ▼
┌────────┐  ┌──────────┐  ┌──────────┐
│ 符号图  │  │ 向量索引  │  │ 文件索引  │
│ Graph  │  │  Vector  │  │  File    │
└────┬───┘  └────┬─────┘  └────┬─────┘
     │           │             │
     ▼           ▼             ▼
 精确引用查询  语义相似搜索   路径/内容搜索
（谁引用了X） （找相关概念） （找文件/行）
```

### Layer 1：符号依赖图（Symbol Graph）

**用途**：精确回答"谁 import 了 CustomerOrder"

**数据结构**：

```typescript
// index/symbol-graph.jsonl（行式存储，便于增量更新）

interface SymbolNode {
  id: string;                    // 全局唯一: "lpgj:packages/contracts/src/order.contract.ts:CustomerOrder"
  name: string;                  // "CustomerOrder"
  kind: 'type' | 'interface' | 'function' | 'class' | 'variable' | 'enum';
  filePath: string;              // 相对路径: "packages/contracts/src/order.contract.ts"
  line: number;                  // 定义行号
  column: number;
  exported: boolean;             // 是否 export
  moduleId: string;              // 所属模块
}

interface ReferenceEdge {
  source: string;                // SymbolNode.id
  target: string;                // SymbolNode.id
  kind: 'import' | 'export' | 'call' | 'type_ref' | 'inheritance';
  filePath: string;              // 引用发生的文件
  line: number;
  isDynamic: boolean;            // 是否动态 import
}

interface ModuleNode {
  id: string;                    // "lpgj:packages/contracts/src/order.contract.ts"
  filePath: string;
  packageName: string;           // "@lpgj/contracts"
  imports: string[];             // import 的模块 ID 列表
  exports: string[];             // 导出的 Symbol ID 列表
}
```

**构建流程**：

```typescript
async function buildSymbolGraph(target: TargetConfig): Promise<void> {
  // 1. 创建 TS Program（扫描 tsconfig.json）
  const program = ts.createProgram(
    getAllTsFiles(target),
    { allowJs: true, checkJs: false }
  );

  // 2. 遍历所有 SourceFile
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    
    // 3. 提取所有导出符号
    const symbols = extractExportedSymbols(sourceFile);
    
    // 4. 提取所有引用关系
    const references = extractReferences(sourceFile, program.getTypeChecker());
    
    // 5. 写入索引
    await appendToIndex(symbols, references);
  }
}
```

**构建时间预估**：
- 首次全量：60-120 秒
- 增量更新（单文件改动）：< 1 秒
- 索引大小：100-200 MB（JSONL 压缩后）

**查询示例**：

```typescript
// 查询：CustomerOrder 被谁引用了？
function findReferences(symbolId: string): ReferenceEdge[] {
  return graph.edges.filter(e => e.target === symbolId);
}
// 结果直接返回文件路径+行号，无需再次解析 AST
```

### Layer 2：代码片段向量索引（Vector Index）

**用途**：语义搜索，回答"订单相关的逻辑在哪里"（不是精确匹配）

**分块策略**：

```typescript
interface CodeChunk {
  id: string;                    // 唯一标识
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;               // 原始代码文本
  symbolNames: string[];         // 该块中包含的符号名
  docComment: string;            // JSDoc / 注释
  embedding: number[];           // 向量（1536 维）
}

// 分块规则：
// 1. 函数/方法/类：整个定义作为一个块
// 2. 大函数（>100 行）：按逻辑块拆分（if/while/for 块）
// 3. 类型定义：整个 interface/type 作为一个块
// 4. 文件头：import 语句 + 文件级注释作为一个块
```

**嵌入模型选择**：

| 方案 | 模型 | 优点 | 缺点 |
|------|------|------|------|
| A | DeepSeek Embedding | 与 LLM 同一家，语义对齐 | 需要 API 调用，10K 文件成本高 |
| B | local embedding (bge-small) | 本地运行，零成本 | 质量略差，需要额外依赖 |
| **推荐** | **B 为主，A 为辅** | 先用本地模型建索引，关键查询再用云端精排 | — |

**索引存储**：

```
index/
├── symbol-graph.jsonl          # 符号依赖图（精确查询）
├── vector-index.hnsw           # HNSW 向量索引（语义搜索）
├── file-manifest.json          # 文件元数据（修改时间、行数、hash）
└── chunk-metadata.jsonl        # 代码块元数据
```

### Layer 3：文件索引（File Index）

**用途**：快速路径查找、内容全文搜索

```typescript
interface FileEntry {
  path: string;                  // 相对路径
  package: string;               // 所属 package
  lines: number;                 // 总行数
  lastModified: number;          // 修改时间
  contentHash: string;           // MD5（用于增量检测）
  exports: string[];             // 导出的符号名列表
  imports: string[];             // import 的包列表
}
```

**全文搜索**：使用 `ripgrep` 实时搜索，不预建倒排索引（因为文件内容变动频繁，维护成本高）。

---

## 增量更新机制

### 触发时机

1. **手动触发**：`code-sherpa index:build` 或 `code-sherpa index:update`
2. **启动时检测**：Agent 启动时对比文件 manifest，发现变动自动更新
3. **定时后台**：Phase 2 加入 Cron 任务，每 5 分钟检测一次

### 增量算法

```typescript
async function incrementalUpdate(target: TargetConfig): Promise<void> {
  const manifest = loadManifest();
  const changedFiles: string[] = [];
  const deletedFiles: string[] = [];

  // 1. 扫描当前文件系统
  const currentFiles = await scanFiles(target);

  // 2. 对比 manifest
  for (const [path, entry] of Object.entries(manifest.files)) {
    if (!currentFiles.has(path)) {
      deletedFiles.push(path);
    } else if (currentFiles.get(path).hash !== entry.contentHash) {
      changedFiles.push(path);
    }
  }

  // 3. 新文件
  const newFiles = [...currentFiles.keys()].filter(p => !manifest.files[p]);

  // 4. 更新索引
  await removeFromIndex([...deletedFiles, ...changedFiles]);
  await addToIndex([...newFiles, ...changedFiles]);

  // 5. 重写 manifest
  await saveManifest(currentFiles);
}
```

### 更新耗时预估

| 场景 | 文件数 | 耗时 |
|------|--------|------|
| 全量构建 | 10,000 | 60-120s |
| 单文件修改 | 1 | < 1s |
| 10 文件修改 | 10 | 2-3s |
| 百文件修改（git rebase 后） | 100 | 10-15s |

---

## RAG 查询流程

当 Agent 需要理解代码语义时：

```
Agent: "Order 模块里处理退款的是哪段代码？"
  │
  ▼
[查询改写]
  │  "退款" → "refund" | "return" | "chargeback" | "售后"
  ▼
[向量搜索 Top 10]
  │  从 vector-index.hnsw 检索语义最相关的代码块
  ▼
[重排序]
  │  用 DeepSeek 对 Top 10 精排，选 Top 5
  ▼
[上下文组装]
  │  每个代码块保留前后 5 行上下文
  │  总 Token < 8K（留足推理空间）
  ▼
[注入 Agent Context]
  │  作为 Tool Result 返回给 LLM
```

---

## 大文件处理（>5000 行）

LPGJ 可能存在几千行的大文件（如生成的 contract 文件、庞大的路由文件）。

**策略**：

```typescript
function handleLargeFile(filePath: string, content: string): CodeChunk[] {
  const lines = content.split('\n');
  
  if (lines.length <= 5000) {
    // 正常处理
    return parseNormalFile(filePath, content);
  }

  // 超大文件：只索引关键部分
  return [
    // 1. 文件头（imports + 前 50 行）
    createChunk(filePath, 0, 50, 'header'),
    
    // 2. 所有导出定义（通过 AST 提取位置）
    ...extractExportDefinitions(filePath, content).map(def =>
      createChunk(filePath, def.startLine, def.endLine, 'export')
    ),
    
    // 3. 跳过中间实现细节（不索引）
    // 查询时如果需要，通过 file_read Tool 按需加载
  ];
}
```

---

## 索引文件管理

### 存储位置

```
code-sherpa/
├── index/                      # gitignored
│   ├── lpgj/
│   │   ├── manifest.json
│   │   ├── symbols.jsonl
│   │   ├── edges.jsonl
│   │   ├── modules.jsonl
│   │   ├── vector.index
│   │   └── chunks.jsonl
│   └── ...（其他目标）
```

### .gitignore

```gitignore
# code-sherpa .gitignore
index/
*.log
.env
node_modules/
dist/
```

### 首次使用流程

```bash
cd /Users/zhumingyang/Desktop/project/code-sherpa
pnpm install

# 构建索引（首次约 2 分钟）
pnpm index:build --target lpgj

# 验证索引
pnpm index:verify --target lpgj

# 启动 Agent
pnpm cli --target lpgj
```

---

## 与 learn-claude-code 的对应

learn-claude-code 没有专门的索引章节，因为它处理的是单个会话的临时上下文。

code-sherpa 的索引系统相当于把 **s09 Memory** 和 **s10 System Prompt** 中的知识部分，从"每次加载"升级为"持久化索引"。

| learn-claude-code | code-sherpa 索引 |
|-------------------|-----------------|
| Memory 持久化到文件 | 符号图持久化到 JSONL |
| Skill 文件按需加载 | 向量索引语义召回 |
| Context 手动管理 | 查询时自动组装相关代码块 |
