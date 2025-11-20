/**
 * Query Validator
 * Provides comprehensive SQL query validation and safety checks
 */

import type {
  ValidationResult,
  ValidationError,
  ValidationWarning,
  QueryMetadata,
} from '../types.js';

export class QueryValidator {
  /**
   * Validates a SQL query for safety and correctness
   */
  static validate(query: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    const normalizedQuery = query.trim().toUpperCase();

    // Detect query type
    const queryType = this.detectQueryType(query);
    const isMutation = this.isMutationQuery(queryType);

    // Check for dangerous operations
    const dangerousOps = this.detectDangerousOperations(normalizedQuery);
    if (dangerousOps.length > 0) {
      for (const op of dangerousOps) {
        errors.push({
          code: 'DANGEROUS_OPERATION',
          message: `Dangerous operation detected: ${op}`,
          severity: 'critical',
          suggestion: 'Review this operation carefully before executing.',
        });
      }
    }

    // Check for SQL injection patterns
    const injectionWarnings = this.detectInjectionPatterns(query);
    warnings.push(...injectionWarnings);

    // Check for mutations without WHERE clause
    if (isMutation && !normalizedQuery.includes('WHERE')) {
      if (queryType === 'DELETE') {
        errors.push({
          code: 'DELETE_WITHOUT_WHERE',
          message: 'DELETE statement without WHERE clause will remove all rows',
          severity: 'critical',
          suggestion: 'Add a WHERE clause to limit the deletion scope.',
        });
      } else if (queryType === 'UPDATE') {
        warnings.push({
          code: 'UPDATE_WITHOUT_WHERE',
          message: 'UPDATE statement without WHERE clause will modify all rows',
          severity: 'warning',
          suggestion: 'Add a WHERE clause to limit the update scope.',
        });
      }
    }

    // Check for SELECT *
    if (normalizedQuery.includes('SELECT *')) {
      warnings.push({
        code: 'SELECT_STAR',
        message: 'Using SELECT * may retrieve unnecessary columns',
        severity: 'info',
        suggestion: 'Specify only the columns you need for better performance.',
      });
    }

    // Check for missing LIMIT on SELECT
    if (queryType === 'SELECT' && !normalizedQuery.includes('LIMIT')) {
      warnings.push({
        code: 'MISSING_LIMIT',
        message: 'SELECT query without LIMIT may return large result sets',
        severity: 'info',
        suggestion: 'Consider adding LIMIT clause to control result size.',
      });
    }

    // Check for cartesian products (multiple tables without JOIN)
    if (this.hasCartesianProduct(normalizedQuery)) {
      warnings.push({
        code: 'CARTESIAN_PRODUCT',
        message: 'Query may produce cartesian product',
        severity: 'warning',
        suggestion: 'Ensure proper JOIN conditions between tables.',
      });
    }

    // Check for expensive operations
    const expensiveOps = this.detectExpensiveOperations(normalizedQuery);
    for (const op of expensiveOps) {
      warnings.push({
        code: 'EXPENSIVE_OPERATION',
        message: `Potentially expensive operation detected: ${op}`,
        severity: 'warning',
        suggestion: 'This operation may impact performance on large tables.',
      });
    }

    // Extract tables accessed
    const tablesAccessed = this.extractTableNames(query);

    // Estimate complexity
    const estimatedComplexity = this.estimateComplexity(normalizedQuery);

    // Determine if confirmation is required
    const requiresConfirmation =
      isMutation || dangerousOps.length > 0 || errors.length > 0;

    const metadata: QueryMetadata = {
      queryType,
      isMutation,
      tablesAccessed,
      estimatedComplexity,
      requiresConfirmation,
    };

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      metadata,
    };
  }

  /**
   * Detects the type of SQL query
   */
  private static detectQueryType(query: string): QueryMetadata['queryType'] {
    const normalized = query.trim().toUpperCase();

    if (normalized.startsWith('SELECT')) return 'SELECT';
    if (normalized.startsWith('INSERT')) return 'INSERT';
    if (normalized.startsWith('UPDATE')) return 'UPDATE';
    if (normalized.startsWith('DELETE')) return 'DELETE';
    if (
      normalized.startsWith('CREATE') ||
      normalized.startsWith('ALTER') ||
      normalized.startsWith('DROP') ||
      normalized.startsWith('TRUNCATE')
    ) {
      return 'DDL';
    }
    if (
      normalized.startsWith('BEGIN') ||
      normalized.startsWith('COMMIT') ||
      normalized.startsWith('ROLLBACK')
    ) {
      return 'TRANSACTION';
    }

    return 'OTHER';
  }

  /**
   * Checks if query is a mutation
   */
  private static isMutationQuery(queryType: QueryMetadata['queryType']): boolean {
    return ['INSERT', 'UPDATE', 'DELETE', 'DDL'].includes(queryType);
  }

  /**
   * Detects dangerous operations
   */
  private static detectDangerousOperations(query: string): string[] {
    const dangerous: string[] = [];

    const dangerousPatterns = [
      { pattern: /\bDROP\s+TABLE\b/i, name: 'DROP TABLE' },
      { pattern: /\bDROP\s+DATABASE\b/i, name: 'DROP DATABASE' },
      { pattern: /\bTRUNCATE\b/i, name: 'TRUNCATE' },
      { pattern: /\bDELETE\s+FROM\s+\w+\s*;?\s*$/i, name: 'DELETE ALL ROWS' },
      { pattern: /\bALTER\s+TABLE\b/i, name: 'ALTER TABLE' },
      { pattern: /\bDROP\s+COLUMN\b/i, name: 'DROP COLUMN' },
      { pattern: /\bEXEC\b|\bEXECUTE\b/i, name: 'EXECUTE' },
      { pattern: /;\s*DROP\b/i, name: 'SQL INJECTION (DROP)' },
      { pattern: /;\s*DELETE\b/i, name: 'SQL INJECTION (DELETE)' },
    ];

    for (const { pattern, name } of dangerousPatterns) {
      if (pattern.test(query)) {
        dangerous.push(name);
      }
    }

    return dangerous;
  }

  /**
   * Detects potential SQL injection patterns
   */
  private static detectInjectionPatterns(query: string): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];

    const injectionPatterns = [
      { pattern: /'\s*OR\s+'?\d+'?\s*=\s*'?\d+'?/i, message: 'OR 1=1 pattern detected' },
      { pattern: /'\s*OR\s+'?[a-z]+'?\s*=\s*'?[a-z]+'?/i, message: "OR 'x'='x' pattern detected" },
      { pattern: /'\s*;.*--/i, message: 'SQL comment injection pattern detected' },
      { pattern: /UNION\s+SELECT/i, message: 'UNION SELECT pattern detected' },
      { pattern: /'\s*\)\s*OR\s*\(/i, message: 'Parentheses OR pattern detected' },
    ];

    for (const { pattern, message } of injectionPatterns) {
      if (pattern.test(query)) {
        warnings.push({
          code: 'POTENTIAL_INJECTION',
          message,
          severity: 'warning',
          suggestion: 'Use parameterized queries to prevent SQL injection.',
        });
      }
    }

    return warnings;
  }

  /**
   * Detects cartesian product patterns
   */
  private static hasCartesianProduct(query: string): boolean {
    // Look for multiple tables in FROM clause without JOIN keyword
    const fromMatch = query.match(/FROM\s+([\w,\s]+)(?:WHERE|GROUP|ORDER|LIMIT|$)/i);

    if (!fromMatch) return false;

    const tables = fromMatch[1].split(',').map(t => t.trim());

    // Multiple tables without JOIN keyword
    if (tables.length > 1 && !query.includes('JOIN')) {
      return true;
    }

    return false;
  }

  /**
   * Detects expensive operations
   */
  private static detectExpensiveOperations(query: string): string[] {
    const expensive: string[] = [];

    const expensivePatterns = [
      { pattern: /\bLIKE\s+'%.*%'/i, name: 'LIKE with leading wildcard' },
      { pattern: /\bNOT\s+IN\s*\(/i, name: 'NOT IN subquery' },
      { pattern: /\bOR\b/gi, name: 'Multiple OR conditions', minMatches: 3 },
      { pattern: /\bUNION\b/i, name: 'UNION operation' },
      { pattern: /\bDISTINCT\b/i, name: 'DISTINCT operation' },
      {
        pattern: /\b(?:SUBSTRING|LOWER|UPPER|CONCAT)\s*\(/gi,
        name: 'Function on column',
        minMatches: 2,
      },
    ];

    for (const { pattern, name, minMatches } of expensivePatterns) {
      const matches = query.match(pattern);
      if (matches && (!minMatches || matches.length >= minMatches)) {
        expensive.push(name);
      }
    }

    return expensive;
  }

  /**
   * Extracts table names from query
   */
  private static extractTableNames(query: string): string[] {
    const tables = new Set<string>();

    // FROM clause
    const fromMatches = query.matchAll(/FROM\s+([\w.]+)/gi);
    for (const match of fromMatches) {
      tables.add(match[1]);
    }

    // JOIN clauses
    const joinMatches = query.matchAll(/JOIN\s+([\w.]+)/gi);
    for (const match of joinMatches) {
      tables.add(match[1]);
    }

    // INSERT INTO
    const insertMatches = query.matchAll(/INSERT\s+INTO\s+([\w.]+)/gi);
    for (const match of insertMatches) {
      tables.add(match[1]);
    }

    // UPDATE
    const updateMatches = query.matchAll(/UPDATE\s+([\w.]+)/gi);
    for (const match of updateMatches) {
      tables.add(match[1]);
    }

    // DELETE FROM
    const deleteMatches = query.matchAll(/DELETE\s+FROM\s+([\w.]+)/gi);
    for (const match of deleteMatches) {
      tables.add(match[1]);
    }

    return Array.from(tables);
  }

  /**
   * Estimates query complexity
   */
  private static estimateComplexity(
    query: string
  ): 'low' | 'medium' | 'high' {
    let score = 0;

    // Count complexity indicators
    const indicators = [
      { pattern: /\bJOIN\b/gi, weight: 2 },
      { pattern: /\bSUBSELECT\b|\(\s*SELECT/gi, weight: 3 },
      { pattern: /\bUNION\b/gi, weight: 2 },
      { pattern: /\bGROUP BY\b/gi, weight: 1 },
      { pattern: /\bHAVING\b/gi, weight: 1 },
      { pattern: /\bORDER BY\b/gi, weight: 1 },
      { pattern: /\bDISTINCT\b/gi, weight: 1 },
      { pattern: /\bWINDOW\b/gi, weight: 3 },
      { pattern: /\bCTE\b|\bWITH\s+\w+\s+AS/gi, weight: 2 },
    ];

    for (const { pattern, weight } of indicators) {
      const matches = query.match(pattern);
      if (matches) {
        score += matches.length * weight;
      }
    }

    if (score <= 2) return 'low';
    if (score <= 6) return 'medium';
    return 'high';
  }
}
