// ============================================================
// 配置加载器 — 单元测试
// ============================================================

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadTargetConfig, resolvePath, enforceReadOnly } from '../../src/config/loader.js';
import { ConfigError, PermissionError, SecurityError } from '../../src/config/errors.js';
import type { TargetConfig } from '../../src/types/config.js';

describe('loadTargetConfig', () => {
  it('should load the real lpgj.yaml config', () => {
    // lpgj.yaml 的 root 可能不存在（无 LPGJ 代码库），所以这里只测加载逻辑
    // 如果 LPGJ 存在则测完整流程
    const lpgjRoot = 'E:\\AI\\Trae_Project\\lpgj';
    const rootExists = fs.existsSync(lpgjRoot);

    if (rootExists) {
      const config = loadTargetConfig('lpgj');
      expect(config.name).toBe('lpgj');
      expect(config.readOnly).toBe(true);
      expect(config.root.toLowerCase()).toBe(lpgjRoot.toLowerCase());
      expect(config.paths).toBeDefined();
      expect(config.context).toBeDefined();
      expect(config.index).toBeDefined();
      expect(config.index.include.length).toBeGreaterThan(0);
      // paths 值应该是绝对路径
      for (const absPath of Object.values(config.paths)) {
        expect(path.isAbsolute(absPath)).toBe(true);
      }
    } else {
      // LPGJ 目录不存在，验证抛出 ConfigError
      expect(() => loadTargetConfig('lpgj')).toThrow(ConfigError);
      expect(() => loadTargetConfig('lpgj')).toThrow(/does not exist/);
    }
  });

  it('should throw ConfigError for non-existent target', () => {
    expect(() => loadTargetConfig('nonexistent-target-xyz')).toThrow(ConfigError);
    expect(() => loadTargetConfig('nonexistent-target-xyz')).toThrow(/not found/);
  });
});

describe('enforceReadOnly', () => {
  it('should throw PermissionError when readOnly is true', () => {
    const target: TargetConfig = {
      name: 'test',
      description: '',
      root: '/tmp/test',
      readOnly: true,
      paths: {},
      context: {},
      index: { include: [], exclude: [], max_file_lines: 1000 },
    };
    expect(() => enforceReadOnly(target)).toThrow(PermissionError);
    expect(() => enforceReadOnly(target)).toThrow(/read-only/);
  });

  it('should not throw when readOnly is false', () => {
    const target: TargetConfig = {
      name: 'test',
      description: '',
      root: '/tmp/test',
      readOnly: false,
      paths: {},
      context: {},
      index: { include: [], exclude: [], max_file_lines: 1000 },
    };
    expect(() => enforceReadOnly(target)).not.toThrow();
  });
});

describe('resolvePath', () => {
  const target: TargetConfig = {
    name: 'test',
    description: '',
    root: '/tmp/test-project',
    readOnly: true,
    paths: {},
    context: {},
    index: { include: [], exclude: [], max_file_lines: 1000 },
  };

  it('should resolve a normal relative path', () => {
    const resolved = resolvePath(target, 'src/index.ts');
    expect(resolved).toBe(path.resolve('/tmp/test-project', 'src/index.ts'));
  });

  it('should reject path traversal with ..', () => {
    expect(() => resolvePath(target, '../../etc/passwd')).toThrow(SecurityError);
    expect(() => resolvePath(target, '../../etc/passwd')).toThrow(/traversal/);
  });

  it('should reject path traversal with absolute path outside root', () => {
    expect(() => resolvePath(target, '/etc/passwd')).toThrow(SecurityError);
  });

  it('should allow paths that resolve exactly to root', () => {
    const resolved = resolvePath(target, '.');
    expect(resolved).toBe(path.resolve('/tmp/test-project'));
  });
});
