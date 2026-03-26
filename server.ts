#!/usr/bin/env bun

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const HOST =
  process.env.MESSENGER_HOST || process.env.CLAUDE_PLUGIN_OPTION_HOST;
const TOKEN =
  process.env.MESSENGER_TOKEN || process.env.CLAUDE_PLUGIN_OPTION_TOKEN;

if (!HOST || !TOKEN) {
  console.error(
    "Host and token must be set via MESSENGER_HOST/MESSENGER_TOKEN or plugin userConfig"
  );
  process.exit(1);
}

let sessionId: number;
let ws: WebSocket | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30_000;

// --- Session registration ---

async function registerSession(): Promise<{ id: number; name: string }> {
  const res = await fetch(`${HOST}/api/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "claude-code" }),
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
    ws!.send(JSON.stringify({ type: "auth", token: TOKEN }));
  });

  ws.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(String(event.data));
      if (data.type === "message") {
        deliverToChannel(data.message);
      }
    } catch {
      // ignore malformed messages
    }
  });

  ws.addEventListener("close", () => scheduleReconnect());
  ws.addEventListener("error", () => {
    ws?.close();
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
    typeof message.text === "string"
      ? message.text
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
      experimental: { "claude/channel": {} },
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
          reply_to: {
            type: "string",
            description: "Optional message ID to reply to",
          },
        },
        required: ["text"],
      },
    },
    {
      name: "edit_message",
      description: "Edit a previously sent message",
      inputSchema: {
        type: "object" as const,
        properties: {
          message_id: {
            type: "string",
            description: "ID of the message to edit",
          },
          text: { type: "string", description: "New message text" },
        },
        required: ["message_id", "text"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  switch (name) {
    case "reply": {
      const { text, reply_to } = args as { text: string; reply_to?: string };
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return {
          content: [{ type: "text", text: "Error: WebSocket not connected" }],
          isError: true,
        };
      }
      ws.send(
        JSON.stringify({
          type: "message",
          text,
          ...(reply_to ? { reply_to } : {}),
        })
      );
      return { content: [{ type: "text", text: "Message sent" }] };
    }

    case "edit_message": {
      const { message_id, text } = args as {
        message_id: string;
        text: string;
      };
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return {
          content: [{ type: "text", text: "Error: WebSocket not connected" }],
          isError: true,
        };
      }
      ws.send(JSON.stringify({ type: "edit", message_id, text }));
      return { content: [{ type: "text", text: "Message edited" }] };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

// --- Startup ---

async function main() {
  const session = await registerSession();
  sessionId = session.id;

  connectWebSocket();
  await mcp.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
