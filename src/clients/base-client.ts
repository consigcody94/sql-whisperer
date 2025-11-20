/**
 * Base Database Client Abstract Class
 * Provides common functionality for all database clients
 */

import type {
  DatabaseClient,
  DatabaseConfig,
  DatabaseSchema,
  DatabaseType,
  ExplainPlan,
  QueryRequest,
  QueryResult,
  TableStatistics,
} from '../types.js';

export abstract class BaseDatabaseClient implements DatabaseClient {
  protected config: DatabaseConfig;
  protected connected: boolean = false;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract query(request: QueryRequest): Promise<QueryResult>;
  abstract introspect(): Promise<DatabaseSchema>;
  abstract getTableStatistics(tableName: string): Promise<TableStatistics>;
  abstract explain(query: string, analyze?: boolean): Promise<ExplainPlan>;

  isConnected(): boolean {
    return this.connected;
  }

  getDatabaseType(): DatabaseType {
    return this.config.type;
  }

  /**
   * Validates query timeout and applies default
   */
  protected normalizeTimeout(timeout?: number): number {
    const defaultTimeout = 30000; // 30 seconds
    const maxTimeout = 300000; // 5 minutes

    if (!timeout) return defaultTimeout;
    if (timeout < 0) return defaultTimeout;
    if (timeout > maxTimeout) return maxTimeout;

    return timeout;
  }

  /**
   * Validates max rows and applies default
   */
  protected normalizeMaxRows(maxRows?: number): number {
    const defaultMaxRows = 1000;
    const absoluteMaxRows = 10000;

    if (!maxRows) return defaultMaxRows;
    if (maxRows < 0) return defaultMaxRows;
    if (maxRows > absoluteMaxRows) return absoluteMaxRows;

    return maxRows;
  }

  /**
   * Formats bytes to human-readable size
   */
  protected formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }

  /**
   * Extracts table and schema from qualified name
   */
  protected parseTableName(tableName: string): { schema: string; table: string } {
    const parts = tableName.split('.');

    if (parts.length === 2) {
      return { schema: parts[0], table: parts[1] };
    }

    return { schema: 'public', table: parts[0] };
  }

  /**
   * Ensures connection is established before operation
   */
  protected ensureConnected(): void {
    if (!this.connected) {
      throw new Error('Database client is not connected. Call connect() first.');
    }
  }
}
