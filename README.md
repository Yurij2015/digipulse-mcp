# DigiPulse MCP Server

MCP server for DigiPulse — gives AI agents (Claude Code, Cline, Claude Desktop, Cursor) read access to your monitoring data.

## Transport

Uses **Streamable HTTP** (`/mcp` endpoint) — the current MCP standard.

## Running

```bash
# Development (auto-reload)
npm run dev

# Production
npm run build
npm start
```

Server starts on `http://localhost:3001` (or `PORT` from env).

## Authentication

Token is required on session initialization. Pass it via:

- `Authorization: Bearer <token>` header
- `?token=<token>` query param
- `DIGIPULSE_API_TOKEN` in `.env` (local fallback)

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```env
DIGIPULSE_API_URL=http://localhost/api/v1
DIGIPULSE_FRONTEND_KEY=your_frontend_key
DIGIPULSE_API_TOKEN=your_sanctum_token
PORT=3001
```

## Connecting Agents

### Claude Code

```bash
claude mcp add --transport http digipulse http://localhost:3001/mcp --header "Authorization: Bearer YOUR_API_TOKEN"
```

Or add manually to one of:

- `~/.claude.json` — user-level, available in all projects
- `.mcp.json` in project root — project-level only

```json
{
  "mcpServers": {
    "digipulse": {
      "type": "http",
      "url": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_TOKEN"
      }
    }
  }
}
```

### Cline

Add to `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "digipulse": {
      "type": "streamableHttp",
      "url": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_TOKEN"
      }
    }
  }
}
```

### Claude Desktop (claude.ai)

Claude Desktop does not support HTTP servers via config file. Use **Custom Connectors** instead:

1. Open [claude.ai](https://claude.ai) → Settings → Connectors
2. Click **Add custom connector**
3. Enter the server URL: `http://localhost:3001/mcp?token=YOUR_API_TOKEN`
4. Click **Save**

### Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Open the Inspector UI → set transport to **Streamable HTTP** → connect to `http://localhost:3001/mcp`.

## Available Tools

### `digipulse_get_overview`
Returns all projects with their sites, current status, uptime, SSL info, and a summary. Use this as the default first call — answers most monitoring questions in one request.

| Parameter | Type | Description |
|-----------|------|-------------|
| `project_id` | number? | Filter results to a single project |

### `digipulse_get_site_history`
Returns hourly or daily aggregated stats and downtime incidents for a site by date range.

| Parameter | Type | Description |
|-----------|------|-------------|
| `site_id` | number | Site ID (from `get_overview`) |
| `from` | string? | Start date `YYYY-MM-DD`, defaults to 7 days ago |
| `to` | string? | End date `YYYY-MM-DD`, defaults to today |
| `granularity` | `hour\|day`? | Aggregation granularity, use `day` for ranges > 2 weeks |

### `digipulse_get_incidents`
Returns a paginated cross-site list of downtime incidents sorted newest-first.

| Parameter | Type | Description |
|-----------|------|-------------|
| `project_id` | number? | Filter by project |
| `site_id` | number? | Filter by site |
| `from` | string? | Start date `YYYY-MM-DD`, defaults to 7 days ago |
| `to` | string? | End date `YYYY-MM-DD`, defaults to today |
| `limit` | number? | Max results, default 50, max 200 |
| `offset` | number? | Pagination offset, default 0 |

## Available Resources

| Resource | URI | Description |
|----------|-----|-------------|
| `site-details` | `digipulse://sites/{id}` | Full site details by ID |

## Available Prompts

| Prompt | Description |
|--------|-------------|
| `audit_sites` | Generate a health audit report for all monitored sites |

## Example Queries

- *"What is the current status of my monitored sites?"*
- *"Show me sites that are down or have SSL issues."*
- *"Show response time history for site 3 over the last 30 days."*
- *"What incidents happened this week across all projects?"*
- *"Run a full infrastructure health audit."*
