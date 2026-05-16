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
      console.log(`[~] Session expired (Session: ${id})`);
    }
  }
}, 60_000);

// Helper to create a user-specific server instance
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

  server.tool("digipulse_list_sites", "Get all monitored sites", {}, async () => {
    try {
      const response = await apiClient.get("/sites");
      return { content: [{ type: "text", text: JSON.stringify(response.data.data, null, 2) }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
  });

  server.tool("digipulse_list_projects", "Get all projects", {}, async () => {
    try {
      const response = await apiClient.get("/projects");
      return { content: [{ type: "text", text: JSON.stringify(response.data.data, null, 2) }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
  });

  server.tool("digipulse_add_site", "Add a new site to monitor", {
    name: z.string(),
    url: z.string().url(),
    project_id: z.number().optional(),
  }, async ({ name, url, project_id }) => {
    try {
      const response = await apiClient.post("/sites", { name, url, project_id });
      return { content: [{ type: "text", text: `Site added: ${JSON.stringify(response.data.data)}` }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
  });

  // ==========================================
  // RESOURCES
  // ==========================================
  server.resource(
    "site-details",
    new ResourceTemplate("digipulse://sites/{id}", { list: undefined }),
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

  // ==========================================
  // PROMPTS
  // ==========================================
  server.prompt(
    "audit_sites",
    "Generate a complete health audit of all monitored sites",
    {
      projectId: z.string().optional().describe("Optional project ID to filter the audit"),
    },
    ({ projectId }) => ({
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
    })
  );

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
      console.log(`[+] New MCP session established (Session: ${sid})`);
    },
  });

  transport.onclose = () => {
    if (transport.sessionId) {
      sessions.delete(transport.sessionId);
      console.log(`[-] MCP session closed (Session: ${transport.sessionId})`);
    }
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

app.listen(port, () => {
  console.log(`DigiPulse MCP Server running on http://localhost:${port}`);
  console.log(`Connect clients to http://localhost:${port}/mcp`);
});
