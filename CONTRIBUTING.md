# Contributing to SQL Whisperer

Thank you for your interest in contributing to SQL Whisperer! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Code Style](#code-style)
- [Pull Request Process](#pull-request-process)
- [Feature Ideas](#feature-ideas)

---

## Code of Conduct

Be respectful, inclusive, and professional in all interactions.

---

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/sql-whisperer.git
   cd sql-whisperer
   ```

3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/consigcody94/sql-whisperer.git
   ```

4. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

---

## Development Setup

### Prerequisites

- Node.js 16+
- PostgreSQL 12+ (for testing)
- MySQL 8+ or MariaDB 10.3+ (for testing)
- SQLite 3.8+ (built-in)

### Install Dependencies

```bash
npm install
```

### Build Project

```bash
npm run build
```

### Run in Development Mode

```bash
npm run dev
```

This runs TypeScript compiler in watch mode.

### Link Locally

```bash
npm link
```

Now you can test with `sql-whisperer` command globally.

---

## Making Changes

### Branch Naming

- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation updates
- `refactor/` - Code refactoring
- `test/` - Test additions/modifications
- `chore/` - Build process, tooling changes

Examples:
- `feature/add-sql-server-support`
- `fix/connection-pool-leak`
- `docs/improve-mcp-setup-guide`

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <description>

[optional body]

[optional footer]
```

**Types:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, no logic change)
- `refactor:` - Code refactoring
- `test:` - Test additions/modifications
- `chore:` - Build, tooling, dependencies

**Examples:**
```
feat: add SQL Server database client

Implements SQL Server support with mssql driver. Includes:
- Connection pooling
- Schema introspection
- EXPLAIN plan parsing

Closes #42
```

```
fix: prevent connection pool exhaustion

Adds idle connection timeout to prevent pool from filling with
stale connections. Default timeout set to 30s.

Fixes #38
```

---

## Testing

### Run Tests

```bash
npm test
```

### Run Tests in Watch Mode

```bash
npm run test:watch
```

### Run Tests with Coverage

```bash
npm run test:coverage
```

### Write Tests

Place tests in `tests/` directory:

```typescript
import { QueryValidator } from '../src/validators/query-validator';

describe('QueryValidator', () => {
  it('should detect DELETE without WHERE clause', () => {
    const result = QueryValidator.validate('DELETE FROM users');

    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('DELETE_WITHOUT_WHERE');
  });
});
```

### Integration Tests

For database integration tests, use Docker containers:

```bash
# Start test databases
docker-compose up -d

# Run integration tests
npm run test:integration

# Stop test databases
docker-compose down
```

---

## Code Style

### TypeScript Guidelines

1. **Use strict mode** - All TypeScript strict flags enabled
2. **Explicit types** - Avoid `any`, use proper types
3. **Interfaces over types** - Prefer `interface` for object shapes
4. **Naming conventions**:
   - `camelCase` for variables and functions
   - `PascalCase` for classes and interfaces
   - `UPPER_SNAKE_CASE` for constants

5. **No implicit returns** - Always explicit return statements
6. **Error handling** - Throw typed errors, not strings

### Code Formatting

We use **Prettier** for code formatting:

```bash
npm run format
```

### Linting

We use **ESLint** for code linting:

```bash
npm run lint
```

Fix auto-fixable issues:

```bash
npm run lint -- --fix
```

### Code Organization

```
src/
├── types.ts              # All TypeScript interfaces
├── clients/              # Database clients
│   ├── base-client.ts
│   ├── postgresql-client.ts
│   ├── mysql-client.ts
│   └── sqlite-client.ts
├── validators/           # Query validation
│   └── query-validator.ts
├── utils/                # Utility functions
├── mcp-server.ts         # MCP server implementation
└── index.ts              # Public API exports
```

**Guidelines:**
- Keep files under 500 lines
- One class/interface per file (except tightly coupled types)
- Group related functionality in directories
- Export public API through `index.ts`

---

## Pull Request Process

### Before Submitting

1. **Sync with upstream**:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Run all checks**:
   ```bash
   npm run typecheck  # Type checking
   npm run lint       # Linting
   npm test           # Tests
   npm run build      # Build
   ```

3. **Update documentation** if needed:
   - README.md for feature changes
   - MCP_SETUP.md for configuration changes
   - Add JSDoc comments to public APIs

4. **Add tests** for new features or bug fixes

### Submit Pull Request

1. Push your branch:
   ```bash
   git push origin feature/your-feature-name
   ```

2. Open Pull Request on GitHub

3. Fill out PR template:
   ```markdown
   ## Description
   Brief description of changes

   ## Motivation
   Why is this change needed?

   ## Changes Made
   - Added X
   - Modified Y
   - Fixed Z

   ## Testing
   How was this tested?

   ## Checklist
   - [ ] Tests added/updated
   - [ ] Documentation updated
   - [ ] TypeScript types added
   - [ ] Passes `npm test`
   - [ ] Passes `npm run lint`
   - [ ] Passes `npm run typecheck`
   - [ ] Passes `npm run build`
   ```

4. Wait for CI checks to pass

5. Address review feedback

### PR Review Process

- Maintainers will review within 3-5 business days
- Address all comments and requested changes
- Keep PR focused - one feature/fix per PR
- Squash commits if asked (we'll squash on merge)

---

## Feature Ideas

### High Priority

1. **Additional Database Support**
   - SQL Server (mssql driver)
   - Oracle (oracledb driver)
   - CockroachDB (use PostgreSQL client)
   - Amazon Redshift (use PostgreSQL client)

2. **Natural Language Query Generation**
   - Use schema context to generate SQL from prompts
   - Integrate with LLM for intelligent query suggestions

3. **Query Result Visualization**
   - Generate charts from query results
   - Time series visualization
   - Aggregate visualizations (pie, bar charts)

4. **Schema Migration Tools**
   - Diff between two database schemas
   - Generate migration scripts
   - Safe rollback plans

### Medium Priority

1. **Performance Monitoring**
   - Track query execution times
   - Detect slow queries
   - Alert on regression

2. **Query Cache Integration**
   - Cache query results
   - Invalidation strategies
   - Redis-based caching

3. **Connection Pool Monitoring**
   - Pool statistics dashboard
   - Connection leak detection
   - Performance metrics

4. **Advanced Query Validation**
   - Detect N+1 query patterns
   - Suggest index improvements
   - Identify missing foreign keys

### Low Priority

1. **GraphQL Integration**
   - Generate GraphQL schema from database
   - Query translation

2. **REST API Generation**
   - Generate CRUD APIs from schema
   - OpenAPI spec generation

3. **Database Backup/Restore**
   - Automated backup scheduling
   - Point-in-time recovery

---

## Development Guidelines

### Adding a New Database Client

1. Create `src/clients/your-db-client.ts`:
   ```typescript
   import { BaseDatabaseClient } from './base-client.js';
   import type { DatabaseSchema, QueryResult } from '../types.js';

   export class YourDBClient extends BaseDatabaseClient {
     async connect(): Promise<void> {
       // Implementation
     }

     async disconnect(): Promise<void> {
       // Implementation
     }

     async query(request: QueryRequest): Promise<QueryResult> {
       // Implementation
     }

     async introspect(): Promise<DatabaseSchema> {
       // Implementation
     }

     // ... other methods
   }
   ```

2. Add tests: `tests/clients/your-db-client.test.ts`

3. Update `src/mcp-server.ts` to support new database type

4. Update documentation in README.md and MCP_SETUP.md

### Adding a New MCP Tool

1. Add tool definition to `listTools()` in `src/mcp-server.ts`:
   ```typescript
   {
     name: 'your_tool_name',
     description: 'What this tool does',
     inputSchema: {
       type: 'object',
       properties: {
         param1: { type: 'string', description: '...' }
       },
       required: ['param1']
     }
   }
   ```

2. Add handler in `callTool()`:
   ```typescript
   case 'your_tool_name':
     result = await this.yourToolHandler(args);
     break;
   ```

3. Implement handler method:
   ```typescript
   private async yourToolHandler(args: Record<string, unknown>): Promise<string> {
     this.ensureConnected();
     // Implementation
     return this.formatMarkdown(result);
   }
   ```

4. Add tests

5. Update README.md with tool documentation

---

## Questions?

- **Bug reports:** [Open an issue](https://github.com/consigcody94/sql-whisperer/issues)
- **Feature requests:** [Open an issue](https://github.com/consigcody94/sql-whisperer/issues)
- **General questions:** [Discussions](https://github.com/consigcody94/sql-whisperer/discussions)

---

Thank you for contributing to SQL Whisperer!
