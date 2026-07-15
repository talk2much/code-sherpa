// ============================================================
// 错误恢复 & 硬校验类型 — 来自 spec 08-error-recovery + 08a
// ============================================================

// ---- 校验结果 ----

export interface ValidationResult {
  valid: boolean;
  error?: string;
  actualContent?: string;
}

export interface ValidatedItem {
  filePath: string;
  lineNumber: number;
  symbolName?: string;
  valid: boolean;
  error?: string;
}

export interface ValidationBudget {
  fastChannelMaxMs: number;
  slowChannelMaxMs: number;
}

// ---- 置信度评估 ----

export interface ConfidenceFactor {
  name:
    | 'referenceValidity'
    | 'iterationPenalty'
    | 'toolDiversity'
    | 'uncertaintyPenalty';
  displayName: string;
  score: number; // 0.0-1.0
  weight: number; // 0.0-1.0
  detail: Record<string, unknown>;
}

export interface ConfidenceResult {
  score: number; // 0.00-1.00
  level: 'high' | 'medium' | 'low';
  factors: ConfidenceFactor[];
  primaryIssue: string | null;
}

// ---- 信号汇总 & 决策路由 ----

export interface ExecutionSignals {
  iterationStalled: boolean;
  toolsExhausted: boolean;
}

export interface DataSignals {
  indexStale: boolean;
  fileNotFound: string[];
}

export interface ConsistencySignals {
  llmContradicted: boolean;
  contradictionDetail?: string;
}

export interface DecisionInput {
  confidence: ConfidenceResult;
  executionSignals: ExecutionSignals;
  dataSignals: DataSignals;
  consistencySignals: ConsistencySignals;
}

export type DegradeStrategy =
  | { method: 'retry_with_filter'; description: string }
  | { method: 'switch_toolchain'; from: string; to: string }
  | { method: 'raw_file_read'; description: string }
  | { method: 'restart_clean'; description: string };

export type EscalationType =
  | 'tool_failure'
  | 'hallucination'
  | 'loop_detected'
  | 'contradiction'
  | 'token_limit'
  | 'index_stale'
  | 'parse_error'
  | 'system_error'
  | 'low_confidence';

export interface EscalationResult {
  status: 'escalated';
  escalationType: EscalationType;
  reason: string;
  partialResult?: unknown;
  suggestedActions: string[];
}

export type ActionDecision =
  | { action: 'execute'; result: unknown }
  | {
      action: 'degrade';
      strategy: DegradeStrategy;
      partialResult: unknown;
      reason: string;
    }
  | { action: 'escalate'; escalation: EscalationResult };
