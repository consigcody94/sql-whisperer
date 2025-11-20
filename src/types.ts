/**
 * Type definitions for SQL Whisperer MCP Server
 * Comprehensive type system for multi-database support
 */

// ============================================================================
// Database Configuration Types
// ============================================================================

export type DatabaseType = 'postgresql' | 'mysql' | 'sqlite';

export interface DatabaseConfig {
  type: DatabaseType;
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
  // SQLite-specific
  filename?: string;
  // Connection pool settings
  poolMin?: number;
  poolMax?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

// ============================================================================
// Schema Introspection Types
// ============================================================================

export interface DatabaseSchema {
  tables: TableSchema[];
  views: ViewSchema[];
  sequences?: SequenceSchema[];
  functions?: FunctionSchema[];
  triggers?: TriggerSchema[];
  metadata: SchemaMetadata;
}

export interface TableSchema {
  name: string;
  schema: string;
  columns: ColumnSchema[];
  primaryKey?: PrimaryKeyConstraint;
  foreignKeys: ForeignKeyConstraint[];
  uniqueConstraints: UniqueConstraint[];
  checkConstraints: CheckConstraint[];
  indexes: IndexSchema[];
  triggers: TriggerSchema[];
  rowCount?: number;
  sizeBytes?: number;
  comment?: string;
}

export interface ColumnSchema {
  name: string;
  dataType: string;
  nativeType: string;
  isNullable: boolean;
  defaultValue?: string;
  isAutoIncrement: boolean;
  maxLength?: number;
  precision?: number;
  scale?: number;
  characterSet?: string;
  collation?: string;
  comment?: string;
  enumValues?: string[];
}

export interface PrimaryKeyConstraint {
  name: string;
  columns: string[];
}

export interface ForeignKeyConstraint {
  name: string;
  columns: string[];
  referencedTable: string;
  referencedSchema: string;
  referencedColumns: string[];
  onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION' | 'SET DEFAULT';
  onUpdate: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION' | 'SET DEFAULT';
}

export interface UniqueConstraint {
  name: string;
  columns: string[];
}

export interface CheckConstraint {
  name: string;
  expression: string;
}

export interface IndexSchema {
  name: string;
  columns: IndexColumn[];
  isUnique: boolean;
  isPrimary: boolean;
  type: string; // BTREE, HASH, GIN, GIST, etc.
  condition?: string; // Partial index condition
  sizeBytes?: number;
}

export interface IndexColumn {
  name: string;
  order: 'ASC' | 'DESC';
  nullsFirst?: boolean;
}

export interface ViewSchema {
  name: string;
  schema: string;
  definition: string;
  columns: ColumnSchema[];
  comment?: string;
}

export interface SequenceSchema {
  name: string;
  schema: string;
  startValue: number;
  currentValue: number;
  increment: number;
  minValue?: number;
  maxValue?: number;
  cycle: boolean;
}

export interface FunctionSchema {
  name: string;
  schema: string;
  returnType: string;
  parameters: FunctionParameter[];
  language: string;
  definition: string;
}

export interface FunctionParameter {
  name: string;
  dataType: string;
  mode: 'IN' | 'OUT' | 'INOUT';
}

export interface TriggerSchema {
  name: string;
  table: string;
  timing: 'BEFORE' | 'AFTER' | 'INSTEAD OF';
  events: Array<'INSERT' | 'UPDATE' | 'DELETE'>;
  forEachRow: boolean;
  condition?: string;
  definition: string;
}

export interface SchemaMetadata {
  databaseType: DatabaseType;
  databaseVersion: string;
  serverVersion?: string;
  characterSet?: string;
  collation?: string;
  introspectedAt: Date;
  introspectionDurationMs: number;
}

// ============================================================================
// Query Execution Types
// ============================================================================

export interface QueryRequest {
  query: string;
  params?: unknown[];
  options?: QueryOptions;
}

export interface QueryOptions {
  readOnly?: boolean;
  timeout?: number;
  maxRows?: number;
  explain?: boolean;
  analyze?: boolean;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  fields: FieldInfo[];
  executionTimeMs: number;
  explainPlan?: ExplainPlan;
}

export interface FieldInfo {
  name: string;
  dataType: string;
  tableID?: number;
  columnID?: number;
}

export interface ExplainPlan {
  raw: string;
  formatted: string;
  totalCost: number;
  planRows: number;
  actualRows?: number;
  actualTimeMs?: number;
  nodes: ExplainNode[];
  warnings: string[];
  recommendations: string[];
}

export interface ExplainNode {
  nodeType: string;
  relationName?: string;
  alias?: string;
  startupCost: number;
  totalCost: number;
  planRows: number;
  planWidth: number;
  actualTimeMs?: number;
  actualRows?: number;
  loops?: number;
  filter?: string;
  joinType?: string;
  indexName?: string;
  indexCondition?: string;
  children: ExplainNode[];
}

// ============================================================================
// Query Validation Types
// ============================================================================

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  metadata: QueryMetadata;
}

export interface ValidationError {
  code: string;
  message: string;
  severity: 'error' | 'critical';
  position?: number;
  suggestion?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  severity: 'warning' | 'info';
  suggestion?: string;
}

export interface QueryMetadata {
  queryType: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'DDL' | 'TRANSACTION' | 'OTHER';
  isMutation: boolean;
  tablesAccessed: string[];
  estimatedComplexity: 'low' | 'medium' | 'high';
  requiresConfirmation: boolean;
}

// ============================================================================
// Natural Language Processing Types
// ============================================================================

export interface NaturalLanguageRequest {
  prompt: string;
  context?: QueryContext;
}

export interface QueryContext {
  previousQueries?: string[];
  focusedTables?: string[];
  userRole?: string;
  maxRows?: number;
}

export interface GeneratedQuery {
  sql: string;
  explanation: string;
  parameters: unknown[];
  confidence: number;
  alternatives: AlternativeQuery[];
  warnings: string[];
}

export interface AlternativeQuery {
  sql: string;
  explanation: string;
  tradeoff: string;
}

// ============================================================================
// MCP Protocol Types
// ============================================================================

export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: MCPParams;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: MCPError;
}

export interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}

export interface MCPParams {
  name?: string;
  arguments?: Record<string, unknown>;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ============================================================================
// Statistics and Monitoring Types
// ============================================================================

export interface TableStatistics {
  tableName: string;
  rowCount: number;
  sizeBytes: number;
  indexSizeBytes: number;
  deadTuples?: number; // PostgreSQL-specific
  lastVacuum?: Date;
  lastAnalyze?: Date;
  autoVacuumCount?: number;
  indexScans?: number;
  sequentialScans?: number;
  tuplesInserted?: number;
  tuplesUpdated?: number;
  tuplesDeleted?: number;
}

export interface QueryStatistics {
  queryHash: string;
  query: string;
  executionCount: number;
  totalTimeMs: number;
  meanTimeMs: number;
  minTimeMs: number;
  maxTimeMs: number;
  stddevTimeMs: number;
  rows: number;
  sharedBlkHit?: number;
  sharedBlkRead?: number;
  tempBlkRead?: number;
  tempBlkWritten?: number;
}

// ============================================================================
// Connection and Client Types
// ============================================================================

export interface DatabaseClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  query(request: QueryRequest): Promise<QueryResult>;
  introspect(): Promise<DatabaseSchema>;
  getTableStatistics(tableName: string): Promise<TableStatistics>;
  explain(query: string, analyze?: boolean): Promise<ExplainPlan>;
  isConnected(): boolean;
  getDatabaseType(): DatabaseType;
}

export interface ConnectionPool {
  acquire(): Promise<Connection>;
  release(connection: Connection): Promise<void>;
  destroy(): Promise<void>;
  getStats(): PoolStatistics;
}

export interface Connection {
  execute(query: string, params?: unknown[]): Promise<QueryResult>;
  close(): Promise<void>;
}

export interface PoolStatistics {
  totalConnections: number;
  idleConnections: number;
  activeConnections: number;
  waitingRequests: number;
}
