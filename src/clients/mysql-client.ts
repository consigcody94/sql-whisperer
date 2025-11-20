/**
 * MySQL Database Client
 * Implements MySQL/MariaDB introspection with InnoDB-specific optimizations
 */

import mysql from 'mysql2/promise';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
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
  ViewSchema,
  SchemaMetadata,
} from '../types.js';

export class MySQLClient extends BaseDatabaseClient {
  private pool: Pool | null = null;

  constructor(config: DatabaseConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    const poolConfig = {
      uri: this.config.connectionString,
      host: this.config.host,
      port: this.config.port || 3306,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl ? {} : undefined,
      waitForConnections: true,
      connectionLimit: this.config.poolMax || 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    };

    this.pool = mysql.createPool(poolConfig);

    // Test connection
    const conn = await this.pool.getConnection();
    conn.release();

    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    this.connected = false;
  }

  async query(request: QueryRequest): Promise<QueryResult> {
    this.ensureConnected();

    const startTime = Date.now();
    const maxRows = this.normalizeMaxRows(request.options?.maxRows);

    let conn: PoolConnection | null = null;

    try {
      conn = await this.pool!.getConnection();

      // Apply query-specific timeout
      if (request.options?.timeout !== undefined) {
        await conn.query(
          `SET SESSION MAX_EXECUTION_TIME=${this.normalizeTimeout(request.options.timeout)}`
        );
      }

      let rows: RowDataPacket[];
      let fields: mysql.FieldPacket[];

      if (request.params && request.params.length > 0) {
        [rows, fields] = await conn.query<RowDataPacket[]>(
          request.query,
          request.params as unknown[]
        );
      } else {
        [rows, fields] = await conn.query<RowDataPacket[]>(request.query);
      }

      const executionTimeMs = Date.now() - startTime;

      // Limit rows
      const limitedRows = rows.slice(0, maxRows);

      const queryResult: QueryResult = {
        rows: limitedRows as Record<string, unknown>[],
        rowCount: rows.length,
        fields: fields.map(f => ({
          name: f.name,
          dataType: this.mapMySQLType(f.type),
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
    } finally {
      if (conn) conn.release();
    }
  }

  async introspect(): Promise<DatabaseSchema> {
    this.ensureConnected();
    const startTime = Date.now();

    const [tables, views, metadata] = await Promise.all([
      this.introspectTables(),
      this.introspectViews(),
      this.getMetadata(),
    ]);

    const introspectionDurationMs = Date.now() - startTime;

    return {
      tables,
      views,
      metadata: {
        ...metadata,
        introspectedAt: new Date(),
        introspectionDurationMs,
      },
    };
  }

  private async introspectTables(): Promise<TableSchema[]> {
    const query = `
      SELECT
        t.TABLE_SCHEMA,
        t.TABLE_NAME,
        t.TABLE_COMMENT,
        t.TABLE_ROWS,
        (t.DATA_LENGTH + t.INDEX_LENGTH) as size_bytes
      FROM information_schema.TABLES t
      WHERE t.TABLE_SCHEMA = DATABASE()
        AND t.TABLE_TYPE = 'BASE TABLE'
      ORDER BY t.TABLE_NAME;
    `;

    const [rows] = await this.pool!.query<RowDataPacket[]>(query);

    const tables = await Promise.all(
      rows.map(async row => {
        const [columns, indexes, foreignKeys] = await Promise.all([
          this.introspectColumns(row.TABLE_SCHEMA, row.TABLE_NAME),
          this.introspectIndexes(row.TABLE_SCHEMA, row.TABLE_NAME),
          this.introspectForeignKeys(row.TABLE_SCHEMA, row.TABLE_NAME),
        ]);

        return {
          name: row.TABLE_NAME,
          schema: row.TABLE_SCHEMA,
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
          rowCount: row.TABLE_ROWS,
          sizeBytes: row.size_bytes,
          comment: row.TABLE_COMMENT,
        } as TableSchema;
      })
    );

    return tables;
  }

  private async introspectColumns(
    schema: string,
    table: string
  ): Promise<ColumnSchema[]> {
    const query = `
      SELECT
        COLUMN_NAME,
        DATA_TYPE,
        COLUMN_TYPE,
        IS_NULLABLE,
        COLUMN_DEFAULT,
        CHARACTER_MAXIMUM_LENGTH,
        NUMERIC_PRECISION,
        NUMERIC_SCALE,
        CHARACTER_SET_NAME,
        COLLATION_NAME,
        COLUMN_COMMENT,
        EXTRA
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION;
    `;

    const [rows] = await this.pool!.query<RowDataPacket[]>(query, [schema, table]);

    return rows.map(row => {
      // Extract ENUM values if applicable
      let enumValues: string[] | undefined;
      if (row.DATA_TYPE === 'enum') {
        const match = row.COLUMN_TYPE.match(/enum\((.*)\)/);
        if (match) {
          enumValues = match[1]
            .split(',')
            .map((v: string) => v.trim().replace(/^'|'$/g, ''));
        }
      }

      return {
        name: row.COLUMN_NAME,
        dataType: row.DATA_TYPE,
        nativeType: row.COLUMN_TYPE,
        isNullable: row.IS_NULLABLE === 'YES',
        defaultValue: row.COLUMN_DEFAULT,
        isAutoIncrement: row.EXTRA.includes('auto_increment'),
        maxLength: row.CHARACTER_MAXIMUM_LENGTH,
        precision: row.NUMERIC_PRECISION,
        scale: row.NUMERIC_SCALE,
        characterSet: row.CHARACTER_SET_NAME,
        collation: row.COLLATION_NAME,
        comment: row.COLUMN_COMMENT,
        enumValues,
      };
    });
  }

  private async introspectIndexes(
    schema: string,
    table: string
  ): Promise<IndexSchema[]> {
    const query = `
      SELECT
        s.INDEX_NAME,
        s.NON_UNIQUE,
        s.COLUMN_NAME,
        s.SEQ_IN_INDEX,
        s.COLLATION,
        s.INDEX_TYPE,
        CASE WHEN s.INDEX_NAME = 'PRIMARY' THEN 1 ELSE 0 END as is_primary
      FROM information_schema.STATISTICS s
      WHERE s.TABLE_SCHEMA = ? AND s.TABLE_NAME = ?
      ORDER BY s.INDEX_NAME, s.SEQ_IN_INDEX;
    `;

    const [rows] = await this.pool!.query<RowDataPacket[]>(query, [schema, table]);

    // Group by index name
    const indexMap = new Map<string, IndexSchema>();

    for (const row of rows) {
      if (!indexMap.has(row.INDEX_NAME)) {
        indexMap.set(row.INDEX_NAME, {
          name: row.INDEX_NAME,
          columns: [],
          isUnique: row.NON_UNIQUE === 0,
          isPrimary: row.is_primary === 1,
          type: row.INDEX_TYPE,
        });
      }

      const index = indexMap.get(row.INDEX_NAME)!;
      index.columns.push({
        name: row.COLUMN_NAME,
        order: row.COLLATION === 'A' ? 'ASC' : 'DESC',
      });
    }

    return Array.from(indexMap.values());
  }

  private async introspectForeignKeys(
    schema: string,
    table: string
  ): Promise<ForeignKeyConstraint[]> {
    const query = `
      SELECT
        kcu.CONSTRAINT_NAME,
        kcu.COLUMN_NAME,
        kcu.REFERENCED_TABLE_SCHEMA,
        kcu.REFERENCED_TABLE_NAME,
        kcu.REFERENCED_COLUMN_NAME,
        rc.UPDATE_RULE,
        rc.DELETE_RULE
      FROM information_schema.KEY_COLUMN_USAGE kcu
      JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
        ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
        AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
      WHERE kcu.TABLE_SCHEMA = ?
        AND kcu.TABLE_NAME = ?
        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION;
    `;

    const [rows] = await this.pool!.query<RowDataPacket[]>(query, [schema, table]);

    // Group by constraint name
    const fkMap = new Map<string, ForeignKeyConstraint>();

    for (const row of rows) {
      if (!fkMap.has(row.CONSTRAINT_NAME)) {
        fkMap.set(row.CONSTRAINT_NAME, {
          name: row.CONSTRAINT_NAME,
          columns: [],
          referencedTable: row.REFERENCED_TABLE_NAME,
          referencedSchema: row.REFERENCED_TABLE_SCHEMA,
          referencedColumns: [],
          onDelete: row.DELETE_RULE,
          onUpdate: row.UPDATE_RULE,
        });
      }

      const fk = fkMap.get(row.CONSTRAINT_NAME)!;
      fk.columns.push(row.COLUMN_NAME);
      fk.referencedColumns.push(row.REFERENCED_COLUMN_NAME);
    }

    return Array.from(fkMap.values());
  }

  private async introspectViews(): Promise<ViewSchema[]> {
    const query = `
      SELECT
        TABLE_SCHEMA,
        TABLE_NAME,
        VIEW_DEFINITION
      FROM information_schema.VIEWS
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME;
    `;

    const [rows] = await this.pool!.query<RowDataPacket[]>(query);

    return rows.map(row => ({
      name: row.TABLE_NAME,
      schema: row.TABLE_SCHEMA,
      definition: row.VIEW_DEFINITION,
      columns: [],
    }));
  }

  private async getMetadata(): Promise<SchemaMetadata> {
    const [versionRows] = await this.pool!.query<RowDataPacket[]>('SELECT VERSION() as version');
    const version = versionRows[0].version;

    const [charsetRows] = await this.pool!.query<RowDataPacket[]>(`
      SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME
      FROM information_schema.SCHEMATA
      WHERE SCHEMA_NAME = DATABASE()
    `);

    return {
      databaseType: 'mysql',
      databaseVersion: version,
      serverVersion: version,
      characterSet: charsetRows[0]?.DEFAULT_CHARACTER_SET_NAME,
      collation: charsetRows[0]?.DEFAULT_COLLATION_NAME,
      introspectedAt: new Date(),
      introspectionDurationMs: 0,
    };
  }

  async getTableStatistics(tableName: string): Promise<TableStatistics> {
    const { schema, table } = this.parseTableName(tableName);

    const query = `
      SELECT
        TABLE_NAME,
        TABLE_ROWS,
        DATA_LENGTH,
        INDEX_LENGTH,
        DATA_FREE
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?;
    `;

    const [rows] = await this.pool!.query<RowDataPacket[]>(query, [schema || 'public', table]);

    if (rows.length === 0) {
      throw new Error(`Table ${tableName} not found`);
    }

    const stats = rows[0];

    return {
      tableName: table,
      rowCount: stats.TABLE_ROWS,
      sizeBytes: stats.DATA_LENGTH,
      indexSizeBytes: stats.INDEX_LENGTH,
    };
  }

  async explain(query: string, analyze = false): Promise<ExplainPlan> {
    // MySQL's EXPLAIN ANALYZE was added in 8.0.18
    const explainQuery = analyze ? `EXPLAIN ANALYZE ${query}` : `EXPLAIN FORMAT=JSON ${query}`;

    try {
      const [rows] = await this.pool!.query<RowDataPacket[]>(explainQuery);

      if (analyze) {
        // EXPLAIN ANALYZE returns text format
        const raw = rows.map(r => Object.values(r).join(' | ')).join('\n');

        return {
          raw,
          formatted: raw,
          totalCost: 0,
          planRows: 0,
          nodes: [],
          warnings: [],
          recommendations: [],
        };
      }

      // EXPLAIN FORMAT=JSON
      const plan = typeof rows[0].EXPLAIN === 'string'
        ? JSON.parse(rows[0].EXPLAIN)
        : rows[0].EXPLAIN;

      const queryBlock = plan.query_block;

      return {
        raw: JSON.stringify(plan, null, 2),
        formatted: this.formatMySQLExplainPlan(queryBlock),
        totalCost: queryBlock.cost_info?.query_cost || 0,
        planRows: queryBlock.cost_info?.estimated_rows || 0,
        nodes: [],
        warnings: [],
        recommendations: this.generateMySQLRecommendations(queryBlock),
      };
    } catch (error) {
      throw new Error(`EXPLAIN failed: ${(error as Error).message}`);
    }
  }

  private formatMySQLExplainPlan(queryBlock: Record<string, unknown>): string {
    const lines: string[] = [];

    const formatNode = (node: Record<string, unknown>, indent = 0): void => {
      const spaces = '  '.repeat(indent);

      if (node.table) {
        const table = node.table as Record<string, unknown>;
        lines.push(`${spaces}→ Table: ${table.table_name}`);
        lines.push(`${spaces}  Access: ${table.access_type}`);

        if (table.key) {
          lines.push(`${spaces}  Index: ${table.key}`);
        }

        if (table.cost_info) {
          const cost = table.cost_info as Record<string, unknown>;
          lines.push(`${spaces}  Cost: ${cost.read_cost} (${cost.eval_cost} eval)`);
        }
      }

      // Recursively format nested structures
      for (const [key, value] of Object.entries(node)) {
        if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === 'object') {
              formatNode(item as Record<string, unknown>, indent + 1);
            }
          }
        } else if (
          typeof value === 'object' &&
          value !== null &&
          !['cost_info', 'table'].includes(key)
        ) {
          formatNode(value as Record<string, unknown>, indent + 1);
        }
      }
    };

    formatNode(queryBlock);
    return lines.join('\n');
  }

  private generateMySQLRecommendations(queryBlock: Record<string, unknown>): string[] {
    const recommendations: string[] = [];

    const checkNode = (node: Record<string, unknown>): void => {
      if (node.table) {
        const table = node.table as Record<string, unknown>;

        // Check for full table scans
        if (table.access_type === 'ALL') {
          recommendations.push(
            `Full table scan detected on ${table.table_name}. Consider adding an index.`
          );
        }

        // Check for filesort
        if (node.ordering_operation) {
          recommendations.push(
            `Using filesort. Consider adding an index to match the ORDER BY clause.`
          );
        }

        // Check for temporary tables
        if (node.using_temporary_table) {
          recommendations.push(
            'Using temporary table. This may impact performance for large result sets.'
          );
        }
      }

      // Recursively check nested nodes
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === 'object') {
              checkNode(item as Record<string, unknown>);
            }
          }
        } else if (typeof value === 'object' && value !== null) {
          checkNode(value as Record<string, unknown>);
        }
      }
    };

    checkNode(queryBlock);
    return recommendations;
  }

  private mapMySQLType(type: number | undefined): string {
    if (type === undefined) return 'unknown';
    // MySQL type constants from mysql2
    const typeMap: Record<number, string> = {
      0: 'decimal',
      1: 'tiny',
      2: 'short',
      3: 'long',
      4: 'float',
      5: 'double',
      7: 'timestamp',
      8: 'longlong',
      9: 'int24',
      10: 'date',
      11: 'time',
      12: 'datetime',
      13: 'year',
      15: 'varchar',
      16: 'bit',
      245: 'json',
      246: 'decimal',
      247: 'enum',
      248: 'set',
      249: 'tiny_blob',
      250: 'medium_blob',
      251: 'long_blob',
      252: 'blob',
      253: 'var_string',
      254: 'string',
      255: 'geometry',
    };

    return typeMap[type] || 'unknown';
  }
}
