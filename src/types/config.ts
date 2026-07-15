// ============================================================
// 配置相关类型 — 来自 spec 00-workspace-config
// ============================================================

/** 索引配置（来自 lpgj.yaml 的 index 字段） */
export interface IndexConfig {
  include: string[];
  exclude: string[];
  max_file_lines: number;
}

/** 目标代码库配置——整个系统的"水源" */
export interface TargetConfig {
  name: string;
  description: string;
  root: string; // 已解析的绝对路径
  readOnly: boolean; // 必须为 true（code-sherpa 只允许只读目标）
  paths: Record<string, string>; // 别名 -> 相对路径
  context: Record<string, string>; // 领域知识文件路径
  index: IndexConfig;
}
