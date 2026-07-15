# 2026-07-15 — Phase 1 配置加载器

## 完成内容

### Phase 1：配置加载器 ✅

实现了 spec [00-workspace-config](specs/00-workspace-config.md) 中定义的配置加载器，整个系统的"水源"模块。

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/config/errors.ts` | ConfigError / PermissionError / SecurityError 三个自定义错误类 |
| `src/config/loader.ts` | 核心：loadTargetConfig() / resolvePath() / enforceReadOnly() |
| `tests/config/loader.test.ts` | 8 个单元测试 |
| `vitest.config.ts` | vitest 配置 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/index.ts` | 新增 config 模块导出 |
| `config/targets/lpgj.yaml` | root 路径改为 Windows 本地路径 `E:\AI\Trae_Project\lpgj` |

### 三个核心函数

```
loadTargetConfig("lpgj")
  ├─ 读 config/targets/lpgj.yaml
  ├─ 展开 ~ 和环境变量
  ├─ 验证 read_only: true（否则报 PermissionError）
  ├─ 验证 root 目录存在
  └─ 把 paths/context 中所有相对路径 → 绝对路径

resolvePath(target, relativePath)
  ├─ 安全的路径拼接
  └─ 检测 ../ 穿越 → 抛 SecurityError

enforceReadOnly(target)
  └─ readOnly=true → 抛 PermissionError
```

### loadTargetConfig vs resolvePath 的信任边界

- `loadTargetConfig` 解析的是你手写的 YAML（可信），只管"翻译"相对→绝对
- `resolvePath` 处理的是 LLM 运行时输出（不可信），必须做路径穿越检测
- `enforceReadOnly` 同理：配置文件说只读，LLM 可能让 Agent 写文件，Tool 层做安检

### 测试结果

```
✓ tests/config/loader.test.ts (8 tests)
pnpm build → 零错误
```

## 关键决策

- 配置文件名对应目标名：`config/targets/{name}.yaml`
- 路径穿越检测用大小写不敏感比较（兼容 Windows 盘符不一致）
- 支持 `~`、`$VAR`、`%VAR%` 三种路径展开（跨平台）
- 测试联动真实 `lpgj.yaml`：目录存在则测完整加载，不存在则测报错路径

### CLI 集成 — config:show 命令 ✅

创建了 CLI 入口并将配置加载器暴露为可用命令，对应 spec [06-cli-interface](specs/06-cli-interface.md)。

**新增文件**：[src/cli.ts](src/cli.ts) — 基于 commander 的 CLI 入口，注册 `config:show` 子命令：

```
pnpm config:show --target lpgj
```

输出包含：基本信息（name、description、root、read_only）、paths 映射、context 上下文文件、index 索引配置。使用 chalk 做颜色区分。

**修改文件**：[package.json](package.json) — 新增 `"config:show"` script → `tsx src/cli.ts config:show`

**验证结果**：
```
📋 Target Config
────────────────────────────────────────────────────────────
  name:       lpgj
  description:旅拍管家 - 影像经营 SaaS
  root:       E:\AI\Trae_Project\lpgj
  read_only:  true
  ── paths ──       (9 个别名全部解析为绝对路径)
  ── context ──     (4 个领域知识文件)
  ── index ──       (include/exclude/max_file_lines)
```

不存在的 target 报 `ConfigError` 并 exit 1。

### 本次涉及的目录骨架

```
code-sherpa/
├── src/
│   ├── config/
│   │   ├── errors.ts              # [新增] 自定义错误类
│   │   └── loader.ts              # [新增] 配置加载核心
│   ├── cli.ts                     # [新增] CLI 入口 → config:show
│   └── index.ts                   # [修改] 新增 config 模块导出
├── tests/
│   └── config/
│       └── loader.test.ts         # [新增] 8 个单元测试
├── vitest.config.ts               # [新增]
└── package.json                   # [修改] 新增 config:show script
```

## 下一步

Phase 2：8 个 Tool 逐个实现（从 file_read 开始）
