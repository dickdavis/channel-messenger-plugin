#!/usr/bin/env bun

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'

import { appendFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

import { parseEnvFile, buildWsUrl, formatMessage, registerSession } from './lib'

const STATE_DIR = join(homedir(), '.claude', 'channels', 'messenger')
const ENV_FILE = join(STATE_DIR, '.env')
const LOG_PATH = '/tmp/messenger-plugin.log'

function log (msg: string): void {
  appendFileSync(LOG_PATH, `${new Date().toISOString()} ${msg}\n`)
}

// Load .env fallback for vars not already in process.env
try {
  const vars = parseEnvFile(readFileSync(ENV_FILE, 'utf8'))
  for (const [key, value] of Object.entries(vars)) {
    if (process.env[key] === undefined) process.env[key] = value
  }
} catch {
  // .env file doesn't exist yet — that's fine if env vars are set
}

const envHost = process.env.CHANNEL_MESSENGER_HOST
const envToken = process.env.CHANNEL_MESSENGER_TOKEN

if (envHost == null || envHost === '' || envToken == null || envToken === '') {
  log(
    `CHANNEL_MESSENGER_HOST and CHANNEL_MESSENGER_TOKEN must be set via environment or ${ENV_FILE}`
  )
  process.exit(1)
}

const HOST: string = envHost
const TOKEN: string = envToken

let sessionId: number
let ws: WebSocket | null = null
let reconnectDelay = 1000
const MAX_RECONNECT_DELAY = 30_000
let pingInterval: ReturnType<typeof setInterval> | null = null

interface PendingPermission {
  tool_name: string
  description: string
  input_preview: string
}

const pendingPermissions = new Map<string, PendingPermission>()

// --- WebSocket ---

function connectWebSocket (): void {
  const url = buildWsUrl(HOST, sessionId)
  ws = new WebSocket(url)

  ws.addEventListener('open', () => {
    reconnectDelay = 1000
    log(`[messenger] WebSocket connected to session ${String(sessionId)}`)
    if (ws != null) ws.send(JSON.stringify({ type: 'auth', token: TOKEN }))

    if (pingInterval != null) clearInterval(pingInterval)
    pingInterval = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30_000)
  })

  ws.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(String(event.data))
      log(`[messenger] WS received: ${JSON.stringify(data)}`)
      if (data.type === 'permission_response') {
        handlePermissionResponse(data.request_id, data.behavior)
      } else if (data.type === 'message' && data.message?.role !== 'assistant') {
        deliverToChannel(data.message)
      }
    } catch {
      log(`[messenger] WS malformed message: ${String(event.data)}`)
    }
  })

  ws.addEventListener('close', (event) => {
    log(`[messenger] WS closed: code=${String(event.code)} reason=${event.reason}`)
    if (pingInterval != null) clearInterval(pingInterval)

    for (const [requestId] of pendingPermissions) {
      log(`[messenger] Auto-denying permission ${requestId} due to WS disconnect`)
      void mcp.notification({
        method: 'notifications/claude/channel/permission',
        params: { request_id: requestId, behavior: 'deny' }
      })
    }
    pendingPermissions.clear()

    scheduleReconnect()
  })
  ws.addEventListener('error', (event) => {
    log(`[messenger] WS error: ${String(event)}`)
    ws?.close()
  })
}

function handlePermissionResponse (requestId: string, behavior: 'allow' | 'deny'): void {
  if (!pendingPermissions.has(requestId)) {
    log(`[messenger] Ignoring permission response for unknown request: ${requestId}`)
    return
  }

  pendingPermissions.delete(requestId)
  log(`[messenger] Permission ${behavior} for ${requestId}`)

  void mcp.notification({
    method: 'notifications/claude/channel/permission',
    params: { request_id: requestId, behavior }
  })
}

function scheduleReconnect (): void {
  setTimeout(() => {
    connectWebSocket()
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY)
  }, reconnectDelay)
}

function deliverToChannel (message: Record<string, unknown>): void {
  const { content, meta } = formatMessage(message, sessionId)

  void mcp.notification({
    method: 'notifications/claude/channel',
    params: { content, meta }
  })
}

// --- MCP server ---

const mcp = new Server(
  { name: 'messenger', version: '0.1.0' },
  {
    capabilities: {
      tools: {},
      experimental: {
        'claude/channel': {},
        'claude/channel/permission': {}
      }
    },
    instructions: [
      'You are connected to a messaging channel via the messenger plugin.',
      'When you receive a <channel source="messenger"> notification, a user has sent you a message.',
      'Use the `reply` tool to respond. Always include the chat_id from the notification.'
    ].join(' ')
  }
)

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Send a message back through the messenger channel',
      inputSchema: {
        type: 'object' as const,
        properties: {
          text: { type: 'string', description: 'Message text to send' }
        },
        required: ['text']
      }
    }
  ]
}))

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params

  switch (name) {
    case 'reply': {
      const { text } = args as { text: string }
      if (ws == null || ws.readyState !== WebSocket.OPEN) {
        return {
          content: [{ type: 'text', text: 'Error: WebSocket not connected' }],
          isError: true
        }
      }
      const payload = JSON.stringify({
        type: 'message',
        content: text
      })
      log(`[messenger] Sending: ${payload} (ws.readyState=${String(ws.readyState)})`)
      ws.send(payload)
      return { content: [{ type: 'text', text: 'Message sent' }] }
    }

    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true
      }
  }
})

mcp.fallbackNotificationHandler = async (notification) => {
  if (notification.method === 'notifications/claude/channel/permission_request') {
    const params = notification.params as {
      request_id: string
      tool_name: string
      description: string
      input_preview: string
    }

    const requestId = params.request_id
    const toolName = params.tool_name
    const { description } = params
    const inputPreview = params.input_preview

    log(`[messenger] Permission request: ${requestId} for ${toolName}`)

    pendingPermissions.set(requestId, {
      tool_name: toolName,
      description,
      input_preview: inputPreview
    })

    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'permission_request',
        request_id: requestId,
        tool_name: toolName,
        description,
        input_preview: inputPreview
      }))
    } else {
      log(`[messenger] WS not connected, auto-denying permission ${requestId}`)
      void mcp.notification({
        method: 'notifications/claude/channel/permission',
        params: { request_id: requestId, behavior: 'deny' }
      })
      pendingPermissions.delete(requestId)
    }
  }
}

// --- Startup ---

process.on('unhandledRejection', (err) => {
  log(`[messenger] Unhandled rejection: ${String(err)}`)
})
process.on('uncaughtException', (err) => {
  log(`[messenger] Uncaught exception: ${err.message}`)
})

async function main (): Promise<void> {
  const session = await registerSession(HOST, TOKEN)
  sessionId = session.id
  log(`[messenger] Session registered: ${String(session.id)}`)

  connectWebSocket()
  await mcp.connect(new StdioServerTransport())
}

main().catch((err: Error) => {
  log(`[messenger] Fatal: ${err.message}`)
  process.exit(1)
})
