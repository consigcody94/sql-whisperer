# SQL Whisperer

**Natural language to SQL with deep database introspection - A Model Context Protocol (MCP) server for PostgreSQL, MySQL, and SQLite**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-16%2B-green.svg)](https://nodejs.org/)

SQL Whisperer is a production-grade MCP server that provides comprehensive database introspection, query optimization analysis, and natural language query capabilities. Built with deep understanding of database internals, query planners, and MVCC semantics.

---

## Table of Contents

- [Why SQL Whisperer?](#why-sql-whisperer)
- [Technical Architecture](#technical-architecture)
- [Database Engine Internals](#database-engine-internals)
  - [PostgreSQL: MVCC & Query Planner](#postgresql-mvcc--query-planner)
  - [MySQL/InnoDB: Storage Engine Optimization](#mysqlinnodb-storage-engine-optimization)
  - [SQLite: Lightweight Architecture](#sqlite-lightweight-architecture)
- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
- [MCP Tools](#mcp-tools)
- [Query Optimization Deep Dive](#query-optimization-deep-dive)
  - [Index Selection Strategies](#index-selection-strategies)
  - [Execution Plan Analysis](#execution-plan-analysis)
  - [Cost-Based Optimizer Insights](#cost-based-optimizer-insights)
- [Schema Introspection](#schema-introspection)
- [Safety & Validation](#safety--validation)
- [Performance Considerations](#performance-considerations)
- [Advanced Usage](#advanced-usage)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

---

## Why SQL Whisperer?

Modern applications interact with databases through ORMs that abstract away the underlying SQL. While convenient, this abstraction often results in:

1. **Suboptimal query patterns** - N+1 queries, missing indexes, inefficient joins
2. **Poor schema visibility** - Developers unaware of constraints, indexes, and relationships
3. **Limited optimization insight** - No understanding of query planner decisions or execution costs
4. **Barrier to entry** - Non-technical users cannot explore data without engineering support

SQL Whisperer bridges this gap by providing:

- **Deep schema introspection** with foreign key relationships, index coverage, and constraint analysis
- **Query plan visualization** showing exactly how the database executes your queries
- **Intelligent validation** detecting dangerous operations, injection patterns, and performance anti-patterns
- **Natural language interface** for data exploration (via Claude Code and MCP)

---

## Technical Architecture

### Multi-Database Abstraction Layer

SQL Whisperer implements a unified client interface across three database engines, each with dramatically different architectures:

```
┌─────────────────┐
│   MCP Server    │
│  (JSON-RPC 2.0) │
└────────┬────────┘
         │
    ┌────▼────┐
    │ Abstract│
    │  Client │
    └────┬────┘
         │
    ┌────┴──────────┬──────────┐
    │               │          │
┌───▼──────┐  ┌────▼─────┐  ┌─▼────────┐
│PostgreSQL│  │  MySQL   │  │ SQLite   │
│  Client  │  │  Client  │  │  Client  │
└──────────┘  └──────────┘  └──────────┘
```

Each client implements:
- **Connection pooling** with configurable min/max connections, idle timeouts
- **Query execution** with timeout enforcement, row limits, and parameterized queries
- **Schema introspection** extracting tables, columns, indexes, constraints, and statistics
- **EXPLAIN plan parsing** with database-specific optimizations and recommendations

### Connection Pool Management

Connection pools are critical for OLTP workloads. SQL Whisperer implements:

**PostgreSQL**: Uses `pg.Pool` with:
- Min/max connection limits (default: 2-10)
- Idle timeout (30s) to release unused connections
- Connection timeout (10s) for acquisition
- Statement-level timeout enforcement via `SET statement_timeout`

**MySQL**: Uses `mysql2.createPool` with:
- `waitForConnections: true` - queue requests when pool exhausted
- `queueLimit: 0` - unlimited queue (relies on connection timeout)
- `keepAliveInitialDelay: 0` - immediate keepalive to prevent connection drops
- Session-level timeout via `SET SESSION MAX_EXECUTION_TIME`

**SQLite**: Single-connection architecture with:
- WAL mode (`journal_mode = WAL`) for better concurrency via MVCC-like semantics
- `synchronous = NORMAL` - fsync only at critical points (2x faster than FULL)
- 64MB page cache (`cache_size = -64000`) for hot data
- In-memory temp storage (`temp_store = MEMORY`)

---

## Database Engine Internals

### PostgreSQL: MVCC & Query Planner

#### Multi-Version Concurrency Control (MVCC)

PostgreSQL uses MVCC to provide transaction isolation without read locks. Each row version contains:

- `xmin`: Transaction ID that inserted this version
- `xmax`: Transaction ID that deleted/updated this version (0 if current)
- Tuple visibility determined by snapshot isolation level

**Implications for SQL Whisperer:**

1. **Dead tuples** accumulate until `VACUUM` reclaims space
2. **Bloat** occurs when `autovacuum` can't keep up with update rate
3. **Table statistics** (via `pg_stat_user_tables`) track:
   - `n_live_tup`, `n_dead_tup` - current bloat level
   - `last_vacuum`, `last_autovacuum` - maintenance cadence
   - `n_tup_ins`, `n_tup_upd`, `n_tup_del` - write workload patterns

SQL Whisperer exposes these metrics via `table_statistics` tool to identify:
- Tables with >20% dead tuple ratio (need VACUUM)
- Tables never analyzed (missing statistics for query planner)
- High update rates causing index bloat

#### Query Planner Cost Model

PostgreSQL's planner estimates costs using:

```
total_cost = startup_cost + (cpu_cost_per_tuple * rows) + (disk_cost_per_page * pages)
```

Key parameters (from `pg_settings`):
- `seq_page_cost = 1.0` - Sequential disk read cost
- `random_page_cost = 4.0` - Random disk read cost (HDD)
- `cpu_tuple_cost = 0.01` - CPU cost per row processed
- `cpu_index_tuple_cost = 0.005` - CPU cost per index entry

**Index selection logic:**

1. **Bitmap Index Scan** when selectivity is 1-15% (uses bitmap heap scan)
2. **Index Scan** when selectivity is <1% (follows index order)
3. **Sequential Scan** when selectivity is >15% or index missing

SQL Whisperer parses `EXPLAIN (FORMAT JSON, ANALYZE)` to show:
- Actual vs estimated row counts (planner accuracy)
- Index usage vs sequential scans
- Join strategies (Nested Loop, Hash Join, Merge Join)
- Sort operations and temp table usage

Example EXPLAIN output parsing:
```typescript
{
  "Node Type": "Hash Join",
  "Join Type": "Inner",
  "Startup Cost": 15.25,
  "Total Cost": 3125.50,
  "Plan Rows": 1000,
  "Actual Rows": 983,  // Off by 1.7% - good estimate
  "Actual Total Time": 45.23  // ms
}
```

**Recommendations generated:**
- Sequential scans on large tables → "Add index on column X"
- Nested loop with high row count → "Use hash join instead (set enable_nestloop = off to test)"
- High actual vs estimated rows → "Run ANALYZE to update statistics"

### MySQL/InnoDB: Storage Engine Optimization

#### InnoDB Clustered Index Architecture

Unlike PostgreSQL's heap storage, InnoDB uses a **clustered index** where:
- Primary key defines physical row order
- Secondary indexes store (indexed columns, primary key) pairs
- All lookups require primary key lookup as final step

**Performance implications:**

1. **Primary key choice matters:**
   - Sequential UUID → 16 bytes, random writes, page splits
   - Auto-increment INT → 4 bytes, sequential writes, no splits
   - Composite PK → Bloated secondary indexes (PK copied to each)

2. **Secondary index penalty:**
   - Each secondary index lookup requires primary key lookup
   - `EXPLAIN` shows "Using index" when covering index avoids this

3. **Buffer pool pressure:**
   - InnoDB caches pages in buffer pool (default: 128MB)
   - Random primary keys fragment data across pages
   - Sequential keys keep hot data dense

SQL Whisperer introspection shows:
- Primary key column types and sizes
- Secondary index count (each adds write overhead)
- Index selectivity (cardinality / total rows)

#### Query Cache and Optimizer Hints

MySQL 5.7- had a query cache (removed in 8.0 due to scalability issues):
- Invalidated on ANY write to referenced tables
- Caused massive mutex contention under write load
- SQL Whisperer detects MySQL version and warns if query cache enabled

**MySQL 8.0+ optimizer hints:**
```sql
SELECT /*+ INDEX(users idx_email) */ * FROM users WHERE email = ?;
SELECT /*+ JOIN_ORDER(orders, users) */ ...
SELECT /*+ HASH_JOIN(orders, users) */ ...
```

SQL Whisperer's `optimize_query` tool recommends hints when:
- Wrong index selected by optimizer
- Suboptimal join order detected
- Better join algorithm available

#### EXPLAIN FORMAT=JSON Parsing

MySQL's EXPLAIN output differs significantly from PostgreSQL:

```json
{
  "query_block": {
    "select_id": 1,
    "cost_info": {
      "query_cost": "125.50",
      "read_cost": "100.00",
      "eval_cost": "25.50"
    },
    "table": {
      "table_name": "users",
      "access_type": "ALL",  // Full table scan
      "possible_keys": ["idx_email"],
      "key": null,  // No index used
      "rows_examined_per_scan": 10000,
      "filtered": "10.00",  // 10% of rows match WHERE
      "cost_info": {
        "read_cost": "100.00",
        "eval_cost": "25.50",
        "prefix_cost": "125.50"
      }
    }
  }
}
```

**Access types from worst to best:**
1. `ALL` - Full table scan
2. `index` - Full index scan
3. `range` - Index range scan (using >, <, BETWEEN)
4. `ref` - Index lookup on non-unique key
5. `eq_ref` - Index lookup on unique key (best for joins)
6. `const` - Single row by primary key

SQL Whisperer flags:
- `access_type: "ALL"` with large `rows_examined_per_scan`
- `filtered < 50%` - poor index selectivity
- `using_temporary_table: true` - needs temp space for GROUP BY/ORDER BY
- `using_filesort: true` - sorting without index support

### SQLite: Lightweight Architecture

#### B-tree Storage Model

SQLite stores everything as B-trees:
- Tables → B-tree with rowid as key (or PRIMARY KEY if INTEGER)
- Indexes → B-tree with (indexed columns, rowid) as entries
- Database file = collection of fixed-size pages (default: 4KB)

**Implications:**

1. **Page-level locking** (until SQLite 3.7 added WAL mode)
   - Write lock blocks all readers in rollback journal mode
   - WAL mode allows concurrent readers during writes

2. **No statistics** for query planner before 3.7.15
   - Modern SQLite uses `sqlite_stat1` table after `ANALYZE`
   - Without stats, planner assumes all tables have ~1M rows

3. **No parallel query execution**
   - Single-threaded query processing
   - Connection pool doesn't improve read performance
   - Only benefits: connection reuse, avoiding open/close overhead

#### EXPLAIN QUERY PLAN Output

SQLite's planner output is simple:

```
SCAN TABLE users
SEARCH TABLE orders USING INDEX idx_user_id (user_id=?)
USE TEMP B-TREE FOR ORDER BY
```

**Key patterns:**

- `SCAN TABLE` - Sequential scan (usually bad)
- `SEARCH TABLE ... USING INDEX` - Index scan (good)
- `USING COVERING INDEX` - Index-only scan (excellent)
- `USE TEMP B-TREE FOR ORDER BY` - Sort without index
- `USE TEMP B-TREE FOR GROUP BY` - Hash aggregate without index

SQL Whisperer recommendations:
- SCAN on table with >1000 rows → Add index
- TEMP B-TREE for ORDER BY → Add index matching ORDER BY columns
- Multiple SCAN operations → Check for Cartesian product (missing JOIN condition)

#### SQLite-Specific Optimizations

**WITHOUT ROWID tables** (SQLite 3.8.2+):
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL
) WITHOUT ROWID;
```

Benefits:
- Uses PRIMARY KEY as B-tree key (like InnoDB clustered index)
- Saves 8 bytes per row (no rowid column)
- Faster primary key lookups

When to use:
- Small primary keys (composite keys are OK)
- Frequent primary key lookups
- Don't need automatic rowid generation

SQL Whisperer detects WITHOUT ROWID tables via `sqlite_master`:
```sql
SELECT sql FROM sqlite_master WHERE type = 'table' AND sql LIKE '%WITHOUT ROWID%';
```

**Pragma optimizations:**
```sql
PRAGMA journal_mode = WAL;  -- Concurrent readers
PRAGMA synchronous = NORMAL;  -- Faster writes
PRAGMA cache_size = -64000;  -- 64MB cache
PRAGMA temp_store = MEMORY;  -- In-memory temp tables
```

These are applied automatically on connection by SQLiteClient.

---

## Features

### Core Capabilities

- **Multi-database support**: PostgreSQL, MySQL (5.7+), SQLite (3.8+)
- **Comprehensive schema introspection**:
  - Tables, columns, data types, nullability
  - Primary keys, foreign keys, unique constraints, check constraints
  - Indexes with type (B-tree, Hash, GIN, GIST), uniqueness, partial conditions
  - Views, sequences (PostgreSQL), triggers
  - Row counts, table sizes, index sizes
  - Database version, character set, collation

- **Query execution with safety**:
  - Parameterized queries (SQL injection prevention)
  - Timeout enforcement (prevent runaway queries)
  - Row limits (prevent OOM from large result sets)
  - Validation before execution (dangerous operation detection)

- **Query optimization analysis**:
  - EXPLAIN plan parsing (JSON format)
  - Cost estimation breakdown
  - Index usage detection
  - Join strategy analysis (Nested Loop, Hash Join, Merge Join)
  - Optimization recommendations based on execution plan

- **Table statistics**:
  - PostgreSQL: Live/dead tuple counts, vacuum/analyze timestamps, DML counts
  - MySQL: Row count estimates, data/index size
  - SQLite: Page counts, B-tree structure

- **Safety validation**:
  - SQL injection pattern detection
  - Dangerous operation blocking (DROP, TRUNCATE, DELETE without WHERE)
  - Mutation confirmation requirements
  - Query complexity estimation
  - Cartesian product detection

### MCP Protocol Integration

SQL Whisperer implements the Model Context Protocol, enabling:

- **Natural language querying** through Claude Code/Desktop
- **Conversational database exploration** without writing SQL
- **AI-assisted query optimization** with LLM analysis of EXPLAIN plans
- **Educational tool** for learning SQL and database concepts

---

## Installation

### Prerequisites

- Node.js 16+ (LTS recommended)
- PostgreSQL 9.6+, MySQL 5.7+, or SQLite 3.8+
- Claude Code or Claude Desktop (for MCP integration)

### Install from npm

```bash
npm install -g sql-whisperer
```

### Install from source

```bash
git clone https://github.com/consigcody94/sql-whisperer.git
cd sql-whisperer
npm install
npm run build
npm link
```

---

## Configuration

### Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "sql-whisperer": {
      "command": "sql-whisperer",
      "env": {
        "DB_TYPE": "postgresql",
        "DB_HOST": "localhost",
        "DB_PORT": "5432",
        "DB_NAME": "myapp",
        "DB_USER": "postgres",
        "DB_PASSWORD": "secret",
        "DB_SSL": "false"
      }
    }
  }
}
```

**Alternative: Connection string**

```json
{
  "mcpServers": {
    "sql-whisperer": {
      "command": "sql-whisperer",
      "env": {
        "DB_CONNECTION_STRING": "postgresql://user:pass@localhost:5432/myapp"
      }
    }
  }
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_TYPE` | Database type: `postgresql`, `mysql`, `sqlite` | (required) |
| `DB_CONNECTION_STRING` | Full connection string | (optional) |
| `DB_HOST` | Database host | `localhost` |
| `DB_PORT` | Database port | `5432` (PostgreSQL), `3306` (MySQL) |
| `DB_NAME` | Database name | (required) |
| `DB_USER` | Username | (required for PostgreSQL/MySQL) |
| `DB_PASSWORD` | Password | (required for PostgreSQL/MySQL) |
| `DB_SSL` | Enable SSL | `false` |
| `DB_FILENAME` | SQLite database file path | (required for SQLite) |

---

## MCP Tools

### `connect_database`

Connect to a database and retrieve metadata.

**Arguments:**
```typescript
{
  type: 'postgresql' | 'mysql' | 'sqlite',
  connectionString?: string,
  host?: string,
  port?: number,
  database?: string,
  user?: string,
  password?: string,
  filename?: string,  // SQLite only
  ssl?: boolean
}
```

**Returns:**
- Database type and version
- Character set and collation
- Table and view counts
- Connection status

### `get_schema`

Get complete database schema with all tables, views, indexes, and constraints.

**Returns:**
- Table list with row counts and sizes
- Column details (type, nullability, defaults, auto-increment)
- Primary keys and foreign keys
- Indexes with type and uniqueness
- Views and sequences

### `describe_table`

Get detailed information about a specific table.

**Arguments:**
```typescript
{
  tableName: string  // Can include schema: "public.users"
}
```

**Returns:**
- Full column definitions
- Primary key
- Foreign key relationships with ON DELETE/UPDATE actions
- All indexes with column order
- Table statistics (rows, size, average row size)

### `execute_query`

Execute a SQL query with validation and optional EXPLAIN plan.

**Arguments:**
```typescript
{
  query: string,
  params?: unknown[],
  maxRows?: number,      // Default: 1000
  timeout?: number,      // Default: 30000ms
  explain?: boolean,     // Include EXPLAIN plan
  analyze?: boolean      // Run EXPLAIN ANALYZE
}
```

**Returns:**
- Query results as markdown table
- Execution time
- Warnings (SELECT *, missing LIMIT, etc.)
- EXPLAIN plan (if requested)
- Optimization recommendations

### `explain_query`

Get execution plan without running the query.

**Arguments:**
```typescript
{
  query: string,
  analyze?: boolean  // Run EXPLAIN ANALYZE (executes query)
}
```

**Returns:**
- Query execution plan tree
- Cost estimates
- Row estimates vs actuals (if ANALYZE)
- Optimization recommendations

### `optimize_query`

Analyze query and provide optimization suggestions.

**Arguments:**
```typescript
{
  query: string
}
```

**Returns:**
- Query complexity analysis
- Validation warnings (injection patterns, dangerous operations)
- EXPLAIN plan recommendations
- Index suggestions
- General optimization tips

### `table_statistics`

Get statistics for a table.

**Arguments:**
```typescript
{
  tableName: string
}
```

**Returns:**
- Row count
- Table size and index size
- PostgreSQL: Dead tuples, vacuum/analyze timestamps, DML counts
- Average row size

### `validate_query`

Validate query without executing it.

**Arguments:**
```typescript
{
  query: string
}
```

**Returns:**
- Validation status (pass/fail)
- Query type (SELECT, INSERT, UPDATE, DELETE, DDL)
- Errors (dangerous operations, missing WHERE clause)
- Warnings (SELECT *, missing LIMIT, injection patterns)
- Complexity estimate

### `sample_data`

Get sample rows from a table.

**Arguments:**
```typescript
{
  tableName: string,
  limit?: number  // Default: 10
}
```

**Returns:**
- Sample rows as markdown table
- Column names and data types

---

## Query Optimization Deep Dive

### Index Selection Strategies

#### PostgreSQL B-tree Indexes

B-tree indexes support:
- Equality: `WHERE col = value`
- Range: `WHERE col > value`, `WHERE col BETWEEN a AND b`
- Prefix match: `WHERE col LIKE 'prefix%'`
- Sorting: `ORDER BY col`
- Min/max: `SELECT MIN(col)`, `SELECT MAX(col)`

**Index selectivity:**
```sql
-- High selectivity (good for indexing)
SELECT COUNT(DISTINCT email) / COUNT(*) FROM users;
-- 0.95 = 95% unique → excellent index candidate

-- Low selectivity (poor for indexing)
SELECT COUNT(DISTINCT status) / COUNT(*) FROM orders;
-- 0.02 = 2% unique (e.g., 'pending', 'completed') → poor index candidate
```

**Partial indexes** for filtered queries:
```sql
CREATE INDEX idx_active_users ON users (email) WHERE deleted_at IS NULL;

-- This query uses the partial index:
SELECT * FROM users WHERE email = 'test@example.com' AND deleted_at IS NULL;
```

**Covering indexes** to avoid table lookups:
```sql
CREATE INDEX idx_user_email_name ON users (email) INCLUDE (first_name, last_name);

-- Index-only scan (no table access needed):
SELECT email, first_name, last_name FROM users WHERE email LIKE 'john%';
```

SQL Whisperer detects covering indexes via EXPLAIN:
```json
{
  "Node Type": "Index Only Scan",
  "Index Name": "idx_user_email_name",
  "Heap Fetches": 0  // No table lookups required
}
```

#### MySQL InnoDB Index Strategies

**Composite index column order matters:**
```sql
-- Index on (last_name, first_name, birth_date)
CREATE INDEX idx_name_dob ON users (last_name, first_name, birth_date);

-- ✓ Uses index (leftmost prefix):
WHERE last_name = 'Smith'
WHERE last_name = 'Smith' AND first_name = 'John'
WHERE last_name = 'Smith' AND first_name = 'John' AND birth_date > '1990-01-01'

-- ✗ Does NOT use index (skips leftmost column):
WHERE first_name = 'John'
WHERE birth_date > '1990-01-01'
WHERE first_name = 'John' AND birth_date > '1990-01-01'
```

**Covering index penalty in InnoDB:**

Since secondary indexes include the primary key, a composite index on `(a, b)` with primary key `id` is effectively:
```
Index: (a, b, id)  // Primary key added automatically
```

This makes covering indexes larger than in PostgreSQL.

SQL Whisperer shows index size:
```sql
SELECT index_name, ROUND(stat_value * @@innodb_page_size / 1024 / 1024, 2) AS size_mb
FROM mysql.innodb_index_stats
WHERE database_name = 'myapp' AND table_name = 'users' AND stat_name = 'size';
```

#### SQLite Index Optimization

**INTEGER PRIMARY KEY vs ROWID:**
```sql
-- Uses automatic rowid as B-tree key:
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT
);

-- Uses composite key as B-tree key (more efficient):
CREATE TABLE sessions (
  user_id INTEGER,
  token TEXT,
  PRIMARY KEY (user_id, token)
) WITHOUT ROWID;
```

**ANALYZE command:**
```sql
ANALYZE users;  -- Updates sqlite_stat1 table
```

Before ANALYZE, planner assumes ~1M rows per table. After ANALYZE, it uses accurate statistics:
```sql
SELECT tbl, idx, stat FROM sqlite_stat1;
-- tbl: users
-- idx: idx_email
-- stat: "10000 1"  -- 10,000 rows, 1 row per distinct email value (unique)
```

### Execution Plan Analysis

#### PostgreSQL Plan Node Types

**Sequential Scan:**
```json
{
  "Node Type": "Seq Scan",
  "Relation Name": "users",
  "Filter": "(email = 'test@example.com')",
  "Rows Removed by Filter": 9999,
  "Total Cost": 250.00
}
```
→ Reads entire table, filters in memory. Add index on `email`.

**Index Scan:**
```json
{
  "Node Type": "Index Scan",
  "Index Name": "idx_email",
  "Index Cond": "(email = 'test@example.com')",
  "Total Cost": 8.30
}
```
→ Uses index to find matching rows directly. 30x faster.

**Bitmap Heap Scan:**
```json
{
  "Node Type": "Bitmap Heap Scan",
  "Recheck Cond": "(status = ANY ('{pending,processing}'))",
  "Plans": [{
    "Node Type": "Bitmap Index Scan",
    "Index Name": "idx_status"
  }]
}
```
→ Builds bitmap of matching row positions, then fetches rows in physical order (efficient for 1-15% selectivity).

**Nested Loop Join:**
```json
{
  "Node Type": "Nested Loop",
  "Join Type": "Inner",
  "Plans": [{
    "Node Type": "Seq Scan",
    "Relation Name": "users"
  }, {
    "Node Type": "Index Scan",
    "Relation Name": "orders",
    "Index Cond": "(user_id = users.id)"
  }]
}
```
→ For each user row, look up matching orders via index. Efficient for small outer table (<1000 rows).

**Hash Join:**
```json
{
  "Node Type": "Hash Join",
  "Hash Cond": "(orders.user_id = users.id)",
  "Plans": [{
    "Node Type": "Seq Scan",
    "Relation Name": "users"
  }, {
    "Node Type": "Hash",
    "Plans": [{
      "Node Type": "Seq Scan",
      "Relation Name": "orders"
    }]
  }]
}
```
→ Build hash table of users, probe with orders rows. Efficient for large datasets.

**Merge Join:**
```json
{
  "Node Type": "Merge Join",
  "Merge Cond": "(users.id = orders.user_id)",
  "Plans": [{
    "Node Type": "Index Scan",
    "Relation Name": "users",
    "Index Name": "users_pkey"
  }, {
    "Node Type": "Index Scan",
    "Relation Name": "orders",
    "Index Name": "idx_user_id"
  }]
}
```
→ Both sides already sorted by join key (via indexes). Linear merge.

SQL Whisperer recommendations:
- Nested Loop with >10K rows → "Consider hash join for large datasets"
- Hash Join with small tables → "Nested loop may be faster, run ANALYZE"
- Sequential Scan on large table → "Add index on filtered/joined columns"

### Cost-Based Optimizer Insights

#### PostgreSQL Statistics

Query planner relies on table statistics:

```sql
SELECT
  schemaname,
  tablename,
  attname,
  n_distinct,  -- Number of distinct values (-1 = all unique, 0.5 = 50% unique)
  correlation  -- Physical ordering correlation (1.0 = perfectly ordered)
FROM pg_stats
WHERE tablename = 'users';
```

**n_distinct** affects planner decisions:
- High n_distinct (close to row count) → Index beneficial for equality searches
- Low n_distinct (few unique values) → Sequential scan often better

**correlation** affects index scan cost:
- correlation = 1.0 → Index scan reads sequential pages (fast)
- correlation = 0.0 → Index scan reads random pages (slow)

SQL Whisperer checks:
```sql
-- Check if ANALYZE is needed:
SELECT
  schemaname,
  tablename,
  last_analyze,
  n_tup_ins + n_tup_upd + n_tup_del AS changes
FROM pg_stat_user_tables
WHERE last_analyze < NOW() - INTERVAL '1 day';
```

#### MySQL Optimizer Statistics

InnoDB statistics stored in `mysql.innodb_index_stats` and `mysql.innodb_table_stats`:

```sql
-- Check index cardinality (distinct values):
SELECT
  database_name,
  table_name,
  index_name,
  stat_name,
  stat_value
FROM mysql.innodb_index_stats
WHERE database_name = 'myapp' AND table_name = 'users'
ORDER BY index_name, seq_in_index;
```

**Persistent vs transient statistics:**
```sql
-- Persistent (default in MySQL 8.0):
ALTER TABLE users STATS_PERSISTENT=1;

-- Analyze table to update statistics:
ANALYZE TABLE users;
```

SQL Whisperer warns when statistics are stale (controlled by `innodb_stats_auto_recalc`).

---

## Schema Introspection

### Foreign Key Relationship Mapping

SQL Whisperer extracts foreign key relationships from `information_schema`:

**PostgreSQL:**
```sql
SELECT
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  rc.update_rule,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu USING (constraint_name, constraint_schema)
JOIN information_schema.constraint_column_usage ccu USING (constraint_name, constraint_schema)
JOIN information_schema.referential_constraints rc USING (constraint_name, constraint_schema)
WHERE tc.constraint_type = 'FOREIGN KEY';
```

**Referential actions:**
- `CASCADE` - Delete/update child rows
- `SET NULL` - Set child foreign key to NULL
- `SET DEFAULT` - Set child foreign key to default value
- `RESTRICT` - Prevent delete/update if children exist
- `NO ACTION` - Like RESTRICT but deferred until transaction commit

SQL Whisperer shows relationship graph:
```
users (id)
  ← orders (user_id) ON DELETE CASCADE
  ← sessions (user_id) ON DELETE CASCADE
orders (id)
  ← order_items (order_id) ON DELETE CASCADE
  ← payments (order_id) ON DELETE SET NULL
```

### Constraint Analysis

**Check constraints:**
```sql
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  price NUMERIC(10,2) CHECK (price > 0),
  discount_pct INTEGER CHECK (discount_pct BETWEEN 0 AND 100),
  CHECK (price * (1 - discount_pct/100.0) > 0)  -- Discounted price > 0
);
```

SQL Whisperer extracts check constraint expressions:
```
products.price: price > 0
products.discount_pct: discount_pct >= 0 AND discount_pct <= 100
products.<unnamed>: price * (1 - discount_pct/100.0) > 0
```

**Unique constraints vs unique indexes:**

PostgreSQL creates a unique index for each unique constraint, but:
- Unique constraint: Can be deferred until transaction commit
- Unique index: Checked immediately on INSERT/UPDATE

```sql
-- Deferrable unique constraint:
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT,
  CONSTRAINT users_email_key UNIQUE (email) DEFERRABLE INITIALLY DEFERRED
);
```

SQL Whisperer distinguishes between constraints and indexes in output.

---

## Safety & Validation

### SQL Injection Detection

Query validator detects common injection patterns:

**Pattern 1: Tautology injection**
```sql
-- Dangerous: User input in string
"SELECT * FROM users WHERE username = '" + userInput + "'"

-- If userInput = "admin' OR '1'='1"
SELECT * FROM users WHERE username = 'admin' OR '1'='1'  -- Always true
```

SQL Whisperer warns: `POTENTIAL_INJECTION: OR 1=1 pattern detected`

**Pattern 2: Union-based injection**
```sql
-- If userInput = "1 UNION SELECT username, password, null FROM admin_users --"
SELECT * FROM products WHERE id = 1 UNION SELECT username, password, null FROM admin_users --
```

SQL Whisperer warns: `POTENTIAL_INJECTION: UNION SELECT pattern detected`

**Solution: Parameterized queries**
```typescript
// ✓ Safe (parameters are escaped):
client.query({
  query: 'SELECT * FROM users WHERE email = $1',
  params: [userEmail]
});
```

### Dangerous Operation Prevention

Query validator blocks:

**DROP TABLE/DATABASE:**
```sql
DROP TABLE users;  -- ❌ Blocked
```
→ Error: `DANGEROUS_OPERATION: DROP TABLE`

**TRUNCATE:**
```sql
TRUNCATE users;  -- ❌ Blocked
```
→ Error: `DANGEROUS_OPERATION: TRUNCATE`

**DELETE without WHERE:**
```sql
DELETE FROM users;  -- ❌ Blocked
```
→ Error: `DELETE_WITHOUT_WHERE: DELETE statement without WHERE clause will remove all rows`

**UPDATE without WHERE:**
```sql
UPDATE users SET active = false;  -- ⚠️ Warning
```
→ Warning: `UPDATE_WITHOUT_WHERE: UPDATE statement without WHERE clause will modify all rows`

### Query Complexity Estimation

Complexity scoring:
```typescript
let score = 0;
score += 2 * (number of JOINs);
score += 3 * (number of subqueries);
score += 2 * (number of UNIONs);
score += 1 * (GROUP BY present);
score += 1 * (ORDER BY present);
score += 3 * (window functions present);

if (score <= 2) return 'low';
if (score <= 6) return 'medium';
return 'high';
```

High-complexity queries trigger warnings:
- ⚠️ "Query complexity: high. Consider breaking into multiple queries."
- ⚠️ "Complex subqueries detected. Consider using CTEs for readability."

---

## Performance Considerations

### Connection Pooling Best Practices

**Rule of thumb for pool size:**
```
max_connections = (number of CPU cores * 2) + effective_spindle_count
```

For typical web app on 4-core machine with SSD:
```
max_connections = (4 * 2) + 0 = 8
```

**Why not more connections?**
- Each connection consumes ~10MB RAM (PostgreSQL with shared_buffers)
- Context switching overhead when connections > CPU cores
- Lock contention increases with connection count

SQL Whisperer defaults:
- PostgreSQL: `poolMin: 2, poolMax: 10`
- MySQL: `connectionLimit: 10`
- SQLite: Single connection (no concurrency benefit)

### Query Timeout Strategy

**Statement timeout vs connection timeout:**

```typescript
// Statement timeout: Kills query after N ms
await client.query('SET statement_timeout = 30000');
await client.query('SELECT ...');  // Killed after 30s

// Connection timeout: Fails to acquire connection after N ms
const pool = new Pool({ connectionTimeoutMillis: 10000 });
const client = await pool.connect();  // Fails after 10s if pool exhausted
```

SQL Whisperer enforces:
- Default query timeout: 30s
- Max query timeout: 5 minutes
- Connection acquisition timeout: 10s

### Index Maintenance

**PostgreSQL VACUUM strategy:**
```sql
-- Manual VACUUM to reclaim space:
VACUUM ANALYZE users;

-- Check if VACUUM needed:
SELECT
  schemaname,
  relname,
  n_dead_tup,
  n_live_tup,
  ROUND(n_dead_tup * 100.0 / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_pct
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY dead_pct DESC;
```

**Autovacuum tuning:**
```sql
-- Per-table autovacuum settings:
ALTER TABLE high_churn_table SET (
  autovacuum_vacuum_scale_factor = 0.05,  -- VACUUM at 5% dead tuples (default: 20%)
  autovacuum_analyze_scale_factor = 0.02  -- ANALYZE at 2% changes (default: 10%)
);
```

SQL Whisperer's `table_statistics` tool shows dead tuple percentage and last vacuum time.

**MySQL index statistics:**
```sql
-- Update index statistics:
ANALYZE TABLE users;

-- Check index cardinality:
SHOW INDEX FROM users;
```

Low cardinality (<10%) indicates index may not be selective enough.

**SQLite ANALYZE:**
```sql
-- Analyze all tables:
ANALYZE;

-- Check statistics:
SELECT * FROM sqlite_stat1;
```

Run after bulk inserts or schema changes.

---

## Advanced Usage

### Programmatic API

SQL Whisperer can be used as a library:

```typescript
import { PostgreSQLClient } from 'sql-whisperer';

const client = new PostgreSQLClient({
  type: 'postgresql',
  host: 'localhost',
  port: 5432,
  database: 'myapp',
  user: 'postgres',
  password: 'secret',
});

await client.connect();

// Introspect schema
const schema = await client.introspect();
console.log(`Found ${schema.tables.length} tables`);

// Execute query
const result = await client.query({
  query: 'SELECT * FROM users WHERE active = $1',
  params: [true],
  options: { maxRows: 100, timeout: 5000 },
});

console.log(`Returned ${result.rowCount} rows in ${result.executionTimeMs}ms`);

// Get explain plan
const plan = await client.explain('SELECT * FROM users WHERE email = $1', true);
console.log(plan.formatted);

await client.disconnect();
```

### Custom Validation Rules

Extend `QueryValidator`:

```typescript
import { QueryValidator } from 'sql-whisperer';

class CustomValidator extends QueryValidator {
  static validate(query: string) {
    const result = super.validate(query);

    // Add custom rule: Warn on LEFT JOIN
    if (query.toUpperCase().includes('LEFT JOIN')) {
      result.warnings.push({
        code: 'LEFT_JOIN_WARNING',
        message: 'LEFT JOIN detected. Ensure this is intentional.',
        severity: 'info',
        suggestion: 'Consider INNER JOIN if all related records are required.',
      });
    }

    return result;
  }
}
```

---

## Development

### Build from Source

```bash
git clone https://github.com/consigcody94/sql-whisperer.git
cd sql-whisperer
npm install
npm run build
```

### Run Tests

```bash
npm test
npm run test:watch
npm run test:coverage
```

### Type Checking

```bash
npm run typecheck
```

### Linting

```bash
npm run lint
npm run format
```

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Areas for contribution:**
- Additional database support (SQL Server, Oracle, CockroachDB)
- Advanced natural language to SQL using LLM context
- Query result visualization (charts, graphs)
- Migration planning and schema diff tools
- Performance regression detection
- Query cache integration

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Acknowledgments

Built with:
- [pg](https://github.com/brianc/node-postgres) - PostgreSQL client
- [mysql2](https://github.com/sidorares/node-mysql2) - MySQL client
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - SQLite client
- [Model Context Protocol](https://modelcontextprotocol.io) - Claude integration

Inspired by:
- PostgreSQL's EXPLAIN ANALYZE documentation
- MySQL Performance Schema
- SQLite Query Planner documentation
- Use The Index, Luke! (https://use-the-index-luke.com/)

---

**Made with deep database knowledge and attention to query optimization.**
