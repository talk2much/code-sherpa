// code-sherpa 入口
// Phase 0：仅骨架，后续 Phase 再填充

export type * from './types/index.js';

// Phase 1：配置加载器
export { loadTargetConfig, resolvePath, enforceReadOnly } from './config/loader.js';
export { ConfigError, PermissionError, SecurityError } from './config/errors.js';
