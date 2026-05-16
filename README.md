# DigiPulse MCP Agent Integration Guide

This document describes how to connect an AI Agent (like Claude Desktop or Cursor) to your DigiPulse account using the Model Context Protocol (MCP).

## Architecture

DigiPulse uses a **Remote SSE (Server-Sent Events)** architecture for MCP. 
This means the entire MCP server runs on DigiPulse's infrastructure. You don't need to download or execute any third-party scripts locally on your machine. Your AI assistant simply makes secure HTTP requests to our server.

## How to Connect

To connect, you need two things:
1. **DigiPulse MCP Server URL:** `https://mcp.digi-pulse.com/sse` (replace with the actual production domain).
2. **Your Personal API Token:** You can generate this in your DigiPulse profile under `Settings -> API Keys`.

### 1. Connecting via Cursor IDE

If you are using Cursor:
1. Open `Cursor Settings` -> `Features` -> `MCP Servers`.
2. Click `+ Add New MCP Server`.
3. Select Type: **SSE**.
4. Name: `DigiPulse`.
5. URL: `https://mcp.digi-pulse.com/sse?token=YOUR_API_TOKEN`.
6. Click Save. Cursor now has access to your monitoring data!

### 2. Connecting via Claude Desktop

Currently, the Claude Desktop application requires a local command in its configuration to bridge to remote servers. You will need to add a short JSON snippet to your configuration file.

Open your Claude configuration file (via `Developer` -> `Edit Config`):

**Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the following configuration:

```json
{
  "mcpServers": {
    "digipulse": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-proxy", 
        "https://mcp.digi-pulse.com/sse?token=YOUR_API_TOKEN"
      ]
    }
  }
}
```

*Note: This configuration uses the community standard `mcp-proxy` utility, which acts as a lightweight local tunnel connecting Claude to our remote server. No business logic or API keys are stored locally.*

## What can the Agent do?

Once connected, you can ask your agent:
- *"What is the current status of my monitored sites in DigiPulse?"*
- *"List all my projects."*
- *"Add the site https://example.com to my monitoring list under project X."*

The agent will automatically select the right tool, authenticate using your token, fetch the data, and present the results in a human-readable format.
