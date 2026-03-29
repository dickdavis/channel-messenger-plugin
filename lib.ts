export function parseEnvFile (content: string): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const m = line.match(/^(\w+)=(.*)$/)
    if (m != null) {
      const key = m[1] as string
      const value = m[2] as string
      vars[key] = value
    }
  }
  return vars
}

export function buildWsUrl (host: string, sessionId: number): string {
  return `${host.replace(/^http/, 'ws')}/api/ws/sessions/${String(sessionId)}`
}

export interface ChannelMeta {
  chat_id: string
  message_id: string
  user: string
  ts: string
}

export interface ChannelNotification {
  content: string
  meta: ChannelMeta
}

export function formatMessage (
  message: Record<string, unknown>,
  sessionId: number
): ChannelNotification {
  const content =
    typeof message.content === 'string'
      ? message.content
      : JSON.stringify(message)

  return {
    content,
    meta: {
      chat_id: String(sessionId),
      message_id: String(message.id ?? crypto.randomUUID()),
      user: String(message.from ?? 'api'),
      ts: new Date().toISOString()
    }
  }
}

export async function registerSession (
  host: string,
  token: string
): Promise<{ id: number, name: string }> {
  const res = await fetch(`${host}/api/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  })
  if (!res.ok) {
    throw new Error(`Session registration failed: ${res.status.toString()} ${await res.text()}`)
  }
  return await res.json() as { id: number, name: string }
}
