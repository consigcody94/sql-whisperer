/**
 * PostgreSQL Database Client
 * Implements comprehensive PostgreSQL introspection and query execution
 * with advanced features like MVCC awareness and query optimization
 */

import pkg from 'pg';
const { Pool } = pkg;
import type { Pool as PgPool, QueryResult as PgQueryResult } from 'pg';
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
  ExplainNode,
  TableStatistics,
  ViewSchema,
  SequenceSchema,
  SchemaMetadata,
} from '../types.js';

export class PostgreSQLClient extends BaseDatabaseClient {
  private pool: PgPool | null = null;

  constructor(config: DatabaseConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    const poolConfig = {
      connectionString: this.config.connectionString,
      host: this.config.host,
      port: this.config.port || 5432,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
      min: this.config.poolMin || 2,
      max: this.config.poolMax || 10,
      idleTimeoutMillis: this.config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: this.config.connectionTimeoutMillis || 10000,
    };

    this.pool = new Pool(poolConfig);

    // Test connection
    const client = await this.pool.connect();
    client.release();

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
    const timeout = this.normalizeTimeout(request.options?.timeout);
    const maxRows = this.normalizeMaxRows(request.options?.maxRows);

    try {
      // Set statement timeout for this query
      const client = await this.pool!.connect();

      try {
        await client.query(`SET statement_timeout = ${timeout}`);

        let result: PgQueryResult;

        if (request.params && request.params.length > 0) {
          result = await client.query(request.query, request.params as unknown[]);
        } else {
          result = await client.query(request.query);
        }

        const executionTimeMs = Date.now() - startTime;

        // Limit rows if needed
        const rows = result.rows.slice(0, maxRows);

        const queryResult: QueryResult = {
          rows,
          rowCount: result.rowCount || 0,
          fields: result.fields.map(f => ({
            name: f.name,
            dataType: this.mapPostgreSQLType(f.dataTypeID),
            tableID: f.tableID,
            columnID: f.columnID,
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
      } finally {
        client.release();
      }
    } catch (error) {
      throw new Error(`Query execution failed: ${(error as Error).message}`);
    }
  }

  async introspect(): Promise<DatabaseSchema> {
    this.ensureConnected();
    const startTime = Date.now();

    const [tables, views, sequences, metadata] = await Promise.all([
      this.introspectTables(),
      this.introspectViews(),
      this.introspectSequences(),
      this.getMetadata(),
    ]);

    const introspectionDurationMs = Date.now() - startTime;

    return {
      tables,
      views,
      sequences,
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
        c.table_schema,
        c.table_name,
        obj_description((c.table_schema || '.' || c.table_name)::regclass) as table_comment,
        pg_total_relation_size((c.table_schema || '.' || c.table_name)::regclass) as size_bytes,
        (SELECT count(*) FROM information_schema.tables t
         WHERE t.table_schema = c.table_schema AND t.table_name = c.table_name) as row_count_estimate
      FROM information_schema.tables c
      WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
        AND c.table_type = 'BASE TABLE'
      ORDER BY c.table_schema, c.table_name;
    `;

    const result = await this.pool!.query(query);

    const tables = await Promise.all(
      result.rows.map(async row => {
        const [columns, indexes, foreignKeys] = await Promise.all([
          this.introspectColumns(row.table_schema, row.table_name),
          this.introspectIndexes(row.table_schema, row.table_name),
          this.introspectForeignKeys(row.table_schema, row.table_name),
        ]);

        // Get accurate row count for smaller tables
        let rowCount = row.row_count_estimate;
        if (row.size_bytes < 10000000) { // < 10MB
          try {
            const countResult = await this.pool!.query(
              `SELECT count(*) as count FROM "${row.table_schema}"."${row.table_name}"`
            );
            rowCount = parseInt(countResult.rows[0].count);
          } catch {
            // Use estimate if count fails
          }
        }

        return {
          name: row.table_name,
          schema: row.table_schema,
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
          checkConstraints: [], // TODO: Implement check constraints
          indexes,
          triggers: [], // TODO: Implement triggers
          rowCount,
          sizeBytes: row.size_bytes,
          comment: row.table_comment,
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
        c.column_name,
        c.data_type,
        c.udt_name,
        c.is_nullable,
        c.column_default,
        c.character_maximum_length,
        c.numeric_precision,
        c.numeric_scale,
        c.character_set_name,
        c.collation_name,
        col_description((c.table_schema || '.' || c.table_name)::regclass, c.ordinal_position) as column_comment,
        CASE WHEN c.column_default LIKE 'nextval%' THEN true ELSE false END as is_auto_increment
      FROM information_schema.columns c
      WHERE c.table_schema = $1 AND c.table_name = $2
      ORDER BY c.ordinal_position;
    `;

    const result = await this.pool!.query(query, [schema, table]);

    return result.rows.map(row => ({
      name: row.column_name,
      dataType: row.data_type,
      nativeType: row.udt_name,
      isNullable: row.is_nullable === 'YES',
      defaultValue: row.column_default,
      isAutoIncrement: row.is_auto_increment,
      maxLength: row.character_maximum_length,
      precision: row.numeric_precision,
      scale: row.numeric_scale,
      characterSet: row.character_set_name,
      collation: row.collation_name,
      comment: row.column_comment,
    }));
  }

  private async introspectIndexes(
    schema: string,
    table: string
  ): Promise<IndexSchema[]> {
    const query = `
      SELECT
        i.indexname as index_name,
        i.indexdef as index_definition,
        ix.indisunique as is_unique,
        ix.indisprimary as is_primary,
        am.amname as index_type,
        pg_relation_size((i.schemaname || '.' || i.indexname)::regclass) as size_bytes,
        ARRAY(
          SELECT a.attname
          FROM pg_attribute a
          JOIN pg_index ix2 ON a.attnum = ANY(ix2.indkey)
          WHERE ix2.indexrelid = (i.schemaname || '.' || i.indexname)::regclass
          ORDER BY a.attnum
        ) as column_names
      FROM pg_indexes i
      JOIN pg_class c ON c.relname = i.indexname
      JOIN pg_index ix ON ix.indexrelid = c.oid
      JOIN pg_am am ON am.oid = c.relam
      WHERE i.schemaname = $1 AND i.tablename = $2;
    `;

    const result = await this.pool!.query(query, [schema, table]);

    return result.rows.map(row => ({
      name: row.index_name,
      columns: row.column_names.map((name: string) => ({
        name,
        order: 'ASC' as const,
      })),
      isUnique: row.is_unique,
      isPrimary: row.is_primary,
      type: row.index_type,
      sizeBytes: row.size_bytes,
    }));
  }

  private async introspectForeignKeys(
    schema: string,
    table: string
  ): Promise<ForeignKeyConstraint[]> {
    const query = `
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_schema AS foreign_table_schema,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.update_rule,
        rc.delete_rule
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints AS rc
        ON rc.constraint_name = tc.constraint_name
        AND rc.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2;
    `;

    const result = await this.pool!.query(query, [schema, table]);

    // Group by constraint name
    const fkMap = new Map<string, ForeignKeyConstraint>();

    for (const row of result.rows) {
      if (!fkMap.has(row.constraint_name)) {
        fkMap.set(row.constraint_name, {
          name: row.constraint_name,
          columns: [],
          referencedTable: row.foreign_table_name,
          referencedSchema: row.foreign_table_schema,
          referencedColumns: [],
          onDelete: row.delete_rule,
          onUpdate: row.update_rule,
        });
      }

      const fk = fkMap.get(row.constraint_name)!;
      fk.columns.push(row.column_name);
      fk.referencedColumns.push(row.foreign_column_name);
    }

    return Array.from(fkMap.values());
  }

  private async introspectViews(): Promise<ViewSchema[]> {
    const query = `
      SELECT
        v.table_schema,
        v.table_name,
        v.view_definition
      FROM information_schema.views v
      WHERE v.table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY v.table_schema, v.table_name;
    `;

    const result = await this.pool!.query(query);

    return result.rows.map(row => ({
      name: row.table_name,
      schema: row.table_schema,
      definition: row.view_definition,
      columns: [], // Views share column introspection with tables
    }));
  }

  private async introspectSequences(): Promise<SequenceSchema[]> {
    const query = `
      SELECT
        sequence_schema,
        sequence_name,
        start_value::bigint,
        increment::bigint,
        minimum_value::bigint,
        maximum_value::bigint,
        cycle_option
      FROM information_schema.sequences
      WHERE sequence_schema NOT IN ('pg_catalog', 'information_schema');
    `;

    const result = await this.pool!.query(query);

    return result.rows.map(row => ({
      name: row.sequence_name,
      schema: row.sequence_schema,
      startValue: row.start_value,
      currentValue: row.start_value, // Need to query pg_sequences for current
      increment: row.increment,
      minValue: row.minimum_value,
      maxValue: row.maximum_value,
      cycle: row.cycle_option === 'YES',
    }));
  }

  private async getMetadata(): Promise<SchemaMetadata> {
    const versionResult = await this.pool!.query('SELECT version()');
    const version = versionResult.rows[0].version;

    const charsetResult = await this.pool!.query(
      "SELECT pg_database.datcollate, pg_database.datctype FROM pg_database WHERE datname = current_database()"
    );

    return {
      databaseType: 'postgresql',
      databaseVersion: version,
      serverVersion: version,
      collation: charsetResult.rows[0].datcollate,
      characterSet: charsetResult.rows[0].datctype,
      introspectedAt: new Date(),
      introspectionDurationMs: 0,
    };
  }

  async getTableStatistics(tableName: string): Promise<TableStatistics> {
    const { schema, table } = this.parseTableName(tableName);

    const query = `
      SELECT
        schemaname,
        relname,
        n_tup_ins as tuples_inserted,
        n_tup_upd as tuples_updated,
        n_tup_del as tuples_deleted,
        n_live_tup as live_tuples,
        n_dead_tup as dead_tuples,
        last_vacuum,
        last_autovacuum,
        last_analyze,
        last_autoanalyze,
        vacuum_count,
        autovacuum_count,
        analyze_count,
        autoanalyze_count
      FROM pg_stat_user_tables
      WHERE schemaname = $1 AND relname = $2;
    `;

    const sizeQuery = `
      SELECT
        pg_total_relation_size($1) as total_size,
        pg_indexes_size($1) as index_size
    `;

    const [statsResult, sizeResult] = await Promise.all([
      this.pool!.query(query, [schema, table]),
      this.pool!.query(sizeQuery, [`${schema}.${table}`]),
    ]);

    const stats = statsResult.rows[0];
    const size = sizeResult.rows[0];

    return {
      tableName: table,
      rowCount: stats?.live_tuples || 0,
      sizeBytes: size?.total_size || 0,
      indexSizeBytes: size?.index_size || 0,
      deadTuples: stats?.dead_tuples,
      lastVacuum: stats?.last_vacuum || stats?.last_autovacuum,
      lastAnalyze: stats?.last_analyze || stats?.last_autoanalyze,
      autoVacuumCount: stats?.autovacuum_count,
      tuplesInserted: stats?.tuples_inserted,
      tuplesUpdated: stats?.tuples_updated,
      tuplesDeleted: stats?.tuples_deleted,
    };
  }

  async explain(query: string, analyze = false): Promise<ExplainPlan> {
    const explainQuery = `EXPLAIN (FORMAT JSON${analyze ? ', ANALYZE' : ''}) ${query}`;

    try {
      const result = await this.pool!.query(explainQuery);
      const plan = result.rows[0]['QUERY PLAN'][0];

      return {
        raw: JSON.stringify(plan, null, 2),
        formatted: this.formatExplainPlan(plan),
        totalCost: plan.Plan['Total Cost'],
        planRows: plan.Plan['Plan Rows'],
        actualRows: plan.Plan['Actual Rows'],
        actualTimeMs: plan.Plan['Actual Total Time'],
        nodes: [this.parseExplainNode(plan.Plan)],
        warnings: [],
        recommendations: this.generateRecommendations(plan.Plan),
      };
    } catch (error) {
      throw new Error(`EXPLAIN failed: ${(error as Error).message}`);
    }
  }

  private parseExplainNode(node: Record<string, unknown>): ExplainNode {
    return {
      nodeType: node['Node Type'] as string,
      relationName: node['Relation Name'] as string | undefined,
      alias: node['Alias'] as string | undefined,
      startupCost: node['Startup Cost'] as number,
      totalCost: node['Total Cost'] as number,
      planRows: node['Plan Rows'] as number,
      planWidth: node['Plan Width'] as number,
      actualTimeMs: node['Actual Total Time'] as number | undefined,
      actualRows: node['Actual Rows'] as number | undefined,
      loops: node['Actual Loops'] as number | undefined,
      filter: node['Filter'] as string | undefined,
      joinType: node['Join Type'] as string | undefined,
      indexName: node['Index Name'] as string | undefined,
      indexCondition: node['Index Cond'] as string | undefined,
      children: (node.Plans as Record<string, unknown>[] | undefined)?.map(p =>
        this.parseExplainNode(p)
      ) || [],
    };
  }

  private formatExplainPlan(plan: Record<string, unknown>): string {
    const formatNode = (node: Record<string, unknown>, indent = 0): string => {
      const spaces = '  '.repeat(indent);
      let output = `${spaces}→ ${node['Node Type']}`;

      if (node['Relation Name']) {
        output += ` on ${node['Relation Name']}`;
      }

      output += ` (cost=${node['Startup Cost']}..${node['Total Cost']} rows=${node['Plan Rows']})`;

      if (node['Actual Total Time']) {
        output += ` (actual time=${node['Actual Total Time']}ms rows=${node['Actual Rows']})`;
      }

      output += '\n';

      if (node.Plans) {
        for (const child of node.Plans as Record<string, unknown>[]) {
          output += formatNode(child, indent + 1);
        }
      }

      return output;
    };

    return formatNode(plan.Plan as Record<string, unknown>);
  }

  private generateRecommendations(plan: Record<string, unknown>): string[] {
    const recommendations: string[] = [];

    // Check for sequential scans on large tables
    if (plan['Node Type'] === 'Seq Scan' && (plan['Plan Rows'] as number) > 1000) {
      recommendations.push(
        `Consider adding an index on ${plan['Relation Name']} to avoid sequential scan`
      );
    }

    // Check for nested loops with high row counts
    if (
      plan['Node Type'] === 'Nested Loop' &&
      (plan['Plan Rows'] as number) > 10000
    ) {
      recommendations.push(
        'Nested loop with high row count detected. Consider using a hash join instead.'
      );
    }

    // Recursively check child plans
    if (plan.Plans) {
      for (const child of plan.Plans as Record<string, unknown>[]) {
        recommendations.push(...this.generateRecommendations(child));
      }
    }

    return recommendations;
  }

  private mapPostgreSQLType(oid: number): string {
    // Mapping of PostgreSQL OIDs to type names
    const typeMap: Record<number, string> = {
      16: 'boolean',
      17: 'bytea',
      20: 'bigint',
      21: 'smallint',
      23: 'integer',
      25: 'text',
      700: 'real',
      701: 'double precision',
      1042: 'character',
      1043: 'varchar',
      1082: 'date',
      1083: 'time',
      1114: 'timestamp',
      1184: 'timestamptz',
      2950: 'uuid',
      3802: 'jsonb',
    };

    return typeMap[oid] || 'unknown';
  }
}
