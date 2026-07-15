// ============================================================
// Tool 接口类型 — 来自 spec 03-tool-interface
// MVP 期 8 个 Tool 的输入输出定义
// ============================================================

import type { ReferenceEdge, SymbolNode } from './indexer.js';

// ---- Tool 1: file_read ----

export interface FileReadInput {
  file_path: string; // 相对 LPGJ root 的路径
  offset?: number; // 起始行（1-based），默认 1
  limit?: number; // 读取行数，默认 50
}

export interface FileReadOutputLine {
  line_number: number;
  text: string;
}

export interface FileReadOutput {
  file_path: string;
  total_lines: number;
  lines: FileReadOutputLine[];
  truncated: boolean;
}

// ---- Tool 2: grep_search ----

export interface GrepSearchInput {
  pattern: string;
  path?: string;
  file_pattern?: string;
  max_results?: number; // 默认 20
}

export interface GrepSearchResult {
  file_path: string;
  line_number: number;
  text: string;
  match_start: number;
  match_end: number;
}

export interface GrepSearchOutput {
  results: GrepSearchResult[];
  total_matches: number;
  truncated: boolean;
}

// ---- Tool 3: ast_query ----

export type ASTQueryType =
  | 'find_references'
  | 'find_definition'
  | 'find_imports'
  | 'find_exports'
  | 'find_callers'
  | 'get_type_info';

export interface ASTQueryInput {
  file_path: string;
  query_type: ASTQueryType;
  symbol_name?: string;
}

export interface ASTQueryResultItem {
  file_path: string;
  line_number: number;
  column: number;
  text: string;
  context: string; // 前后 2 行上下文
}

export interface ASTQueryOutput {
  query_type: string;
  results: ASTQueryResultItem[];
}

// ---- Tool 4: symbol_graph_query ----

export type SymbolGraphOperation =
  | 'get_symbol_info'
  | 'get_direct_refs'
  | 'get_transitive_refs'
  | 'get_importers'
  | 'get_dependencies';

export interface SymbolGraphQueryInput {
  operation: SymbolGraphOperation;
  symbol_id?: string;
  module_id?: string;
  max_depth?: number; // 传递查询最大深度，默认 3
}

export interface SymbolGraphQueryOutput {
  nodes: SymbolNode[];
  edges: ReferenceEdge[];
}

// ---- Tool 5: vector_search ----

export interface VectorSearchInput {
  query: string;
  top_k?: number; // 默认 5
  file_pattern?: string;
}

export interface VectorSearchResult {
  file_path: string;
  start_line: number;
  end_line: number;
  content: string;
  score: number;
  symbols: string[];
}

export interface VectorSearchOutput {
  results: VectorSearchResult[];
}

// ---- Tool 6: db_schema_read ----

export interface DBSchemaReadInput {
  model_name?: string; // 不传则返回所有模型列表
  include_fields?: boolean; // 默认 true
}

export interface DBField {
  name: string;
  type: string;
  isOptional: boolean;
  isRelation: boolean;
  relationTo?: string;
  documentation?: string;
}

export interface DBRelation {
  name: string;
  type: '1:1' | '1:n' | 'n:m';
  related_model: string;
}

export interface DBModel {
  name: string;
  fields: DBField[];
  relations: DBRelation[];
}

export interface DBSchemaReadOutput {
  models: DBModel[];
}

// ---- Tool 7: contract_trace ----

export interface ContractTraceInput {
  contract_name: string;
  operation?: 'request' | 'response' | 'both';
}

export interface ContractTraceOutput {
  contract: {
    name: string;
    file_path: string;
    routes: {
      path: string;
      method: string;
      request_type: string;
      response_type: string;
    }[];
  };
  server_impl: {
    file_path: string;
    line_number: number;
  }[];
  client_usage: {
    file_path: string;
    line_number: number;
  }[];
}

// ---- Tool 8: git_log ----

export interface GitLogInput {
  file_path?: string;
  symbol_name?: string;
  limit?: number; // 默认 10
  since?: string; // 如 "2024-01-01"
}

export interface GitLogCommit {
  hash: string;
  author: string;
  date: string;
  message: string;
  files_changed: string[];
  diff_summary: string;
}

export interface GitLogOutput {
  commits: GitLogCommit[];
}

// ---- Tool Registry ----

/** 所有 Tool 输入类型的联合 */
export type ToolInput =
  | { tool: 'file_read'; args: FileReadInput }
  | { tool: 'grep_search'; args: GrepSearchInput }
  | { tool: 'ast_query'; args: ASTQueryInput }
  | { tool: 'symbol_graph_query'; args: SymbolGraphQueryInput }
  | { tool: 'vector_search'; args: VectorSearchInput }
  | { tool: 'db_schema_read'; args: DBSchemaReadInput }
  | { tool: 'contract_trace'; args: ContractTraceInput }
  | { tool: 'git_log'; args: GitLogInput };

/** 所有 Tool 输出类型的联合 */
export type ToolOutput =
  | FileReadOutput
  | GrepSearchOutput
  | ASTQueryOutput
  | SymbolGraphQueryOutput
  | VectorSearchOutput
  | DBSchemaReadOutput
  | ContractTraceOutput
  | GitLogOutput;
