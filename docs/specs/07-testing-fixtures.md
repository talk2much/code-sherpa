# 07 测试 Fixtures 规格

## 测试策略

code-sherpa 的测试分为三层：

1. **单元测试**：Tool 函数、索引构建、压缩逻辑
2. **集成测试**：Agent Loop 端到端（使用 fixtures）
3. **验证测试**：对 LPGJ 真实代码的分析结果人工验证

---

## Fixtures 设计原则

### 为什么需要 Fixtures

- LPGJ 是真实商业代码，随时在变动
- 测试需要**确定性**：同样的查询必须返回同样的结果
- 测试不能依赖外部 API（LLM 调用可 mock）

### Fixtures 来源

从 LPGJ 提取**稳定的、有代表性的代码子集**：

```
tests/fixtures/
├── lpgj-sample/              # 从 LPGJ 提取的迷你 monorepo
│   ├── packages/
│   │   ├── contracts/
│   │   │   └── src/
│   │   │       ├── order.contract.ts      # 核心契约（~100 行）
│   │   │       ├── album.contract.ts      # 相册契约
│   │   │       └── index.ts
│   │   └── database/
│   │       └── prisma/
│   │           └── schema.prisma          # 精简 schema（~200 行）
│   └── apps/
│       ├── server/
│       │   └── src/
│       │       ├── routes/
│       │       │   ├── order.ts           # 订单路由
│       │       │   └── album.ts
│       │       └── services/
│       │           └── order/
│       │               └── create.ts      # 创建订单服务
│       └── admin-web/
│           └── src/
│               └── pages/
│                   └── orders/
│                       └── columns.tsx    # 表格列定义
│
└── expected/                   # 预期结果
    ├── impact-analysis/
    │   ├── customer-order.json   # "分析 CustomerOrder 影响面" 的预期输出
    │   └── album-contract.json
    └── code-archaeology/
        └── order-module-history.json
```

### 提取标准

从 LPGJ 提取 fixture 时，保留：
1. **完整的类型依赖链**：如果提取 `CustomerOrder`，必须同时提取它依赖的所有类型
2. **真实的目录结构**：保持 `packages/`、`apps/` 层级
3. **Prisma schema 的对应模型**：契约类型和数据库模型的映射关系
4. **Git 历史**：保留最近 10 条 commit（用于代码考古测试）

**去除**：
- 业务敏感信息（真实商家名、手机号等）
- 与测试无关的大文件（图片、生成的代码）
- node_modules

---

## 测试用例设计

### 1. 影响面分析测试

```typescript
// tests/integration/impact-analysis.test.ts

describe('Impact Analysis Skill', () => {
  const target = loadFixtureTarget('lpgj-sample');

  beforeAll(async () => {
    await buildIndex(target);
  });

  test('分析 CustomerOrder 影响面', async () => {
    const result = await runAgent({
      query: '改了 CustomerOrder 会影响哪里？',
      skill: 'impact-analysis',
      target,
    });

    // 验证：必须找到直接引用
    expect(result.directReferences).toContainEqual(
      expect.objectContaining({
        filePath: 'apps/server/src/routes/order.ts',
        lineNumber: expect.any(Number),
      })
    );

    // 验证：必须找到前端引用
    expect(result.directReferences.some(
      r => r.filePath.includes('admin-web') || r.filePath.includes('user-miniapp')
    )).toBe(true);

    // 验证：必须提到数据库模型
    expect(result.databaseMappings).toHaveLength(>= 1);

    // 验证：所有引用必须包含行号
    result.directReferences.forEach(ref => {
      expect(ref.lineNumber).toBeGreaterThan(0);
    });

    // 验证：置信度必须 > 80%
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  test('分析不存在的符号', async () => {
    const result = await runAgent({
      query: '分析 NonExistentSymbol 的影响面',
      skill: 'impact-analysis',
      target,
    });

    // 验证：必须明确告知未找到
    expect(result.answer).toMatch(/未找到|不存在|not found/i);
    expect(result.directReferences).toHaveLength(0);
  });
});
```

### 2. 索引构建测试

```typescript
// tests/unit/indexer.test.ts

describe('Symbol Graph Builder', () => {
  test('正确提取导出符号', async () => {
    const graph = await buildSymbolGraph(fixtureTarget);

    // 验证：找到 CustomerOrder 类型
    const customerOrder = graph.nodes.find(
      n => n.name === 'CustomerOrder'
    );
    expect(customerOrder).toBeDefined();
    expect(customerOrder.kind).toBe('type');

    // 验证：找到 import 边
    const importEdges = graph.edges.filter(
      e => e.target === customerOrder.id && e.kind === 'import'
    );
    expect(importEdges.length).toBeGreaterThan(0);
  });

  test('增量更新正确', async () => {
    // 1. 构建初始索引
    await buildSymbolGraph(fixtureTarget);

    // 2. 修改一个文件
    modifyFixtureFile('apps/server/src/routes/order.ts', 'add new import');

    // 3. 增量更新
    await incrementalUpdate(fixtureTarget);

    // 4. 验证索引正确反映变更
    const graph = loadSymbolGraph(fixtureTarget);
    expect(graph).toReflectChanges();
  });
});
```

### 3. Tool 单元测试

```typescript
// tests/unit/tools/file-read.test.ts

describe('file_read Tool', () => {
  test('读取文件指定范围', async () => {
    const result = await fileRead({
      file_path: 'packages/contracts/src/order.contract.ts',
      offset: 1,
      limit: 10,
    }, fixtureTarget);

    expect(result.lines).toHaveLength(10);
    expect(result.lines[0].lineNumber).toBe(1);
    expect(result.total_lines).toBeGreaterThan(10);
  });

  test('越界访问返回空', async () => {
    const result = await fileRead({
      file_path: 'packages/contracts/src/order.contract.ts',
      offset: 9999,
      limit: 10,
    }, fixtureTarget);

    expect(result.lines).toHaveLength(0);
  });

  test('路径遍历攻击被阻止', async () => {
    await expect(fileRead({
      file_path: '../../../etc/passwd',
    }, fixtureTarget)).rejects.toThrow('Path traversal');
  });
});
```

---

## LLM Mock 策略

集成测试不应调用真实 LLM（慢、贵、不稳定）。采用两种策略：

### 策略 A：录制-回放（Record-Replay）

```typescript
// 首次运行时使用真实 LLM，录制响应
const recorder = new LLMRecorder('tests/recordings/customer-order-impact.json');

// 后续测试回放录制内容
const mockLLM = recorder.createMock();

// 如果 Prompt 变化导致录制不匹配，自动重新录制
```

### 策略 B：确定性 Mock

```typescript
// 对简单查询，直接 mock LLM 响应
const mockLLM = {
  async chat(messages, options) {
    // 根据 messages 内容返回预设响应
    if (messages.some(m => m.content.includes('CustomerOrder'))) {
      return {
        choices: [{
          message: {
            content: '',
            tool_calls: [{
              function: {
                name: 'symbol_graph_query',
                arguments: JSON.stringify({
                  operation: 'get_transitive_refs',
                  symbol_id: '...',
                }),
              },
            }],
          },
        }],
      };
    }
  },
};
```

---

## 验证测试（对真实 LPGJ）

Fixtures 测试保证代码正确性，但还需要对真实 LPGJ 做人工验证：

```bash
# 运行一组标准查询，输出到验证报告
pnpm test:validation --target lpgj

# 生成验证报告
# tests/validation-report.md
```

### 验证清单

| 查询 | 预期结果 | 验证方式 |
|------|---------|---------|
| CustomerOrder 影响面 | 找到 >20 处引用 | 人工抽查 5 处 |
| album 模块架构 | 正确识别核心文件 | 对比架构文档 |
| 订单创建流程 | 追踪到所有相关服务 | 人工确认 |
| 不存在的符号 | 明确告知未找到 | 自动验证 |

---

## 性能基准

```typescript
// tests/perf/index-query.test.ts

describe('Performance Benchmarks', () => {
  test('符号图查询 < 100ms', async () => {
    const start = performance.now();
    await symbolGraphQuery({ operation: 'get_direct_refs', symbol_id: '...' });
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(100);
  });

  test('向量搜索 < 500ms', async () => {
    const start = performance.now();
    await vectorSearch({ query: '退款处理逻辑', top_k: 5 });
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(500);
  });

  test('增量更新 10 文件 < 5s', async () => {
    // ...
  });
});
```

---

## CI 集成

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm test:unit
      - run: pnpm test:integration
      # 性能测试只在 main 分支运行
      - run: pnpm test:perf
        if: github.ref == 'refs/heads/main'
```
