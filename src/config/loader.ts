// ============================================================
// 配置加载器
// 对应 spec 00-workspace-config → 配置加载器规范
//
// 职责：
// 1. 读取 config/targets/{name}.yaml
// 2. 解析路径（~ 展开、环境变量、相对→绝对）
// 3. 验证 read_only 约束
// 4. 将 paths/context 中的相对路径转为绝对路径
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parse as parseYaml } from 'yaml';
import type { TargetConfig, IndexConfig } from '../types/config.js';
import { ConfigError, PermissionError, SecurityError } from './errors.js';

// ============================================================
// 路径工具
// ============================================================

/**
 * 展开路径中的 ~ 和环境变量
 * - ~ → 用户 home 目录
 * - $VAR / ${VAR} → 环境变量值（Windows 也支持 %VAR%）
 */
function expandPath(raw: string): string {
  let expanded = raw;

  // 展开 ~ （仅在路径开头）
  if (expanded.startsWith('~')) {
    expanded = path.join(os.homedir(), expanded.slice(1));
  }

  // 展开 ${VAR} 和 $VAR 形式的环境变量
  expanded = expanded.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '');
  expanded = expanded.replace(/\$(\w+)/g, (_, name) => process.env[name] ?? '');

  // Windows: 展开 %VAR% 形式
  if (process.platform === 'win32') {
    expanded = expanded.replace(/%(\w+)%/g, (_, name) => process.env[name] ?? '');
  }

  return expanded;
}

// ============================================================
// YAML schema 校验
// ============================================================

interface RawYamlConfig {
  name?: unknown;
  description?: unknown;
  root?: unknown;
  read_only?: unknown;
  paths?: unknown;
  context?: unknown;
  index?: unknown;
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new ConfigError(`config.${field} must be a string, got ${typeof value}`);
  }
}

function assertRecord(value: unknown, field: string): asserts value is Record<string, string> {
  if (!value || typeof value !== 'object') {
    throw new ConfigError(`config.${field} must be an object, got ${typeof value}`);
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== 'string') {
      throw new ConfigError(
        `config.${field}.${k} must be a string, got ${typeof v}`,
      );
    }
  }
}

function assertIndexConfig(value: unknown): asserts value is IndexConfig {
  if (!value || typeof value !== 'object') {
    throw new ConfigError('config.index must be an object');
  }
  const idx = value as Record<string, unknown>;
  if (!Array.isArray(idx.include) || !idx.include.every((v) => typeof v === 'string')) {
    throw new ConfigError('config.index.include must be a string[]');
  }
  if (!Array.isArray(idx.exclude) || !idx.exclude.every((v) => typeof v === 'string')) {
    throw new ConfigError('config.index.exclude must be a string[]');
  }
  if (typeof idx.max_file_lines !== 'number') {
    throw new ConfigError('config.index.max_file_lines must be a number');
  }
}

// ============================================================
// 主加载函数
// ============================================================

/** 配置文件的预期目录（相对于项目根） */
const TARGETS_DIR = path.resolve('config', 'targets');

/**
 * 加载目标代码库配置
 * @param name 目标名称，对应 config/targets/{name}.yaml
 * @returns 解析并校验后的 TargetConfig
 * @throws ConfigError 配置格式错误
 * @throws PermissionError read_only 不为 true
 */
export function loadTargetConfig(name: string): TargetConfig {
  // 1. 读取 YAML 文件
  const yamlPath = path.join(TARGETS_DIR, `${name}.yaml`);
  if (!fs.existsSync(yamlPath)) {
    throw new ConfigError(
      `Target config not found: ${yamlPath}. Expected config/targets/${name}.yaml`,
    );
  }

  const rawYaml = fs.readFileSync(yamlPath, 'utf-8');
  const parsed = parseYaml(rawYaml) as RawYamlConfig;
  if (!parsed || typeof parsed !== 'object') {
    throw new ConfigError(`Failed to parse ${yamlPath}: empty or invalid YAML`);
  }

  // 2. 校验必填字段
  assertString(parsed.name, 'name');
  assertString(parsed.root, 'root');

  const description = parsed.description;
  if (description !== undefined) {
    assertString(description, 'description');
  }

  // 3. 展开并解析 root 路径
  const rootRaw = expandPath(parsed.root);
  const root = path.resolve(rootRaw);
  if (!fs.existsSync(root)) {
    throw new ConfigError(
      `Target root directory does not exist: ${root}\n  (resolved from config value: "${parsed.root}")`,
    );
  }
  if (!fs.statSync(root).isDirectory()) {
    throw new ConfigError(`Target root is not a directory: ${root}`);
  }

  // 4. 只读约束
  const readOnly = parsed.read_only;
  if (readOnly !== true) {
    throw new PermissionError(
      `Target "${parsed.name}" must have read_only: true. ` +
        `code-sherpa only supports read-only targets.`,
    );
  }

  // 5. 路径映射
  const paths: Record<string, string> = {};
  if (parsed.paths) {
    assertRecord(parsed.paths, 'paths');
    for (const [alias, relPath] of Object.entries(parsed.paths as Record<string, string>)) {
      paths[alias] = path.resolve(root, relPath);
    }
  }

  // 6. 领域知识文件路径
  const context: Record<string, string> = {};
  if (parsed.context) {
    assertRecord(parsed.context, 'context');
    for (const [key, relPath] of Object.entries(parsed.context as Record<string, string>)) {
      context[key] = path.resolve(root, relPath);
    }
  }

  // 7. 索引配置
  const index = parsed.index;
  assertIndexConfig(index);

  return {
    name: parsed.name,
    description: description ?? '',
    root,
    readOnly,
    paths,
    context,
    index,
  };
}

// ============================================================
// 安全工具
// ============================================================

/**
 * 安全地将相对路径解析为绝对路径
 * 防止路径穿越攻击（如 ../../etc/passwd）
 *
 * @throws SecurityError 检测到路径穿越
 */
export function resolvePath(target: TargetConfig, relativePath: string): string {
  const absolute = path.resolve(target.root, relativePath);

  // 规范化后的路径必须在 target.root 之内
  // 注意：Windows 盘符大小写不一致，统一 lower
  const normalizedTarget = path.resolve(target.root).toLowerCase();
  const normalizedAbsolute = absolute.toLowerCase();

  if (!normalizedAbsolute.startsWith(normalizedTarget + path.sep) &&
      normalizedAbsolute !== normalizedTarget) {
    throw new SecurityError(
      `Path traversal detected: "${relativePath}" resolves to "${absolute}", ` +
        `which is outside target root "${target.root}".`,
    );
  }

  return absolute;
}

/**
 * 强制只读检查
 * 所有写操作在执行前必须调用此函数
 *
 * @throws PermissionError 目标为只读时抛出
 */
export function enforceReadOnly(target: TargetConfig): void {
  if (target.readOnly) {
    throw new PermissionError(
      `Target "${target.name}" is read-only. Write operations are prohibited.`,
    );
  }
}
