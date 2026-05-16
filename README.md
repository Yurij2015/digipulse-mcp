# DigiPulse MCP Server

MCP server for DigiPulse — gives AI agents (Cline, Claude Desktop, Cursor) read access to your monitoring data.

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

### Cline

Add to `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "digipulse": {
      "url": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_TOKEN"
      }
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "digipulse": {
      "url": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_TOKEN"
      }
    }
  }
}
```

### Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Open the Inspector UI → set transport to **Streamable HTTP** → connect to `http://localhost:3001/mcp`.

## Available Tools

| Tool | Description |
|------|-------------|
| `digipulse_list_sites` | All monitored sites with status, uptime, response time, SSL info |
| `digipulse_list_projects` | All projects with site count |
| `digipulse_get_site_history` | Hourly stats and downtime incidents for a site (by week) |

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
- *"Analyze the uptime history for site 5 this week."*
- *"Run a full infrastructure health audit."*
