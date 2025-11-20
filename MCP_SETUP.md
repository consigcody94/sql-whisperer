# MCP Setup Guide

Complete setup instructions for SQL Whisperer with Claude Desktop and Claude Code.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Claude Desktop Configuration](#claude-desktop-configuration)
- [Claude Code Configuration](#claude-code-configuration)
- [Database Setup](#database-setup)
- [Testing Connection](#testing-connection)
- [Troubleshooting](#troubleshooting)
- [Advanced Configuration](#advanced-configuration)

---

## Prerequisites

### Required Software

- **Node.js 16+** (LTS recommended)
  ```bash
  node --version  # Should be v16.0.0 or higher
  ```

- **Claude Desktop** or **Claude Code**
  - Download from: https://claude.ai/download

- **Database Server:**
  - PostgreSQL 9.6+ (recommended: 14+)
  - MySQL 5.7+ or MariaDB 10.3+
  - SQLite 3.8+ (built-in, no server required)

### Database Access

Ensure you have:
- Database hostname and port
- Database name
- Username and password (not required for SQLite)
- Network access to database server

---

## Installation

### Install Globally from npm

```bash
npm install -g sql-whisperer
```

Verify installation:
```bash
sql-whisperer --version
```

### Install from Source

```bash
git clone https://github.com/consigcody94/sql-whisperer.git
cd sql-whisperer
npm install
npm run build
npm link
```

---

## Claude Desktop Configuration

### macOS

Configuration file: `~/Library/Application Support/Claude/claude_desktop_config.json`

### Linux

Configuration file: `~/.config/Claude/claude_desktop_config.json`

### Windows

Configuration file: `%APPDATA%\Claude\claude_desktop_config.json`

### PostgreSQL Example

```json
{
  "mcpServers": {
    "sql-whisperer": {
      "command": "sql-whisperer",
      "env": {
        "DB_TYPE": "postgresql",
        "DB_HOST": "localhost",
        "DB_PORT": "5432",
        "DB_NAME": "myapp_development",
        "DB_USER": "postgres",
        "DB_PASSWORD": "your_password_here",
        "DB_SSL": "false"
      }
    }
  }
}
```

### MySQL Example

```json
{
  "mcpServers": {
    "sql-whisperer": {
      "command": "sql-whisperer",
      "env": {
        "DB_TYPE": "mysql",
        "DB_HOST": "localhost",
        "DB_PORT": "3306",
        "DB_NAME": "myapp_development",
        "DB_USER": "root",
        "DB_PASSWORD": "your_password_here",
        "DB_SSL": "false"
      }
    }
  }
}
```

### SQLite Example

```json
{
  "mcpServers": {
    "sql-whisperer": {
      "command": "sql-whisperer",
      "env": {
        "DB_TYPE": "sqlite",
        "DB_FILENAME": "/Users/username/databases/myapp.db"
      }
    }
  }
}
```

### Connection String Format

Alternatively, use a connection string:

```json
{
  "mcpServers": {
    "sql-whisperer": {
      "command": "sql-whisperer",
      "env": {
        "DB_CONNECTION_STRING": "postgresql://user:password@localhost:5432/myapp"
      }
    }
  }
}
```

**Connection string formats:**
- PostgreSQL: `postgresql://user:password@host:port/database?ssl=true`
- MySQL: `mysql://user:password@host:port/database`
- SQLite: `file:/path/to/database.db`

---

## Claude Code Configuration

Claude Code uses the same configuration file format.

### Configuration Path

- **macOS/Linux:** `~/.config/claude-code/config.json`
- **Windows:** `%APPDATA%\claude-code\config.json`

### Example Configuration

```json
{
  "mcpServers": {
    "sql-whisperer": {
      "command": "sql-whisperer",
      "env": {
        "DB_TYPE": "postgresql",
        "DB_CONNECTION_STRING": "postgresql://localhost/myapp"
      }
    }
  }
}
```

---

## Database Setup

### PostgreSQL Setup

#### Create Database and User

```sql
-- Connect as postgres user
psql postgres

-- Create database
CREATE DATABASE myapp_development;

-- Create user (if needed)
CREATE USER myapp_user WITH PASSWORD 'secure_password';

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE myapp_development TO myapp_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO myapp_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO myapp_user;

-- Exit
\q
```

#### Test Connection

```bash
psql -h localhost -U myapp_user -d myapp_development
```

### MySQL Setup

#### Create Database and User

```sql
-- Connect as root
mysql -u root -p

-- Create database
CREATE DATABASE myapp_development CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Create user
CREATE USER 'myapp_user'@'localhost' IDENTIFIED BY 'secure_password';

-- Grant permissions
GRANT ALL PRIVILEGES ON myapp_development.* TO 'myapp_user'@'localhost';
FLUSH PRIVILEGES;

-- Exit
EXIT;
```

#### Test Connection

```bash
mysql -h localhost -u myapp_user -p myapp_development
```

### SQLite Setup

#### Create Database File

```bash
# SQLite creates the file automatically on first connection
sqlite3 ~/databases/myapp.db "SELECT 1;"
```

#### Verify File Exists

```bash
ls -lh ~/databases/myapp.db
```

---

## Testing Connection

### Restart Claude Desktop/Code

After updating the configuration file, **restart Claude Desktop or Claude Code** for changes to take effect.

### Test in Claude

1. Open Claude Desktop or Claude Code
2. Start a new conversation
3. Try these commands:

**Connect to database:**
```
Connect to my database
```

**Get schema:**
```
Show me all tables in the database
```

**Describe a table:**
```
Describe the users table
```

**Sample data:**
```
Show me 10 rows from the users table
```

### Expected Output

You should see:
- Connection confirmation with database type and version
- Table list with row counts
- Detailed table structure with columns and indexes
- Sample data formatted as a markdown table

---

## Troubleshooting

### Issue: "Command not found: sql-whisperer"

**Solution:**

1. Verify installation:
   ```bash
   npm list -g sql-whisperer
   ```

2. Find npm global bin directory:
   ```bash
   npm config get prefix
   ```

3. Add to PATH (if needed):
   ```bash
   # Add to ~/.bashrc or ~/.zshrc
   export PATH="$PATH:$(npm config get prefix)/bin"
   ```

4. Restart terminal

### Issue: "Not connected to database"

**Solution:**

1. Verify environment variables are set correctly in config file

2. Test connection manually:
   ```bash
   # PostgreSQL
   psql -h localhost -U your_user -d your_database

   # MySQL
   mysql -h localhost -u your_user -p your_database

   # SQLite
   sqlite3 /path/to/database.db "SELECT 1;"
   ```

3. Check firewall/network access to database server

4. Verify database credentials

### Issue: "Connection timeout"

**Solution:**

1. Check if database server is running:
   ```bash
   # PostgreSQL
   pg_isready -h localhost -p 5432

   # MySQL
   mysqladmin -h localhost -u root -p ping
   ```

2. Verify port is correct (PostgreSQL: 5432, MySQL: 3306)

3. Check for SSL requirement:
   ```json
   {
     "env": {
       "DB_SSL": "true"  // Try toggling this
     }
   }
   ```

### Issue: "Tools not showing in Claude"

**Solution:**

1. Restart Claude Desktop/Code completely (quit and reopen)

2. Verify MCP server configuration syntax is valid JSON:
   ```bash
   # macOS
   cat ~/Library/Application\ Support/Claude/claude_desktop_config.json | python -m json.tool
   ```

3. Check Claude Desktop logs:
   - **macOS:** `~/Library/Logs/Claude/`
   - **Linux:** `~/.local/share/Claude/logs/`
   - **Windows:** `%APPDATA%\Claude\logs\`

4. Look for MCP server startup errors

### Issue: "Permission denied"

**PostgreSQL Solution:**
```sql
-- Grant schema permissions
GRANT USAGE ON SCHEMA public TO your_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO your_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO your_user;
```

**MySQL Solution:**
```sql
-- Grant all permissions
GRANT ALL PRIVILEGES ON your_database.* TO 'your_user'@'localhost';
FLUSH PRIVILEGES;
```

---

## Advanced Configuration

### Multiple Database Connections

Configure multiple MCP servers for different databases:

```json
{
  "mcpServers": {
    "sql-whisperer-production": {
      "command": "sql-whisperer",
      "env": {
        "DB_TYPE": "postgresql",
        "DB_CONNECTION_STRING": "postgresql://prod-host/prod_db"
      }
    },
    "sql-whisperer-staging": {
      "command": "sql-whisperer",
      "env": {
        "DB_TYPE": "postgresql",
        "DB_CONNECTION_STRING": "postgresql://staging-host/staging_db"
      }
    },
    "sql-whisperer-local": {
      "command": "sql-whisperer",
      "env": {
        "DB_TYPE": "sqlite",
        "DB_FILENAME": "/Users/username/dev.db"
      }
    }
  }
}
```

### Connection Pool Tuning

Set custom pool sizes via environment variables:

```json
{
  "mcpServers": {
    "sql-whisperer": {
      "command": "sql-whisperer",
      "env": {
        "DB_TYPE": "postgresql",
        "DB_HOST": "localhost",
        "DB_NAME": "high_traffic_app",
        "DB_USER": "app_user",
        "DB_PASSWORD": "password",
        "DB_POOL_MIN": "5",
        "DB_POOL_MAX": "20",
        "DB_IDLE_TIMEOUT": "30000",
        "DB_CONNECTION_TIMEOUT": "10000"
      }
    }
  }
}
```

### Read-Only Mode

For production databases, use a read-only user:

```sql
-- PostgreSQL: Create read-only user
CREATE USER readonly_user WITH PASSWORD 'readonly_password';
GRANT CONNECT ON DATABASE production_db TO readonly_user;
GRANT USAGE ON SCHEMA public TO readonly_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_user;

-- MySQL: Create read-only user
CREATE USER 'readonly_user'@'%' IDENTIFIED BY 'readonly_password';
GRANT SELECT ON production_db.* TO 'readonly_user'@'%';
```

Then configure SQL Whisperer with read-only credentials:

```json
{
  "env": {
    "DB_USER": "readonly_user",
    "DB_PASSWORD": "readonly_password"
  }
}
```

### SSH Tunnel Connection

For remote databases behind firewall:

```bash
# Set up SSH tunnel (run in separate terminal)
ssh -L 5432:localhost:5432 user@remote-server

# Configure SQL Whisperer to use tunnel
{
  "env": {
    "DB_HOST": "localhost",  # Tunnel endpoint
    "DB_PORT": "5432",
    "DB_NAME": "remote_db",
    "DB_USER": "remote_user",
    "DB_PASSWORD": "remote_password"
  }
}
```

### SSL Certificate Configuration

For databases requiring SSL certificates:

```json
{
  "env": {
    "DB_TYPE": "postgresql",
    "DB_HOST": "production-db.example.com",
    "DB_NAME": "prod_db",
    "DB_USER": "prod_user",
    "DB_PASSWORD": "prod_password",
    "DB_SSL": "true",
    "DB_SSL_CA": "/path/to/ca-certificate.crt",
    "DB_SSL_CERT": "/path/to/client-certificate.crt",
    "DB_SSL_KEY": "/path/to/client-key.key"
  }
}
```

---

## Usage Examples

### Get Schema Overview

```
Claude, show me all tables and their row counts
```

### Analyze Table Structure

```
Describe the users table with all indexes and constraints
```

### Query Optimization

```
Explain this query: SELECT * FROM orders WHERE user_id = 123
```

```
Optimize this slow query: SELECT COUNT(*) FROM orders o JOIN users u ON o.user_id = u.id WHERE u.active = true
```

### Table Statistics

```
What are the statistics for the orders table?
```

### Sample Data

```
Show me 10 sample rows from the products table
```

### Query Validation

```
Validate this query before I run it: UPDATE users SET active = false WHERE last_login < '2023-01-01'
```

---

## Security Best Practices

1. **Use read-only users** for production databases
2. **Never commit credentials** to version control
3. **Use SSH tunnels** for remote database access
4. **Enable SSL** for all non-local connections
5. **Rotate passwords** regularly
6. **Limit database permissions** to only what's needed
7. **Monitor query logs** for suspicious activity

---

## Additional Resources

- [PostgreSQL Connection Strings](https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING)
- [MySQL Connection Parameters](https://dev.mysql.com/doc/refman/8.0/en/connecting.html)
- [SQLite Connection Strings](https://www.sqlite.org/c3ref/open.html)
- [Model Context Protocol Docs](https://modelcontextprotocol.io)
- [Claude Desktop Downloads](https://claude.ai/download)

---

**Need help?** [Open an issue](https://github.com/consigcody94/sql-whisperer/issues)
