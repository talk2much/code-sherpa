// ============================================================
// Memory 系统类型 — 来自 spec 04-memory-system
// ============================================================

import type { SymbolNode } from './indexer.js';

// ---- Level 1: Session Memory ----

export interface FileCacheEntry {
  content: string;
  lines: number;
  lastRead: number;
  accessCount: number;
}

export interface SessionMemory {
  // 文件缓存（避免重复读取）
  fileCache: Map<string, FileCacheEntry>;
  // 符号缓存
  symbolCache: Map<string, SymbolNode>;
  // 已使用的 Tools（去重和审计）
  executedTools: { tool: string; args: string }[];
}

// ---- Level 2: Workspace Memory ----

export interface WorkspaceMemory {
  target: string;
  lastUpdated: number;

  projectMap: {
    packages: string[];
    apps: string[];
    keyFiles: Record<string, string>; // 别名 -> 路径
  };

  accessPatterns: {
    filePath: string;
    accessCount: number;
    lastAccess: number;
    typicalQueries: string[];
  }[];

  domainKnowledge: {
    ubiquitousLanguage: Record<string, string>;
    keyConcepts: string[];
    architectureSummary: string;
  };

  queryHistory: {
    query: string;
    timestamp: number;
    answer: string;
    relevantFiles: string[];
  }[];

  corrections: {
    originalAnswer: string;
    correction: string;
    filePath: string;
    timestamp: number;
  }[];
}

// ---- Level 3: Long-term Memory ----

export interface LongTermMemory {
  userPreferences: {
    preferredOutputFormat: 'detailed' | 'summary' | 'json';
    maxIterationsPreference: number;
    commonlyUsedTargets: string[];
  };

  globalPatterns: {
    pattern: string;
    description: string;
    seenIn: string[];
  }[];

  toolExperience: {
    scenario: string;
    recommendedTools: string[];
    successRate: number;
  }[];

  symbolAliases: Record<string, string[]>;
}
