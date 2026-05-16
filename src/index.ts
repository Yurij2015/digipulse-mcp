import express from "express";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import axios from "axios";
import dotenv from "dotenv";
import { randomUUID } from "crypto";

dotenv.config();

const API_URL = process.env.DIGIPULSE_API_URL || "http://localhost/api/v1";
const FRONTEND_KEY = process.env.DIGIPULSE_FRONTEND_KEY || "digipulse_development_key";

const app = express();
app.use(express.json());
const port = process.env.PORT || 3001;

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface Session {
  transport: StreamableHTTPServerTransport;
  lastActivity: number;
}

const sessions = new Map<string, Session>();

function touchSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (session) session.lastActivity = Date.now();
}

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      session.transport.close();
      sessions.delete(id);
    }
  }
}, 60_000);

function createServerForUser(apiToken: string) {
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

  server.registerTool("digipulse_list_sites", {
    description: "Get all monitored sites",
  }, async () => {
    try {
      const response = await apiClient.get("/sites");
      const sites = response.data.data.map((s: any) => ({
        id: s.id,
        name: s.name,
        url: s.url,
        status: s.status,
        uptime: s.uptime,
        response_time: s.response_time,
        last_checked_at: s.last_checked_at,
        ssl_valid: s.ssl_info?.valid ?? null,
        ssl_expires_at: s.ssl_info?.expires_at ?? null,
        project_id: s.project_id,
      }));
      return { content: [{ type: "text", text: JSON.stringify(sites, null, 2) }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
  });

  server.registerTool("digipulse_list_projects", {
    description: "Get all projects",
  }, async () => {
    try {
      const response = await apiClient.get("/projects");
      const projects = response.data.data.map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        sites_count: p.sites_count,
      }));
      return { content: [{ type: "text", text: JSON.stringify(projects, null, 2) }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
  });

  server.registerTool("digipulse_add_site", {
    description: "Add a new site to monitor",
    inputSchema: {
      name: z.string(),
      url: z.url(),
      project_id: z.number().optional(),
    },
  }, async ({ name, url, project_id }) => {
    try {
      const response = await apiClient.post("/sites", { name, url, project_id });
      return { content: [{ type: "text", text: `Site added: ${JSON.stringify(response.data.data)}` }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
  });

  server.registerResource(
    "site-details",
    new ResourceTemplate("digipulse://sites/{id}", { list: undefined }),
    { description: "Site details by ID" },
    async (uri, params) => {
      const id = (params as any).id;
      try {
        const response = await apiClient.get(`/sites/${id}`);
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify(response.data.data, null, 2)
          }]
        };
      } catch (error: any) {
        throw new Error(`Failed to fetch site ${id}: ${error.message}`);
      }
    }
  );

  server.registerPrompt("audit_sites", {
    description: "Generate a complete health audit of all monitored sites",
    argsSchema: {
      projectId: z.string().optional().describe("Optional project ID to filter the audit"),
    },
  }, ({ projectId }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Please run a comprehensive health audit on my DigiPulse monitored sites ${projectId ? ` for project ID ${projectId}` : ''}.
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

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found or expired" });
      return;
    }
    touchSession(sessionId);
    await session.transport.handleRequest(req, res, req.body);
    return;
  }

  let token = req.query.token as string;
  if (!token && req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token && process.env.DIGIPULSE_API_TOKEN) {
    token = process.env.DIGIPULSE_API_TOKEN;
  }

  if (!token) {
    res.status(401).json({ error: "Unauthorized: Missing API token. Add DIGIPULSE_API_TOKEN to .env for local testing." });
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sid) => {
      sessions.set(sid, { transport, lastActivity: Date.now() });
    },
  });

  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };

  const server = createServerForUser(token);
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const session = sessionId ? sessions.get(sessionId) : undefined;

  if (!session) {
    res.status(404).json({ error: "Session not found or expired" });
    return;
  }

  touchSession(sessionId!);
  await session.transport.handleRequest(req, res);
});

app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const session = sessionId ? sessions.get(sessionId) : undefined;

  if (!session) {
    res.status(404).json({ error: "Session not found or expired" });
    return;
  }

  await session.transport.handleRequest(req, res);
});

app.listen(port);
