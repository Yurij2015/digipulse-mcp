import express from "express";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import axios from "axios";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const API_URL = process.env.DIGIPULSE_API_URL || "http://localhost/api/v1";
const FRONTEND_KEY = process.env.DIGIPULSE_FRONTEND_KEY || "digipulse_development_key";

const app = express();
const port = process.env.PORT || 3001;

// Map to store active transports per session
const transports = new Map<string, SSEServerTransport>();

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

// SSE Connection Endpoint
app.get("/sse", async (req, res) => {
  // Extract token from Authorization header or query param
  let token = req.query.token as string;
  if (!token && req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    res.status(401).send("Unauthorized: Missing API token. Please provide ?token=...");
    return;
  }

  const sessionId = crypto.randomUUID();
  const transport = new SSEServerTransport(`/message?sessionId=${sessionId}`, res);
  
  transports.set(sessionId, transport);

  const server = createServerForUser(token);
  await server.connect(transport);

  console.log(`[+] New SSE connection established (Session: ${sessionId})`);

  // Clean up when client disconnects
  req.on("close", () => {
    console.log(`[-] SSE connection closed (Session: ${sessionId})`);
    transports.delete(sessionId);
  });
});

// Messages Endpoint
app.post("/message", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);

  if (!transport) {
    res.status(404).send("Session not found or expired.");
    return;
  }

  await transport.handlePostMessage(req, res);
});

app.listen(port, () => {
  console.log(`DigiPulse MCP Server (SSE) running on http://localhost:${port}`);
  console.log(`Connect clients to http://localhost:${port}/sse?token=<API_TOKEN>`);
});
