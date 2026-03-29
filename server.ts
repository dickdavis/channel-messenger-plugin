#!/usr/bin/env bun

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { appendFileSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const STATE_DIR = join(homedir(), ".claude", "channels", "messenger");
const ENV_FILE = join(STATE_DIR, ".env");
const LOG_PATH = "/tmp/messenger-plugin.log";

function log(msg: string) {
  appendFileSync(LOG_PATH, `${new Date().toISOString()} ${msg}\n`);
}

// Load .env fallback for vars not already in process.env
try {
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {
  // .env file doesn't exist yet — that's fine if env vars are set
}

const HOST = process.env.CHANNEL_MESSENGER_HOST;
const TOKEN = process.env.CHANNEL_MESSENGER_TOKEN;

if (!HOST || !TOKEN) {
  log(
    `CHANNEL_MESSENGER_HOST and CHANNEL_MESSENGER_TOKEN must be set via environment or ${ENV_FILE}`
  );
  process.exit(1);
}

let sessionId: number;
let ws: WebSocket | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30_000;
let pingInterval: ReturnType<typeof setInterval> | null = null;

interface PendingPermission {
  tool_name: string;
  description: string;
  input_preview: string;
}

const pendingPermissions = new Map<string, PendingPermission>();

// --- Session registration ---

async function registerSession(): Promise<{ id: number; name: string }> {
  const res = await fetch(`${HOST}/api/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw new Error(`Session registration failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<{ id: number; name: string }>;
}

// --- WebSocket ---

function connectWebSocket() {
  const url = `${HOST!.replace(/^http/, "ws")}/api/ws/sessions/${sessionId}`;
  ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    reconnectDelay = 1000;
    log(`[messenger] WebSocket connected to session ${sessionId}`);
    ws!.send(JSON.stringify({ type: "auth", token: TOKEN }));

    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30_000);
  });

  ws.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(String(event.data));
      log(`[messenger] WS received: ${JSON.stringify(data)}`);
      if (data.type === "permission_response") {
        handlePermissionResponse(data.request_id, data.behavior);
      } else if (data.type === "message" && data.message?.role !== "assistant") {
        deliverToChannel(data.message);
      }
    } catch {
      log(`[messenger] WS malformed message: ${event.data}`);
    }
  });

  ws.addEventListener("close", (event) => {
    log(`[messenger] WS closed: code=${event.code} reason=${event.reason}`);
    if (pingInterval) clearInterval(pingInterval);

    for (const [requestId] of pendingPermissions) {
      log(`[messenger] Auto-denying permission ${requestId} due to WS disconnect`);
      void mcp.notification({
        method: "notifications/claude/channel/permission",
        params: { request_id: requestId, behavior: "deny" },
      });
    }
    pendingPermissions.clear();

    scheduleReconnect();
  });
  ws.addEventListener("error", (event) => {
    log(`[messenger] WS error:`, event);
    ws?.close();
  });
}

function handlePermissionResponse(requestId: string, behavior: "allow" | "deny") {
  if (!pendingPermissions.has(requestId)) {
    log(`[messenger] Ignoring permission response for unknown request: ${requestId}`);
    return;
  }

  pendingPermissions.delete(requestId);
  log(`[messenger] Permission ${behavior} for ${requestId}`);

  void mcp.notification({
    method: "notifications/claude/channel/permission",
    params: { request_id: requestId, behavior },
  });
}

function scheduleReconnect() {
  setTimeout(() => {
    connectWebSocket();
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }, reconnectDelay);
}

function deliverToChannel(message: Record<string, unknown>) {
  const content =
    typeof message.content === "string"
      ? message.content
      : JSON.stringify(message);

  void mcp.notification({
    method: "notifications/claude/channel",
    params: {
      content,
      meta: {
        chat_id: String(sessionId),
        message_id: String(message.id ?? crypto.randomUUID()),
        user: String(message.from ?? "api"),
        ts: new Date().toISOString(),
      },
    },
  });
}

// --- MCP server ---

const mcp = new Server(
  { name: "messenger", version: "0.1.0" },
  {
    capabilities: {
      tools: {},
      experimental: {
        "claude/channel": {},
        "claude/channel/permission": {},
      },
    },
    instructions: [
      "You are connected to a messaging channel via the messenger plugin.",
      "When you receive a <channel source=\"messenger\"> notification, a user has sent you a message.",
      "Use the `reply` tool to respond. Always include the chat_id from the notification.",
    ].join(" "),
  }
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description: "Send a message back through the messenger channel",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: { type: "string", description: "Message text to send" },
        },
        required: ["text"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  switch (name) {
    case "reply": {
      const { text } = args as { text: string };
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return {
          content: [{ type: "text", text: "Error: WebSocket not connected" }],
          isError: true,
        };
      }
      const payload = JSON.stringify({
        type: "message",
        content: text,
      });
      log(`[messenger] Sending: ${payload} (ws.readyState=${ws.readyState})`);
      ws.send(payload);
      return { content: [{ type: "text", text: "Message sent" }] };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

mcp.fallbackNotificationHandler = async (notification) => {
  if (notification.method === "notifications/claude/channel/permission_request") {
    const { request_id, tool_name, description, input_preview } = notification.params as {
      request_id: string;
      tool_name: string;
      description: string;
      input_preview: string;
    };

    log(`[messenger] Permission request: ${request_id} for ${tool_name}`);

    pendingPermissions.set(request_id, { tool_name, description, input_preview });

    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "permission_request",
        request_id,
        tool_name,
        description,
        input_preview,
      }));
    } else {
      log(`[messenger] WS not connected, auto-denying permission ${request_id}`);
      void mcp.notification({
        method: "notifications/claude/channel/permission",
        params: { request_id, behavior: "deny" },
      });
      pendingPermissions.delete(request_id);
    }
  }
};

// --- Startup ---

process.on("unhandledRejection", (err) => {
  log(`[messenger] Unhandled rejection: ${err}`);
});
process.on("uncaughtException", (err) => {
  log(`[messenger] Uncaught exception: ${err}`);
});

async function main() {
  const session = await registerSession();
  sessionId = session.id;
  log(`[messenger] Session registered: ${session.id}`);

  connectWebSocket();
  await mcp.connect(new StdioServerTransport());
}

main().catch((err) => {
  log(`[messenger] Fatal: ${err}`);
  process.exit(1);
});
