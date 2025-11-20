/**
 * SQLite Database Client
 * Implements SQLite3 introspection with lightweight optimizations
 */

import Database from 'better-sqlite3';
import type { Database as SQLiteDatabase, Statement } from 'better-sqlite3';
import { BaseDatabaseClient } from './base-client.js';
import type {
  DatabaseConfig,
  DatabaseSchema,
  QueryRequest,
  QueryResult,
  TableSchema,
  ColumnSchema,
  IndexSchema,
  ForeignKeyConstraint,
  ExplainPlan,
  TableStatistics,
  SchemaMetadata,
} from '../types.js';

export class SQLiteClient extends BaseDatabaseClient {
  private db: SQLiteDatabase | null = null;

  constructor(config: DatabaseConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (!this.config.filename) {
      throw new Error('SQLite filename is required');
    }

    try {
      this.db = new Database(this.config.filename, {
        readonly: false,
        fileMustExist: false,
      });

      // Enable foreign keys (disabled by default in SQLite)
      this.db.pragma('foreign_keys = ON');

      // Set WAL mode for better concurrency
      this.db.pragma('journal_mode = WAL');

      // Optimize for performance
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('cache_size = -64000'); // 64MB cache
      this.db.pragma('temp_store = MEMORY');

      this.connected = true;
    } catch (error) {
      throw new Error(`Failed to connect to SQLite: ${(error as Error).message}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.connected = false;
  }

  async query(request: QueryRequest): Promise<QueryResult> {
    this.ensureConnected();

    const startTime = Date.now();
    const maxRows = this.normalizeMaxRows(request.options?.maxRows);

    try {
      let stmt: Statement;

      if (request.params && request.params.length > 0) {
        stmt = this.db!.prepare(request.query);
      } else {
        stmt = this.db!.prepare(request.query);
      }

      // Check if query is SELECT or returns data
      const isSelect = request.query.trim().toUpperCase().startsWith('SELECT');

      let rows: Record<string, unknown>[];
      let rowCount: number;

      if (isSelect) {
        if (request.params && request.params.length > 0) {
          rows = stmt.all(...(request.params as unknown[])) as Record<string, unknown>[];
        } else {
          rows = stmt.all() as Record<string, unknown>[];
        }

        rowCount = rows.length;

        // Apply row limit
        rows = rows.slice(0, maxRows);
      } else {
        // For INSERT/UPDATE/DELETE
        const result = request.params
          ? stmt.run(...(request.params as unknown[]))
          : stmt.run();

        rows = [];
        rowCount = result.changes;
      }

      const executionTimeMs = Date.now() - startTime;

      // Get column info from statement
      const columns = isSelect ? stmt.columns() : [];

      const queryResult: QueryResult = {
        rows,
        rowCount,
        fields: columns.map(col => ({
          name: col.name,
          dataType: col.type || 'unknown',
        })),
        executionTimeMs,
      };

      // Get explain plan if requested
      if (request.options?.explain) {
        queryResult.explainPlan = await this.explain(
          request.query,
          request.options?.analyze
        );
      }

      return queryResult;
    } catch (error) {
      throw new Error(`Query execution failed: ${(error as Error).message}`);
    }
  }

  async introspect(): Promise<DatabaseSchema> {
    this.ensureConnected();
    const startTime = Date.now();

    const [tables, metadata] = await Promise.all([
      this.introspectTables(),
      this.getMetadata(),
    ]);

    const introspectionDurationMs = Date.now() - startTime;

    return {
      tables,
      views: [], // TODO: Implement views
      metadata: {
        ...metadata,
        introspectedAt: new Date(),
        introspectionDurationMs,
      },
    };
  }

  private async introspectTables(): Promise<TableSchema[]> {
    const query = `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name;
    `;

    const tables = this.db!.prepare(query).all() as { name: string }[];

    return Promise.all(
      tables.map(async row => {
        const [columns, indexes, foreignKeys] = await Promise.all([
          this.introspectColumns(row.name),
          this.introspectIndexes(row.name),
          this.introspectForeignKeys(row.name),
        ]);

        // Get row count
        const countResult = this.db!.prepare(`SELECT COUNT(*) as count FROM "${row.name}"`).get() as { count: number };
        const rowCount = countResult.count;

        // Get table size (pages * page_size)
        const pageSizeResult = this.db!.pragma('page_size', { simple: true }) as number;
        const pageCountResult = this.db!.prepare(
          `SELECT (SELECT COUNT(*) FROM pragma_page_count()) as pages`
        ).get() as { pages: number };

        const sizeBytes = pageCountResult.pages * pageSizeResult;

        return {
          name: row.name,
          schema: 'main',
          columns,
          primaryKey: indexes.find(idx => idx.isPrimary)
            ? {
                name: indexes.find(idx => idx.isPrimary)!.name,
                columns: indexes
                  .find(idx => idx.isPrimary)!
                  .columns.map(c => c.name),
              }
            : undefined,
          foreignKeys,
          uniqueConstraints: indexes
            .filter(idx => idx.isUnique && !idx.isPrimary)
            .map(idx => ({
              name: idx.name,
              columns: idx.columns.map(c => c.name),
            })),
          checkConstraints: [],
          indexes,
          triggers: [],
          rowCount,
          sizeBytes,
        } as TableSchema;
      })
    );
  }

  private async introspectColumns(table: string): Promise<ColumnSchema[]> {
    const columns = this.db!.pragma(`table_info("${table}")`) as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;

    return columns.map(col => ({
      name: col.name,
      dataType: this.normalizeSQLiteType(col.type),
      nativeType: col.type,
      isNullable: col.notnull === 0,
      defaultValue: col.dflt_value || undefined,
      isAutoIncrement: col.pk === 1 && col.type.toUpperCase() === 'INTEGER',
      maxLength: undefined,
      precision: undefined,
      scale: undefined,
      comment: undefined,
    }));
  }

  private async introspectIndexes(table: string): Promise<IndexSchema[]> {
    const indexes = this.db!.pragma(`index_list("${table}")`) as Array<{
      seq: number;
      name: string;
      unique: number;
      origin: string;
      partial: number;
    }>;

    return Promise.all(
      indexes.map(async idx => {
        const indexInfo = this.db!.pragma(`index_info("${idx.name}")`) as Array<{
          seqno: number;
          cid: number;
          name: string;
        }>;

        return {
          name: idx.name,
          columns: indexInfo.map(col => ({
            name: col.name,
            order: 'ASC' as const,
          })),
          isUnique: idx.unique === 1,
          isPrimary: idx.origin === 'pk',
          type: 'BTREE',
        };
      })
    );
  }

  private async introspectForeignKeys(table: string): Promise<ForeignKeyConstraint[]> {
    const fks = this.db!.pragma(`foreign_key_list("${table}")`) as Array<{
      id: number;
      seq: number;
      table: string;
      from: string;
      to: string;
      on_update: string;
      on_delete: string;
      match: string;
    }>;

    // Group by foreign key id
    const fkMap = new Map<number, ForeignKeyConstraint>();

    for (const fk of fks) {
      if (!fkMap.has(fk.id)) {
        fkMap.set(fk.id, {
          name: `fk_${table}_${fk.id}`,
          columns: [],
          referencedTable: fk.table,
          referencedSchema: 'main',
          referencedColumns: [],
          onDelete: fk.on_delete as ForeignKeyConstraint['onDelete'],
          onUpdate: fk.on_update as ForeignKeyConstraint['onUpdate'],
        });
      }

      const constraint = fkMap.get(fk.id)!;
      constraint.columns.push(fk.from);
      constraint.referencedColumns.push(fk.to);
    }

    return Array.from(fkMap.values());
  }

  private async getMetadata(): Promise<SchemaMetadata> {
    const versionResult = this.db!.prepare('SELECT sqlite_version() as version').get() as { version: string };

    return {
      databaseType: 'sqlite',
      databaseVersion: versionResult.version,
      serverVersion: versionResult.version,
      introspectedAt: new Date(),
      introspectionDurationMs: 0,
    };
  }

  async getTableStatistics(tableName: string): Promise<TableStatistics> {
    this.ensureConnected();

    // Get row count
    const countResult = this.db!.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`).get() as { count: number };

    // Get page count for this table (approximate size)
    const pageSizeResult = this.db!.pragma('page_size', { simple: true }) as number;
    const dbstatResult = this.db!.prepare(`
      SELECT
        SUM(pageno) as pages
      FROM dbstat
      WHERE name = ?
    `).get(tableName) as { pages: number } | undefined;

    const sizeBytes = dbstatResult ? dbstatResult.pages * pageSizeResult : 0;

    // Get index size
    const indexSizeResult = this.db!.prepare(`
      SELECT
        SUM(pageno) as pages
      FROM dbstat
      WHERE name LIKE ? || '_%'
    `).get(tableName) as { pages: number } | undefined;

    const indexSizeBytes = indexSizeResult ? indexSizeResult.pages * pageSizeResult : 0;

    return {
      tableName,
      rowCount: countResult.count,
      sizeBytes,
      indexSizeBytes,
    };
  }

  async explain(query: string, analyze = false): Promise<ExplainPlan> {
    this.ensureConnected();

    const explainQuery = analyze ? `EXPLAIN QUERY PLAN ${query}` : `EXPLAIN QUERY PLAN ${query}`;

    try {
      const rows = this.db!.prepare(explainQuery).all() as Array<{
        id: number;
        parent: number;
        notused: number;
        detail: string;
      }>;

      const formatted = rows.map(r => `${' '.repeat(r.id * 2)}→ ${r.detail}`).join('\n');

      // Parse for recommendations
      const recommendations: string[] = [];

      for (const row of rows) {
        if (row.detail.includes('SCAN TABLE')) {
          const match = row.detail.match(/SCAN TABLE (\w+)/);
          if (match) {
            recommendations.push(
              `Full table scan detected on ${match[1]}. Consider adding an index.`
            );
          }
        }

        if (row.detail.includes('USING TEMP B-TREE')) {
          recommendations.push(
            'Using temporary B-tree for sorting. Consider adding an index to match ORDER BY.'
          );
        }
      }

      return {
        raw: JSON.stringify(rows, null, 2),
        formatted,
        totalCost: 0, // SQLite doesn't provide cost estimates
        planRows: 0,
        nodes: [],
        warnings: [],
        recommendations,
      };
    } catch (error) {
      throw new Error(`EXPLAIN failed: ${(error as Error).message}`);
    }
  }

  private normalizeSQLiteType(sqliteType: string): string {
    const type = sqliteType.toUpperCase();

    if (type.includes('INT')) return 'integer';
    if (type.includes('CHAR') || type.includes('TEXT') || type.includes('CLOB'))
      return 'text';
    if (type.includes('REAL') || type.includes('FLOA') || type.includes('DOUB'))
      return 'real';
    if (type.includes('BLOB')) return 'blob';
    if (type.includes('NUMERIC') || type.includes('DECIMAL')) return 'numeric';
    if (type.includes('BOOL')) return 'boolean';
    if (type.includes('DATE') || type.includes('TIME')) return 'datetime';

    return 'blob'; // SQLite default
  }
}
