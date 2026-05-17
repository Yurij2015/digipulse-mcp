import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import axios from "axios";
import { randomUUID } from "crypto";

const USE_HTTP = !!process.env.PORT;

if (USE_HTTP) {
  const { default: dotenv } = await import("dotenv");
  dotenv.config();
}

const API_URL = process.env.DIGIPULSE_API_URL || "http://localhost/api/v1";
const FRONTEND_KEY = process.env.DIGIPULSE_FRONTEND_KEY || "digipulse_development_key";

function createServer(apiToken: string) {
  const apiClient = axios.create({
    baseURL: API_URL,
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Frontend-Key": FRONTEND_KEY,
      "Authorization": `Bearer ${apiToken}`,
    },
  });

  const server = new McpServer({
    name: "digipulse-mcp",
    version: "1.0.0",
  });

  const siteSchema = z.object({
    id: z.number(),
    name: z.string(),
    url: z.string(),
    status: z.string(),
    uptime: z.number().nullable(),
    response_time: z.number().nullable(),
    last_checked_at: z.string().nullable(),
    project_id: z.number().nullable(),
    project_name: z.string().nullable(),
    ssl_valid: z.boolean().nullable(),
    ssl_expires_at: z.string().nullable(),
    ssl_days_remaining: z.number().nullable(),
  });

  server.registerTool("digipulse_get_overview", {
    title: "Get Monitoring Overview",
    description: `Returns a full account snapshot: all projects (with site counts and status summaries), all sites (with current status, uptime %, response time, SSL validity and days-until-expiry).

Use this as the default first call. It answers the majority of monitoring questions — "are all sites up?", "which project has issues?", "is SSL about to expire?" — in a single request without follow-up calls.

Optionally filter to a single project with project_id.`,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      project_id: z.number().optional().describe("Optional. Filter results to a single project. Omit to return all projects and sites."),
    },
    outputSchema: {
      projects: z.array(z.object({
        id: z.number(),
        name: z.string(),
        description: z.string().nullable(),
        sites: z.array(siteSchema),
      })),
      sites_without_project: z.array(siteSchema),
      summary: z.object({
        total_sites: z.number(),
        up: z.number(),
        down: z.number(),
        pending: z.number(),
        avg_uptime: z.number().nullable(),
        avg_response_time: z.number().nullable(),
      }),
    },
  }, async ({ project_id }) => {
    try {
      const params: Record<string, number> = {};
      if (project_id) params.project_id = project_id;
      const response = await apiClient.get("/mcp/overview", { params });
      const { projects, sites_without_project, summary } = response.data.data;
      return {
        content: [{ type: "text", text: JSON.stringify(response.data.data, null, 2) }],
        structuredContent: { projects, sites_without_project, summary },
      };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
  });

  server.registerTool("digipulse_get_site_history", {
    title: "Get Site History",
    description: `Returns the full history of a single site: hourly or daily aggregated stats and all incidents for the requested time window.

Use this after digipulse_get_overview when you need to:
- Show a response-time chart for a specific site
- List all incidents in a date range
- Compare performance across different periods

Use granularity "day" for ranges longer than 2 weeks to reduce data volume.`,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      site_id: z.number().describe("ID of the site to retrieve. Get this from digipulse_get_overview."),
      from: z.string().optional().describe("Start date inclusive. Format: YYYY-MM-DD. Defaults to 7 days ago."),
      to: z.string().optional().describe("End date inclusive. Format: YYYY-MM-DD. Defaults to today."),
      granularity: z.enum(["hour", "day"]).optional().describe("Aggregation granularity. Use 'day' for ranges longer than 2 weeks. Defaults to 'hour'."),
    },
    outputSchema: {
      site_id: z.number(),
      from: z.string(),
      to: z.string(),
      stats: z.array(z.object({
        timestamp: z.string(),
        avg_response_time: z.number(),
        uptime_percentage: z.number(),
        count: z.number(),
      })),
      incidents: z.array(z.object({
        checked_at: z.string(),
        response_time_ms: z.number().nullable(),
        error: z.string().nullable(),
      })),
    },
  }, async ({ site_id, from, to, granularity }) => {
    try {
      const params: Record<string, string> = {};
      if (from) params.from = from;
      if (to) params.to = to;
      if (granularity) params.granularity = granularity;
      const response = await apiClient.get(`/mcp/sites/${site_id}/history`, { params });
      return {
        content: [{ type: "text", text: JSON.stringify(response.data.data, null, 2) }],
        structuredContent: response.data.data,
      };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
  });

  server.registerTool("digipulse_get_incidents", {
    title: "Get Incidents",
    description: `Returns a paginated cross-site list of downtime incidents sorted newest-first. Each incident includes the affected site name, project, timestamp, response time, and error message.

Use this to answer questions like:
- "What went down this week?"
- "Show all incidents for project X"
- "How many outages did site Y have last month?"

Defaults to the last 7 days with a limit of 50 items.`,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      project_id: z.number().optional().describe("Optional. Filter to incidents within a specific project."),
      site_id: z.number().optional().describe("Optional. Filter to incidents for a specific site."),
      from: z.string().optional().describe("Start date inclusive. Format: YYYY-MM-DD. Defaults to 7 days ago."),
      to: z.string().optional().describe("End date inclusive. Format: YYYY-MM-DD. Defaults to today."),
      limit: z.number().min(1).max(200).optional().describe("Maximum number of incidents to return. Default 50, max 200."),
      offset: z.number().min(0).optional().describe("Pagination offset. Default 0."),
    },
    outputSchema: {
      incidents: z.array(z.object({
        site_id: z.number(),
        site_name: z.string().nullable(),
        site_url: z.string().nullable(),
        project_id: z.number().nullable(),
        checked_at: z.string(),
        response_time_ms: z.number().nullable(),
        error: z.string().nullable(),
      })),
      total: z.number(),
    },
  }, async ({ project_id, site_id, from, to, limit, offset }) => {
    try {
      const params: Record<string, string | number> = {};
      if (project_id) params.project_id = project_id;
      if (site_id) params.site_id = site_id;
      if (from) params.from = from;
      if (to) params.to = to;
      if (limit) params.limit = limit;
      if (offset) params.offset = offset;
      const response = await apiClient.get("/mcp/incidents", { params });
      return {
        content: [{ type: "text", text: JSON.stringify(response.data.data, null, 2) }],
        structuredContent: response.data.data,
      };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
  });

  server.registerResource(
    "site-details",
    new ResourceTemplate("digipulse://sites/{id}", { list: undefined }),
    { title: "Site Details", description: "Full site details by ID" },
    async (uri, params) => {
      const id = (params as any).id;
      try {
        const response = await apiClient.get(`/sites/${id}`);
        return {
          contents: [{ uri: uri.href, text: JSON.stringify(response.data.data, null, 2) }]
        };
      } catch (error: any) {
        throw new Error(`Failed to fetch site ${id}: ${error.message}`);
      }
    }
  );

  server.registerPrompt("audit_sites", {
    title: "Audit Sites",
    description: "Generate a complete health audit of all monitored sites",
    argsSchema: {
      projectId: z.string().optional().describe("Optional project ID to filter the audit"),
    },
  }, ({ projectId }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Please run a comprehensive health audit on my DigiPulse monitored sites${projectId ? ` for project ID ${projectId}` : ''}.
First, use the 'digipulse_get_overview' tool to retrieve the current statuses and SSL info.
Then, use 'digipulse_get_incidents' to check recent downtime${projectId ? ` for project_id ${projectId}` : ''}.
Generate a report highlighting:
1. Sites that are currently DOWN.
2. Sites with high latency or SSL issues (expiring soon or invalid).
3. Recent incidents summary.
4. A general infrastructure health score.`
      }
    }]
  }));

  return server;
}

if (USE_HTTP) {
  const { default: express } = await import("express");
  const app = express();
  app.use(express.json());

  const port = parseInt(process.env.PORT!);
  const SESSION_TTL_MS = 30 * 60 * 1000;

  interface Session {
    transport: StreamableHTTPServerTransport;
    lastActivity: number;
  }

  const sessions = new Map<string, Session>();

  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        session.transport.close();
        sessions.delete(id);
      }
    }
  }, 60_000);

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        res.status(404).json({ error: "Session not found or expired" });
        return;
      }
      session.lastActivity = Date.now();
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    let token = req.query.token as string;
    if (!token && req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }
    if (!token) token = process.env.DIGIPULSE_API_TOKEN || "";

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, { transport, lastActivity: Date.now() });
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };

    const server = createServer(token);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }
    session.lastActivity = Date.now();
    await session.transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }
    await session.transport.handleRequest(req, res);
  });

  app.listen(port, () => {
    process.stderr.write(`DigiPulse MCP server (HTTP) running on http://localhost:${port}/mcp\n`);
  });
} else {
  const token = process.env.DIGIPULSE_API_TOKEN || "";
  const server = createServer(token);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
