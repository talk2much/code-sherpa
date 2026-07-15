// ============================================================
// Agent 核心类型 — 来自 spec 01-agent-core-architecture
// ============================================================

import type { TargetConfig } from './config.js';

// ---- Skill ----

export type PlanningStrategy = 'single_shot' | 'sequential' | 'map_reduce';

export interface Skill {
  name: string;
  description: string;
  systemPromptSections: string[];
  availableTools: string[];
  planningStrategy: PlanningStrategy;
}

// ---- Agent Loop ----

export interface AgentLoopConfig {
  model: string; // "deepseek-chat"
  maxTokens: number;
  temperature: number;
  skill: Skill;
  target: TargetConfig;
}

export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface AgentResult {
  answer: string | null;
  executedTools: { tool: string; args: string }[];
  iterations: number;
  duration: number; // ms
}

// ---- Hooks（Phase 1 MVP 只实现 post:tool_use） ----

export interface HookRegistry {
  'pre:tool_use'?: (
    toolCall: ToolCall,
    config: AgentLoopConfig,
  ) => Promise<void>;
  'post:tool_use'?: (
    toolCall: ToolCall,
    result: unknown,
    config: AgentLoopConfig,
  ) => Promise<void>;
  'pre:iteration'?: (
    messages: Message[],
    config: AgentLoopConfig,
  ) => Promise<void>;
  'post:iteration'?: (
    messages: Message[],
    config: AgentLoopConfig,
  ) => Promise<void>;
}

// ---- Tool Handler ----

export type ToolHandler = (
  args: Record<string, unknown>,
  config: AgentLoopConfig,
) => Promise<unknown>;

export type ToolRegistry = Record<string, ToolHandler>;
