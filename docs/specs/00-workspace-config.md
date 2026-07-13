# 00 工作区配置规格

## 决策确认

- **组织方式**：A（平行目录，三个独立 git repo）
- **访问边界**：code-sherpa 对 LPGJ 严格只读
- **路径解析**：通过配置文件中的绝对路径挂载

---

## 目录结构

```
/Users/zhumingyang/Desktop/project/
├── LPGJ/                     # 现有商业项目（只读目标）
│   ├── apps/
│   ├── packages/
│   ├── docs/
│   └── ...
│
├── learn-claude-code/        # Agent 机制参考（只读参考）
│   ├── s01_agent_loop/
│   ├── s20_comprehensive/
│   └── ...
│
└── code-sherpa/              # 本项目（独立 git）
    ├── docs/specs/           # 本文档
    ├── config/targets/       # 目标代码库配置
    ├── src/
    │   ├── core/             # Agent 核心
    │   ├── tools/            # 工具实现
    │   ├── indexer/          # 代码索引
    │   ├── memory/           # 记忆系统
    │   └── cli.ts            # CLI 入口
    ├── index/                # 预构建索引存储（gitignored）
    ├── tests/
    │   └── fixtures/         # 测试夹具
    └── package.json
```

---

## 目标代码库配置

### 配置文件：`config/targets/lpgj.yaml`

```yaml
name: lpgj
description: 旅拍管家 - 影像经营 SaaS

# 绝对路径挂载
root: /Users/zhumingyang/Desktop/project/LPGJ

# 访问控制
read_only: true
# 硬性约束：所有 Tool 在操作前检查此标志
# 任何 write/delete/modify 操作在被调用时直接抛出 PermissionError

# 关键目录映射（帮助 Agent 快速定位，减少 Token 消耗）
paths:
  contracts: packages/contracts/src
  database: packages/database/prisma
  server: apps/server/src
  admin_web: apps/admin-web/src
  merchant_desktop: apps/merchant-desktop/src
  user_miniapp: apps/user-miniapp/src
  mobile_demo: apps/mobile-demo/src
  product_demo: apps/product-demo/src
  docs: docs

# 理解业务的关键文件（注入 Agent System Prompt 的上下文）
# 这些文件在 Agent 启动时预加载，作为领域知识
context:
  product: docs/0-product-design/product-overview.md
  architecture: docs/3-technical-architecture/architecture-overview.md
  ubiquitous_language: docs/2-domain-model/ubiquitous-language.md
  tech_stack: docs/3-technical-architecture/technology-stack.md

# 索引配置
index:
  # 包含模式
  include:
    - "apps/**/*.ts"
    - "apps/**/*.tsx"
    - "packages/**/*.ts"
    - "packages/**/*.tsx"
  # 排除模式
  exclude:
    - "**/node_modules/**"
    - "**/dist/**"
    - "**/.claude/**"
    - "**/*.d.ts"
    - "**/e2e/**"
    - "**/playwright/**"
  # 最大文件行数限制（超大文件特殊处理）
  max_file_lines: 5000
```

### 配置加载器规范

```typescript
// src/config/loader.ts
interface TargetConfig {
  name: string;
  root: string;           // 已解析的绝对路径
  readOnly: boolean;      // 必须为 true
  paths: Record<string, string>;  // relative -> absolute
  context: Record<string, string>; // 领域知识文件路径
  index: IndexConfig;
}

function loadTargetConfig(name: string): TargetConfig;
// 行为：
// 1. 读取 config/targets/{name}.yaml
// 2. 将 root 解析为绝对路径（支持 ~ 展开和环境变量）
// 3. 验证 read_only === true（code-sherpa 只允许只读目标）
// 4. 验证 root 目录存在
// 5. 将 paths 和 context 中的相对路径转换为绝对路径
```

---

## 跨项目引用规范

### 1. code-sherpa → LPGJ（运行时）

```typescript
// 正确：通过配置加载绝对路径
const target = loadTargetConfig('lpgj');
const filePath = path.join(target.root, 'packages/contracts/src/order.contract.ts');
const content = fs.readFileSync(filePath, 'utf-8');

// 错误：硬编码相对路径
const content = fs.readFileSync('../LPGJ/packages/contracts/src/order.contract.ts');
// 原因：假设目录结构，不可移植
```

### 2. code-sherpa → learn-claude-code（参考时）

```typescript
// 仅在文档和注释中引用
// 实际代码不直接导入 learn-claude-code 的模块
// 而是理解其设计后，在 code-sherpa 中重新实现
```

### 3. LPGJ → code-sherpa（反向）

```
严格禁止。
LPGJ 作为商业项目，不应感知 code-sherpa 的存在。
code-sherpa 是纯外部工具。
```

---

## 只读边界 enforcement

### 三层防护

1. **配置层**：`read_only: true` 在配置文件中显式声明
2. **Tool 层**：所有 Tool 实现检查目标配置
   ```typescript
   function enforceReadOnly(target: TargetConfig) {
     if (target.readOnly) {
       throw new PermissionError(
         `Target "${target.name}" is read-only. Write operations are prohibited.`
       );
     }
   }
   ```
3. **文件系统层**：通过路径校验防止遍历攻击
   ```typescript
   function resolvePath(target: TargetConfig, relativePath: string): string {
     const absolute = path.resolve(target.root, relativePath);
     if (!absolute.startsWith(target.root)) {
       throw new SecurityError('Path traversal detected');
     }
     return absolute;
   }
   ```

---

## 多目标扩展（预留）

未来支持同时挂载多个代码库：

```yaml
# config/targets/another-project.yaml
name: another-project
root: /Users/zhumingyang/Desktop/project/another
read_only: true
paths:
  src: src
```

```bash
# CLI 使用
code-sherpa analyze --target lpgj --symbol CustomerOrder
code-sherpa analyze --target another-project --symbol User
```
