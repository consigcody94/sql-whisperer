/**
 * SQL Whisperer - Natural language to SQL with deep database introspection
 * Main exports for programmatic usage
 */

export * from './types.js';
export { PostgreSQLClient } from './clients/postgresql-client.js';
export { MySQLClient } from './clients/mysql-client.js';
export { SQLiteClient } from './clients/sqlite-client.js';
export { BaseDatabaseClient } from './clients/base-client.js';
export { QueryValidator } from './validators/query-validator.js';
