// ============================================================
// 索引相关类型 — 来自 spec 02-code-indexing-rag
// ============================================================

/** 符号节点——符号依赖图的基本单元 */
export interface SymbolNode {
  id: string; // 全局唯一: "lpgj:packages/contracts/src/order.contract.ts:CustomerOrder"
  name: string;
  kind: 'type' | 'interface' | 'function' | 'class' | 'variable' | 'enum';
  filePath: string; // 相对 LPGJ root 的路径
  line: number;
  column: number;
  exported: boolean;
  moduleId: string;
}

/** 引用边——表示一个符号引用另一个符号 */
export interface ReferenceEdge {
  source: string; // SymbolNode.id
  target: string; // SymbolNode.id
  kind: 'import' | 'export' | 'call' | 'type_ref' | 'inheritance';
  filePath: string;
  line: number;
  isDynamic: boolean;
}

/** 模块节点——表示一个文件（模块） */
export interface ModuleNode {
  id: string; // "lpgj:packages/contracts/src/order.contract.ts"
  filePath: string;
  packageName: string;
  imports: string[]; // import 的模块 ID 列表
  exports: string[]; // 导出的 Symbol ID 列表
}

/** 代码块——向量索引的基本单元 */
export interface CodeChunk {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  symbolNames: string[];
  docComment: string;
  embedding: number[]; // 向量（1536 维）
}

/** 文件清单条目——用于增量更新检测 */
export interface FileEntry {
  path: string;
  package: string;
  lines: number;
  lastModified: number;
  contentHash: string; // MD5
  exports: string[];
  imports: string[];
}
