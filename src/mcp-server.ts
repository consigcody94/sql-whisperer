#!/usr/bin/env node

/**
 * SQL Whisperer MCP Server
 * Natural language to SQL with deep database introspection
 */

import { PostgreSQLClient } from './clients/postgresql-client.js';
import { MySQLClient } from './clients/mysql-client.js';
import { SQLiteClient } from './clients/sqlite-client.js';
import { QueryValidator } from './validators/query-validator.js';
import type {
  MCPRequest,
  MCPResponse,
  MCPError,
  MCPTool,
  DatabaseClient,
  DatabaseConfig,
} from './types.js';

class MCPServer {
  private client: DatabaseClient | null = null;

  constructor() {
    this.setupStdio();
  }

  private setupStdio(): void {
    process.stdin.setEncoding('utf8');

    let buffer = '';

    process.stdin.on('data', chunk => {
      buffer += chunk;

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        if (line.trim()) {
          this.handleRequest(line.trim()).catch(error => {
            console.error('Error handling request:', error);
          });
        }
      }
    });

    process.stdin.on('end', () => {
      process.exit(0);
    });
  }

  private async handleRequest(line: string): Promise<void> {
    try {
      const request: MCPRequest = JSON.parse(line);

      let response: MCPResponse;

      switch (request.method) {
        case 'tools/list':
          response = this.listTools(request.id);
          break;

        case 'tools/call':
          response = await this.callTool(request);
          break;

        default:
          response = {
            jsonrpc: '2.0',
            id: request.id,
            error: {
              code: -32601,
              message: `Method not found: ${request.method}`,
            },
          };
      }

      this.sendResponse(response);
    } catch (error) {
      const response: MCPResponse = {
        jsonrpc: '2.0',
        id: 0,
        error: {
          code: -32700,
          message: `Parse error: ${(error as Error).message}`,
        },
      };

      this.sendResponse(response);
    }
  }

  private listTools(id: string | number): MCPResponse {
    const tools: MCPTool[] = [
      {
        name: 'connect_database',
        description:
          'Connect to a database (PostgreSQL, MySQL, or SQLite). Returns connection status and database metadata.',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['postgresql', 'mysql', 'sqlite'],
              description: 'Database type',
            },
            connectionString: {
              type: 'string',
              description: 'Connection string (optional if individual params provided)',
            },
            host: {
              type: 'string',
              description: 'Database host (for PostgreSQL/MySQL)',
            },
            port: {
              type: 'number',
              description: 'Database port (5432 for PostgreSQL, 3306 for MySQL)',
            },
            database: {
              type: 'string',
              description: 'Database name',
            },
            user: {
              type: 'string',
              description: 'Username (for PostgreSQL/MySQL)',
            },
            password: {
              type: 'string',
              description: 'Password (for PostgreSQL/MySQL)',
            },
            filename: {
              type: 'string',
              description: 'SQLite database file path',
            },
            ssl: {
              type: 'boolean',
              description: 'Enable SSL (for PostgreSQL/MySQL)',
            },
          },
          required: ['type'],
        },
      },
      {
        name: 'get_schema',
        description:
          'Get complete database schema including tables, columns, indexes, foreign keys, views, and sequences. Returns comprehensive introspection data.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'describe_table',
        description:
          'Get detailed information about a specific table including all columns, data types, constraints, indexes, and statistics.',
        inputSchema: {
          type: 'object',
          properties: {
            tableName: {
              type: 'string',
              description: 'Table name (can include schema: schema.table)',
            },
          },
          required: ['tableName'],
        },
      },
      {
        name: 'natural_query',
        description:
          'Execute a SQL query from natural language description. The query will be validated for safety before execution.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description:
                'Natural language description of what data you want to retrieve',
            },
            maxRows: {
              type: 'number',
              description: 'Maximum number of rows to return (default: 1000)',
            },
          },
          required: ['prompt'],
        },
      },
      {
        name: 'execute_query',
        description:
          'Execute a raw SQL query. Query will be validated and may require confirmation for mutations.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'SQL query to execute',
            },
            params: {
              type: 'array',
              description: 'Query parameters for parameterized queries',
            },
            maxRows: {
              type: 'number',
              description: 'Maximum number of rows to return',
            },
            timeout: {
              type: 'number',
              description: 'Query timeout in milliseconds',
            },
            explain: {
              type: 'boolean',
              description: 'Include query execution plan',
            },
            analyze: {
              type: 'boolean',
              description: 'Run EXPLAIN ANALYZE (executes query)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'explain_query',
        description:
          'Get the execution plan for a query without executing it. Shows how the database will execute the query.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'SQL query to explain',
            },
            analyze: {
              type: 'boolean',
              description: 'Run EXPLAIN ANALYZE (executes query and shows actual timing)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'optimize_query',
        description:
          'Analyze a query and provide optimization suggestions based on execution plan, indexes, and query structure.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'SQL query to optimize',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'table_statistics',
        description:
          'Get statistics for a table including row count, size, index usage, and performance metrics.',
        inputSchema: {
          type: 'object',
          properties: {
            tableName: {
              type: 'string',
              description: 'Table name',
            },
          },
          required: ['tableName'],
        },
      },
      {
        name: 'validate_query',
        description:
          'Validate a SQL query for safety, correctness, and potential issues without executing it.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'SQL query to validate',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'sample_data',
        description:
          'Get a sample of data from a table to understand its structure and content.',
        inputSchema: {
          type: 'object',
          properties: {
            tableName: {
              type: 'string',
              description: 'Table name',
            },
            limit: {
              type: 'number',
              description: 'Number of rows to return (default: 10)',
            },
          },
          required: ['tableName'],
        },
      },
    ];

    return {
      jsonrpc: '2.0',
      id,
      result: { tools },
    };
  }

  private async callTool(request: MCPRequest): Promise<MCPResponse> {
    try {
      const toolName = request.params?.name;
      const args = request.params?.arguments || {};

      if (!toolName) {
        throw new Error('Tool name is required');
      }

      let result: unknown;

      switch (toolName) {
        case 'connect_database':
          result = await this.connectDatabase(args as unknown as DatabaseConfig);
          break;

        case 'get_schema':
          result = await this.getSchema();
          break;

        case 'describe_table':
          result = await this.describeTable(args.tableName as string);
          break;

        case 'natural_query':
          result = await this.naturalQuery(
            args.prompt as string,
            args.maxRows as number | undefined
          );
          break;

        case 'execute_query':
          result = await this.executeQuery(args);
          break;

        case 'explain_query':
          result = await this.explainQuery(
            args.query as string,
            args.analyze as boolean | undefined
          );
          break;

        case 'optimize_query':
          result = await this.optimizeQuery(args.query as string);
          break;

        case 'table_statistics':
          result = await this.tableStatistics(args.tableName as string);
          break;

        case 'validate_query':
          result = await this.validateQuery(args.query as string);
          break;

        case 'sample_data':
          result = await this.sampleData(
            args.tableName as string,
            args.limit as number | undefined
          );
          break;

        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }

      return {
        jsonrpc: '2.0',
        id: request.id,
        result: { content: [{ type: 'text', text: result as string }] },
      };
    } catch (error) {
      const mcpError: MCPError = {
        code: -32603,
        message: (error as Error).message,
      };

      return {
        jsonrpc: '2.0',
        id: request.id,
        error: mcpError,
      };
    }
  }

  private async connectDatabase(config: DatabaseConfig): Promise<string> {
    try {
      // Disconnect existing client
      if (this.client) {
        await this.client.disconnect();
      }

      // Create new client based on type
      switch (config.type) {
        case 'postgresql':
          this.client = new PostgreSQLClient(config);
          break;

        case 'mysql':
          this.client = new MySQLClient(config);
          break;

        case 'sqlite':
          this.client = new SQLiteClient(config);
          break;

        default:
          throw new Error(`Unsupported database type: ${config.type}`);
      }

      await this.client.connect();

      // Get basic metadata
      const schema = await this.client.introspect();

      return this.formatMarkdown(`
# 🎉 Database Connected Successfully

**Database Type:** ${config.type}
**Version:** ${schema.metadata.databaseVersion}
**Tables:** ${schema.tables.length}
**Views:** ${schema.views?.length || 0}

## Connection Details
- Character Set: ${schema.metadata.characterSet || 'N/A'}
- Collation: ${schema.metadata.collation || 'N/A'}
- Introspection Time: ${schema.metadata.introspectionDurationMs}ms

✅ Ready to execute queries and introspect schema.
      `);
    } catch (error) {
      throw new Error(`Failed to connect: ${(error as Error).message}`);
    }
  }

  private async getSchema(): Promise<string> {
    this.ensureConnected();

    const schema = await this.client!.introspect();

    const sections: string[] = [];

    sections.push('# 📊 Database Schema\n');

    // Tables section
    sections.push('## Tables\n');
    for (const table of schema.tables) {
      sections.push(`### ${table.schema}.${table.name}\n`);
      sections.push(`- **Columns:** ${table.columns.length}`);
      sections.push(`- **Rows:** ${table.rowCount?.toLocaleString() || 'Unknown'}`);
      sections.push(
        `- **Size:** ${this.formatBytes(table.sizeBytes || 0)}`
      );
      sections.push(`- **Indexes:** ${table.indexes.length}`);
      sections.push(`- **Foreign Keys:** ${table.foreignKeys.length}`);

      if (table.comment) {
        sections.push(`- **Comment:** ${table.comment}`);
      }

      sections.push('\n**Columns:**');
      for (const col of table.columns.slice(0, 10)) {
        const nullable = col.isNullable ? '(nullable)' : '(NOT NULL)';
        const autoInc = col.isAutoIncrement ? '🔄 AUTO' : '';
        sections.push(
          `- \`${col.name}\` ${col.dataType} ${nullable} ${autoInc}`
        );
      }

      if (table.columns.length > 10) {
        sections.push(`- ... and ${table.columns.length - 10} more columns`);
      }

      sections.push('');
    }

    // Views section
    if (schema.views && schema.views.length > 0) {
      sections.push('## Views\n');
      for (const view of schema.views) {
        sections.push(`- ${view.schema}.${view.name}`);
      }
      sections.push('');
    }

    // Sequences section
    if (schema.sequences && schema.sequences.length > 0) {
      sections.push('## Sequences\n');
      for (const seq of schema.sequences) {
        sections.push(`- ${seq.schema}.${seq.name} (current: ${seq.currentValue})`);
      }
      sections.push('');
    }

    sections.push(
      `\n---\n*Introspected in ${schema.metadata.introspectionDurationMs}ms*`
    );

    return this.formatMarkdown(sections.join('\n'));
  }

  private async describeTable(tableName: string): Promise<string> {
    this.ensureConnected();

    const schema = await this.client!.introspect();
    const table = schema.tables.find(
      t => t.name === tableName || `${t.schema}.${t.name}` === tableName
    );

    if (!table) {
      throw new Error(`Table not found: ${tableName}`);
    }

    const sections: string[] = [];

    sections.push(`# 📋 Table: ${table.schema}.${table.name}\n`);

    if (table.comment) {
      sections.push(`> ${table.comment}\n`);
    }

    sections.push('## Statistics');
    sections.push(`- **Rows:** ${table.rowCount?.toLocaleString() || 'Unknown'}`);
    sections.push(`- **Size:** ${this.formatBytes(table.sizeBytes || 0)}`);
    sections.push(
      `- **Average Row Size:** ${table.rowCount && table.sizeBytes ? this.formatBytes(Math.floor(table.sizeBytes / table.rowCount)) : 'Unknown'}`
    );
    sections.push('');

    sections.push('## Columns\n');
    sections.push('| Name | Type | Nullable | Default | Extra |');
    sections.push('|------|------|----------|---------|-------|');

    for (const col of table.columns) {
      const nullable = col.isNullable ? '✓' : '✗';
      const defaultValue = col.defaultValue || '-';
      const extra = col.isAutoIncrement ? 'AUTO_INCREMENT' : '';

      sections.push(
        `| \`${col.name}\` | ${col.dataType} | ${nullable} | ${defaultValue} | ${extra} |`
      );
    }

    sections.push('');

    // Primary Key
    if (table.primaryKey) {
      sections.push('## Primary Key');
      sections.push(`- **Name:** ${table.primaryKey.name}`);
      sections.push(`- **Columns:** ${table.primaryKey.columns.join(', ')}`);
      sections.push('');
    }

    // Foreign Keys
    if (table.foreignKeys.length > 0) {
      sections.push('## Foreign Keys\n');
      for (const fk of table.foreignKeys) {
        sections.push(`### ${fk.name}`);
        sections.push(
          `- **Columns:** ${fk.columns.join(', ')} → ${fk.referencedSchema}.${fk.referencedTable}(${fk.referencedColumns.join(', ')})`
        );
        sections.push(`- **On Delete:** ${fk.onDelete}`);
        sections.push(`- **On Update:** ${fk.onUpdate}`);
        sections.push('');
      }
    }

    // Indexes
    if (table.indexes.length > 0) {
      sections.push('## Indexes\n');
      sections.push('| Name | Columns | Type | Unique |');
      sections.push('|------|---------|------|--------|');

      for (const idx of table.indexes) {
        const columns = idx.columns.map(c => `${c.name} ${c.order}`).join(', ');
        const unique = idx.isUnique ? '✓' : '✗';

        sections.push(`| ${idx.name} | ${columns} | ${idx.type} | ${unique} |`);
      }

      sections.push('');
    }

    return this.formatMarkdown(sections.join('\n'));
  }

  private async naturalQuery(prompt: string, maxRows?: number): Promise<string> {
    // Note: This is a simplified version. In production, you would use
    // the schema context to generate SQL from natural language.
    // For now, we'll return a helpful message.

    return this.formatMarkdown(`
# 🤖 Natural Language Query

**Prompt:** "${prompt}"

⚠️ Natural language to SQL translation requires the schema context to generate accurate queries.

**Recommended approach:**
1. First, use \`get_schema\` to understand the database structure
2. Then use \`execute_query\` with the generated SQL

**Example:**
\`\`\`sql
SELECT * FROM users WHERE created_at > NOW() - INTERVAL '7 days' LIMIT ${maxRows || 1000};
\`\`\`

💡 For complex natural language queries, the system would analyze your prompt against the schema and generate appropriate SQL with proper joins, filters, and aggregations.
    `);
  }

  private async executeQuery(args: Record<string, unknown>): Promise<string> {
    this.ensureConnected();

    const query = args.query as string;
    const params = (args.params as unknown[]) || [];
    const maxRows = args.maxRows as number | undefined;
    const timeout = args.timeout as number | undefined;
    const explain = args.explain as boolean | undefined;
    const analyze = args.analyze as boolean | undefined;

    // Validate query first
    const validation = QueryValidator.validate(query);

    if (!validation.isValid) {
      const errorMessages = validation.errors.map(e => `- ${e.message}`).join('\n');
      return this.formatMarkdown(`
# ❌ Query Validation Failed

**Errors:**
${errorMessages}

Please fix these errors before executing the query.
      `);
    }

    // Show warnings
    const warnings =
      validation.warnings.length > 0
        ? '\n**⚠️ Warnings:**\n' +
          validation.warnings.map(w => `- ${w.message}`).join('\n') +
          '\n'
        : '';

    // Execute query
    const result = await this.client!.query({
      query,
      params,
      options: { maxRows, timeout, explain, analyze },
    });

    const sections: string[] = [];

    sections.push('# ✅ Query Executed Successfully\n');

    if (warnings) {
      sections.push(warnings);
    }

    sections.push(`**Query Type:** ${validation.metadata.queryType}`);
    sections.push(`**Execution Time:** ${result.executionTimeMs}ms`);
    sections.push(`**Rows Returned:** ${result.rowCount}`);
    sections.push('');

    // Show results
    if (result.rows.length > 0) {
      sections.push('## Results\n');

      // Format as markdown table
      const headers = result.fields.map(f => f.name);
      sections.push(`| ${headers.join(' | ')} |`);
      sections.push(`| ${headers.map(() => '---').join(' | ')} |`);

      for (const row of result.rows.slice(0, 20)) {
        const values = headers.map(h => {
          const value = row[h];
          if (value === null) return 'NULL';
          if (typeof value === 'object') return JSON.stringify(value);
          return String(value);
        });
        sections.push(`| ${values.join(' | ')} |`);
      }

      if (result.rows.length > 20) {
        sections.push(`\n*...and ${result.rows.length - 20} more rows*`);
      }
    }

    // Show explain plan if requested
    if (result.explainPlan) {
      sections.push('\n## 📊 Query Execution Plan\n');
      sections.push('```');
      sections.push(result.explainPlan.formatted);
      sections.push('```');

      if (result.explainPlan.recommendations.length > 0) {
        sections.push('\n**Recommendations:**');
        for (const rec of result.explainPlan.recommendations) {
          sections.push(`- ${rec}`);
        }
      }
    }

    return this.formatMarkdown(sections.join('\n'));
  }

  private async explainQuery(query: string, analyze?: boolean): Promise<string> {
    this.ensureConnected();

    const plan = await this.client!.explain(query, analyze);

    const sections: string[] = [];

    sections.push('# 📊 Query Execution Plan\n');

    sections.push('## Plan Details');
    sections.push(`- **Total Cost:** ${plan.totalCost.toFixed(2)}`);
    sections.push(`- **Estimated Rows:** ${plan.planRows}`);

    if (plan.actualRows !== undefined) {
      sections.push(`- **Actual Rows:** ${plan.actualRows}`);
    }

    if (plan.actualTimeMs !== undefined) {
      sections.push(`- **Actual Time:** ${plan.actualTimeMs.toFixed(2)}ms`);
    }

    sections.push('\n## Plan Tree\n');
    sections.push('```');
    sections.push(plan.formatted);
    sections.push('```');

    if (plan.recommendations.length > 0) {
      sections.push('\n## 💡 Optimization Recommendations\n');
      for (const rec of plan.recommendations) {
        sections.push(`- ${rec}`);
      }
    }

    return this.formatMarkdown(sections.join('\n'));
  }

  private async optimizeQuery(query: string): Promise<string> {
    this.ensureConnected();

    // Validate query
    const validation = QueryValidator.validate(query);

    // Get explain plan
    const plan = await this.client!.explain(query, false);

    const sections: string[] = [];

    sections.push('# 🔧 Query Optimization Analysis\n');

    // Validation warnings
    if (validation.warnings.length > 0) {
      sections.push('## ⚠️ Query Issues\n');
      for (const warning of validation.warnings) {
        sections.push(`### ${warning.code}`);
        sections.push(`- **Issue:** ${warning.message}`);
        sections.push(`- **Suggestion:** ${warning.suggestion}`);
        sections.push('');
      }
    }

    // Execution plan recommendations
    if (plan.recommendations.length > 0) {
      sections.push('## 📊 Execution Plan Recommendations\n');
      for (const rec of plan.recommendations) {
        sections.push(`- ${rec}`);
      }
      sections.push('');
    }

    // General optimization tips
    sections.push('## 💡 General Optimization Tips\n');
    sections.push('1. **Indexes:** Ensure appropriate indexes exist for WHERE, JOIN, and ORDER BY clauses');
    sections.push('2. **Select Columns:** Avoid SELECT *, specify only needed columns');
    sections.push('3. **LIMIT:** Add LIMIT clause to restrict result set size');
    sections.push('4. **JOINs:** Prefer INNER JOIN over OUTER JOIN when possible');
    sections.push('5. **Subqueries:** Consider using JOINs instead of correlated subqueries');
    sections.push('6. **Functions:** Avoid using functions on indexed columns in WHERE clauses');

    sections.push('\n## Query Complexity');
    sections.push(`- **Complexity:** ${validation.metadata.estimatedComplexity}`);
    sections.push(`- **Cost:** ${plan.totalCost.toFixed(2)}`);

    return this.formatMarkdown(sections.join('\n'));
  }

  private async tableStatistics(tableName: string): Promise<string> {
    this.ensureConnected();

    const stats = await this.client!.getTableStatistics(tableName);

    const sections: string[] = [];

    sections.push(`# 📈 Table Statistics: ${stats.tableName}\n`);

    sections.push('## Size & Rows');
    sections.push(`- **Row Count:** ${stats.rowCount.toLocaleString()}`);
    sections.push(`- **Table Size:** ${this.formatBytes(stats.sizeBytes)}`);
    sections.push(`- **Index Size:** ${this.formatBytes(stats.indexSizeBytes)}`);
    sections.push(
      `- **Total Size:** ${this.formatBytes(stats.sizeBytes + stats.indexSizeBytes)}`
    );

    if (stats.rowCount > 0) {
      sections.push(
        `- **Avg Row Size:** ${this.formatBytes(Math.floor(stats.sizeBytes / stats.rowCount))}`
      );
    }

    // PostgreSQL-specific stats
    if (stats.deadTuples !== undefined) {
      sections.push('\n## PostgreSQL Statistics');
      sections.push(`- **Dead Tuples:** ${stats.deadTuples.toLocaleString()}`);

      if (stats.lastVacuum) {
        sections.push(`- **Last Vacuum:** ${stats.lastVacuum}`);
      }

      if (stats.lastAnalyze) {
        sections.push(`- **Last Analyze:** ${stats.lastAnalyze}`);
      }

      if (stats.tuplesInserted !== undefined) {
        sections.push(`- **Inserts:** ${stats.tuplesInserted.toLocaleString()}`);
        sections.push(`- **Updates:** ${stats.tuplesUpdated?.toLocaleString() || 0}`);
        sections.push(`- **Deletes:** ${stats.tuplesDeleted?.toLocaleString() || 0}`);
      }
    }

    return this.formatMarkdown(sections.join('\n'));
  }

  private async validateQuery(query: string): Promise<string> {
    const validation = QueryValidator.validate(query);

    const sections: string[] = [];

    if (validation.isValid) {
      sections.push('# ✅ Query Validation Passed\n');
    } else {
      sections.push('# ❌ Query Validation Failed\n');
    }

    // Metadata
    sections.push('## Query Metadata');
    sections.push(`- **Type:** ${validation.metadata.queryType}`);
    sections.push(`- **Is Mutation:** ${validation.metadata.isMutation ? 'Yes' : 'No'}`);
    sections.push(`- **Complexity:** ${validation.metadata.estimatedComplexity}`);
    sections.push(
      `- **Requires Confirmation:** ${validation.metadata.requiresConfirmation ? 'Yes' : 'No'}`
    );

    if (validation.metadata.tablesAccessed.length > 0) {
      sections.push(`- **Tables:** ${validation.metadata.tablesAccessed.join(', ')}`);
    }

    // Errors
    if (validation.errors.length > 0) {
      sections.push('\n## ❌ Errors\n');
      for (const error of validation.errors) {
        sections.push(`### ${error.code}`);
        sections.push(`- **Severity:** ${error.severity}`);
        sections.push(`- **Message:** ${error.message}`);
        if (error.suggestion) {
          sections.push(`- **Suggestion:** ${error.suggestion}`);
        }
        sections.push('');
      }
    }

    // Warnings
    if (validation.warnings.length > 0) {
      sections.push('\n## ⚠️ Warnings\n');
      for (const warning of validation.warnings) {
        sections.push(`### ${warning.code}`);
        sections.push(`- **Severity:** ${warning.severity}`);
        sections.push(`- **Message:** ${warning.message}`);
        if (warning.suggestion) {
          sections.push(`- **Suggestion:** ${warning.suggestion}`);
        }
        sections.push('');
      }
    }

    return this.formatMarkdown(sections.join('\n'));
  }

  private async sampleData(tableName: string, limit = 10): Promise<string> {
    this.ensureConnected();

    const query = `SELECT * FROM ${tableName} LIMIT ${limit}`;
    const result = await this.client!.query({ query });

    const sections: string[] = [];

    sections.push(`# 🔍 Sample Data: ${tableName}\n`);
    sections.push(`Showing ${result.rowCount} of ${result.rowCount} rows\n`);

    if (result.rows.length > 0) {
      // Format as markdown table
      const headers = result.fields.map(f => f.name);
      sections.push(`| ${headers.join(' | ')} |`);
      sections.push(`| ${headers.map(() => '---').join(' | ')} |`);

      for (const row of result.rows) {
        const values = headers.map(h => {
          const value = row[h];
          if (value === null) return 'NULL';
          if (typeof value === 'object') return JSON.stringify(value);
          return String(value);
        });
        sections.push(`| ${values.join(' | ')} |`);
      }
    } else {
      sections.push('*No data found in this table*');
    }

    return this.formatMarkdown(sections.join('\n'));
  }

  private ensureConnected(): void {
    if (!this.client || !this.client.isConnected()) {
      throw new Error(
        'Not connected to database. Use connect_database tool first.'
      );
    }
  }

  private formatMarkdown(content: string): string {
    return content.trim();
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }

  private sendResponse(response: MCPResponse): void {
    console.log(JSON.stringify(response));
  }
}

// Start the server
new MCPServer();
