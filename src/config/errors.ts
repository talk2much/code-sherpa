// ============================================================
// 配置加载器 — 自定义错误类
// 对应 spec 00-workspace-config → 只读边界 enforcement
// ============================================================

/** 配置相关的基础错误 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** 违反只读约束时抛出 */
export class PermissionError extends ConfigError {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

/** 路径穿越攻击或非法路径访问时抛出 */
export class SecurityError extends ConfigError {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}
