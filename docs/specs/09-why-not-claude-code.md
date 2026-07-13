# 09 为什么不用 Claude Code 直接分析？

> code-sherpa 与在 Claude Code 交互框中直接问代码问题的本质区别

---

## 问题

如果我已经在用 Claude Code 做日常开发，为什么还需要一个专门的 code-sherpa？在 Claude Code 里直接问"CustomerOrder 的影响面"不就行了吗？

---

## 一、Claude Code 能做但做不好的

在 Claude Code 里问"CustomerOrder 影响面"，它的执行路径大致是：

```
grep CustomerOrder → 找到 47 个匹配 → 逐个读文件 → LLM 理解后组织回答
```

这有几个每天都在遭遇的问题：

### 1. 上下文不够用

grep 返回 47 个匹配，每个文件读 30 行上下文。原始文本至少 5000 tokens。如果有些文件是间接引用（import 了 import CustomerOrder 的东西），你必须递归追踪——再读更多文件。2-3 轮迭代后，128K 窗口就满了，Claude 开始丢上下文或"偷懒"只分析前几个。

code-sherpa 的答案：**符号依赖图已经预计算好了传递闭包**。查询 `get_transitive_refs(CustomerOrder, depth=3)` 是 O(1) 的图查询，返回的是结构化的节点-边列表，不是原始代码文本。Token 消耗降低 10-50 倍。

### 2. grep 不区分类型引用和值引用

grep `CustomerOrder` 会匹配到：

- `import { CustomerOrder } from ...`（真实的类型引用）
- `// CustomerOrder is deprecated`（注释，不是引用）
- `"CustomerOrder"`（字符串，不是引用）
- `const CustomerOrder = ...`（另一个同名局部变量，和类型无关）

Claude Code 只能靠 LLM 语义理解来区分，但 10000 个文件里可能有几百个命中，LLM 分辨准确率不是 100%。

code-sherpa 的答案：**TS Compiler API 精确区分**。`findReferences(sourceSymbol)` 返回的是类型系统验证过的引用，不会把注释和字符串算进去。

### 3. 不做硬校验

Claude Code 读完 `apps/server/src/routes/order.ts` 后说："第 156 行引用了 CustomerOrder。" 你信了。但那个文件可能只有 120 行。

code-sherpa 的答案：**所有输出经过文件存在性、行号范围、内容匹配三重验证**，不符的被过滤并标注。

### 4. 没有领域记忆

你每次打开新对话问"订单模块"，Claude Code 都要重新读 `product-overview.md`、`ubiquitous-language.md`、`architecture-overview.md`。这些文档加起来 2000+ 行，每次都要消耗 Context 和 Token。

code-sherpa 的答案：**Workspace Memory 持久化领域知识摘要**。你只需要在首次构建索引时加载，后续每个查询自动注入。

### 5. 不能做跨会话的模式学习

你在 Claude Code 里每天问类似的问题（"改了 X 会炸到哪"），但每次都是新的开始。Claude Code 不知道你前天纠正过它"那个引用其实是动态 import，不会有编译时影响"。

code-sherpa 的答案：**三级 Memory 体系中的 correction 记录**。前一次被纠正的错误，后续查询自动提醒 Agent 避免。

---

## 二、code-sherpa 真正不一样的地方

把这些差异收敛到一个核心公式：

```
Claude Code = LLM推理 + 实时文件搜索 + 零记忆
code-sherpa = 预构建代码知识图谱 + LLM推理 + 硬校验 + 持久记忆
```

具体来说，code-sherpa 的差异化价值是：

| 能力 | Claude Code | code-sherpa |
|------|-------------|-------------|
| 传递引用追踪（3层以上） | 需多次迭代，上下文爆炸 | O(1) 图查询 |
| 类型 vs 值引用区分 | 依赖 LLM，不完全准确 | TS Compiler API，精确 |
| 10,000 文件级别的全量分析 | 不可能（上下文不够） | 符号图覆盖全量 |
| 输出验证 | 你自己人工验证 | Engine 自动校验 |
| 领域知识复用 | 每次都重新加载 | Workspace Memory 注入 |
| 错误纠正学习 | 不会 | Correction Memory |
| 成本 | 每次查询消耗大量 Token | 查询时 Token 消耗极低（主要成本在索引构建） |

---

## 三、什么是符号依赖图？

这是 code-sherpa 最核心的概念。下面用 LPGJ 的真实代码来演示。

### grep 能告诉你什么

在 Claude Code 里 grep `CustomerOrderSummary`，你会得到一堆文本行：

```
packages/contracts/src/customer-order.contract.ts:   export const customerOrderSummarySchema = z.object({
apps/server/src/customer-orders/customer-order.service.ts:   CustomerOrderSummary,
apps/server/src/customer-orders/customer-order.repository.ts:   ...CustomerOrderSummary...
apps/server/src/notifications/notification-message.service.ts:  customerOrderId: snap.customerOrderId,
apps/server/src/revenue-share/revenue-share.service.ts:  customerOrderId: record.customerOrderId,
apps/server/src/download-entitlements/download-entitlement.service.ts:  ...CustomerOrderSummary...
```

这是**文本匹配**。它不区分：

- 哪些是 `import { CustomerOrderSummary }`（依赖了类型）
- 哪些只是用了字符串 `customerOrderId`（依赖了字段名，但没 import 类型）
- 哪些是注释
- 哪些是同名但不同的符号

### 符号依赖图告诉你什么

符号依赖图解析后的结果是**图结构**：

```
┌──────────────────────────────────────────────────────┐
│ packages/contracts/src/customer-order.contract.ts     │
│                                                       │
│ Symbols:                                              │
│   ● CustomerOrderSummary     (type, 导出的 Zod 推断)  │
│   ● CustomerOrderItem        (type, 导出的 Zod 推断)  │
│   ● CreateCustomerOrderBody  (type, 输入的 Zod schema)│
│   ● CustomerOrderDetail      (type)                   │
│                                                       │
└──────┬───────────────────────────────────────────────┘
       │
       │  type_ref（类型引用，不是文本匹配）
       │
  ┌────┼────────────────────────────────────────────────┐
  │    ▼                                                 │
  │ apps/server/src/customer-orders/                     │
  │ customer-order.service.ts                            │
  │                                                      │
  │ Symbols:                                             │
  │   createOrder(input: CreateCustomerOrderBody)         │
  │              → Promise<CustomerOrderDetail>            │
  │                                                      │
  │ Edges from:                                          │
  │   import { CustomerOrderSummary } ← 类型引用        │
  │   import { CustomerOrderItem } ← 类型引用           │
  │   import { CreateCustomerOrderBody } ← 类型引用     │
  └────┬──────────────────────┬─────────────────────────┘
       │                      │
       │ type_ref             │ type_ref
       ▼                      ▼
┌──────────────┐    ┌──────────────────────┐
│ customer-    │    │ apps/server/src/      │
│ order.       │    │ notifications/         │
│ repository   │    │ notification-message   │
│ .ts          │    │ .service.ts            │
│              │    │                       │
│ 依赖了       │    │ 依赖了 CustomerOrder   │
│ CustomerOrder│    │ 的字段 id（间接引用）  │
│ 的所有类型   │    │                       │
└──────────────┘    └───────────────────────┘
       │
       │ （间接引用：谁引用了 CustomerOrderSummary？）
       │  revenue-share.service.ts 不直接 import CustomerOrder，
       │  但它 import 了 order 模块，而 order 模块 export 了 CustomerOrder
       ▼
┌──────────────────────┐
│ apps/server/src/      │
│ revenue-share/        │
│ revenue-share.service │
│ .ts                   │
│                      │
│ 间接依赖了            │
│ CustomerOrder（通过   │
│ order 模块）          │
└──────────────────────┘
```

### grep 和符号图的本质差异

```
grep "CustomerOrderSummary"
  │
  ▼
["packages/contracts/.../customer-order.contract.ts:  export const...",
 "apps/server/src/customer-orders/customer-order.service.ts:  CustomerOrderSummary,",
 "apps/server/src/customer-orders/customer-order.repository.ts:  ...",
 "apps/server/src/notifications/notification-message.service.ts:  customerOrderId:",  ← 假阳性！
 "apps/server/src/download-entitlements/download-entitlement.service.ts:  ...",
 ...]
```

grep 把这 6 个文件拍平了。**它不知道谁 import 了谁，也不知道谁间接依赖了谁，更不知道 `notification-message.service.ts` 里那行到底是真的引用了类型还是只是变量名包含这个子串。**

符号图是：

```
                      CustomerOrderSummary
                       /        |          \
                      /         |           \
             customer-order  customer-order   download-entitlement
             .service.ts     .repository.ts   .service.ts
                   |              |
                   | （通过模块导出）
                   ▼
           revenue-share.service.ts      notification-message.service.ts
           （间接依赖，深度=2）
```

**一个有向图。** `get_transitive_refs(CustomerOrderSummary, depth=2)` 做的事就是：从 `CustomerOrderSummary` 节点出发，沿着有向边走 2 步，收集所有遇到的目标节点。这在内存中是拓扑遍历，不是文本搜索。

---

## 四、核心公式

| | Claude Code 做的事 | code-sherpa 做的事 |
|---|---|---|
| **输入** | "帮我查 CustomerOrder 的影响面" | 同 |
| **执行** | grep → 读文件 → LLM 理解 → 再 grep → 再读 → ... | `get_transitive_refs(symbolId, depth=3)`，一次查图 |
| **中间产物** | 原始代码文本（Token 爆炸） | 结构化的节点/边列表（Token 极少） |
| **准确度** | LLM 分辨真假引用，可能出错 | AST 级别确认，不会把 `customerOrderId` 当引用 |
| **间接引用** | 依赖 LLM "推测"哪些文件间接依赖 | 图遍历精确得出，层层可追溯 |
| **验证** | 你自己检查 | Engine 自动校验文件路径和行号 |

grep 是文本拍平，符号图是有向图。拍平的文本只能靠 LLM 去理解关系，有向图本身就已经编码了关系。

---

## 五、坦率地说

code-sherpa 不是 "Claude Code 的替代品"，而是 "Claude Code 的补充"。

- **Claude Code** 的设计目标：通用 Agent，单次会话，开箱即用。适合日常开发中的代码阅读和小范围分析。
- **code-sherpa** 的设计目标：特定领域 Agent（大型 TS monorepo 治理），持久化索引，硬校验输出。适合需要确定性答案的场景（改 API 契约，精确列出所有受影响文件，一个不落）。

如果需求只是"偶尔问一个代码问题，人肉验证一下"，那 Claude Code 就够了。但如果需求是"Agent 的输出可信度高到可以直接指导重构决策"，那它就必须有预构建索引、符号图、硬校验。

code-sherpa 的意义不在于"能分析代码"（Claude Code 也能），而在于"分析结果可以信任"。
