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
    status: z.string().nullable(),
    uptime: z.number().nullable(),
    response_time: z.number().nullable(),
    last_checked_at: z.string().nullable(),
    ssl_valid: z.boolean().nullable(),
    ssl_expires_at: z.string().nullable(),
    project_id: z.number().nullable(),
  });

  server.registerTool("digipulse_list_sites", {
    title: "List Monitored Sites",
    description: "Get all monitored sites with current status, uptime, response time, and SSL info",
    outputSchema: { sites: z.array(siteSchema) },
  }, async () => {
    try {
      const response = await apiClient.get("/sites");
      const sites = response.data.data.map((s: any) => ({
        id: s.id,
        name: s.name,
        url: s.url,
        status: s.status ?? null,
        uptime: s.uptime ?? null,
        response_time: s.response_time ?? null,
        last_checked_at: s.last_checked_at ?? null,
        ssl_valid: s.ssl_info?.valid ?? null,
        ssl_expires_at: s.ssl_info?.expires_at ?? null,
        project_id: s.project_id ?? null,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(sites, null, 2) }],
        structuredContent: { sites },
      };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
  });

  server.registerTool("digipulse_list_projects", {
    title: "List Projects",
    description: "Get all projects with their site count",
    outputSchema: {
      projects: z.array(z.object({
        id: z.number(),
        name: z.string(),
        description: z.string().nullable(),
        sites_count: z.number(),
      })),
    },
  }, async () => {
    try {
      const response = await apiClient.get("/projects");
      const projects = response.data.data.map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description ?? null,
        sites_count: p.sites_count,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(projects, null, 2) }],
        structuredContent: { projects },
      };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
  });

  server.registerTool("digipulse_get_site_history", {
    title: "Get Site History",
    description: "Get hourly aggregated stats and downtime incidents for a site. Defaults to current week.",
    inputSchema: {
      site_id: z.number(),
      week: z.string().optional().describe("ISO week string, e.g. 2025-W20"),
    },
    outputSchema: {
      stats: z.array(z.object({
        timestamp: z.string(),
        avg_response_time: z.number(),
        uptime_percentage: z.number(),
      })),
      incidents: z.array(z.object({
        checked_at: z.string(),
        response_time_ms: z.number().nullable(),
        error: z.string().nullable(),
      })),
    },
  }, async ({ site_id, week }) => {
    try {
      const params = week ? { week } : {};
      const response = await apiClient.get(`/sites/${site_id}/history`, { params });
      const { stats, incidents } = response.data.data;
      const result = {
        stats: (stats ?? []).map((s: any) => ({
          timestamp: s.timestamp,
          avg_response_time: s.avg_response_time,
          uptime_percentage: s.uptime_percentage,
        })),
        incidents: (incidents ?? []).slice(0, 20).map((i: any) => ({
          checked_at: i.checked_at,
          response_time_ms: i.response_time_ms ?? null,
          error: i.error ?? null,
        })),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
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
First, use the 'digipulse_list_sites' tool to retrieve the current statuses.
Then, generate a report highlighting:
1. Sites that are currently DOWN.
2. Sites with high latency or SSL issues.
3. A general summary of the infrastructure health.`
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
