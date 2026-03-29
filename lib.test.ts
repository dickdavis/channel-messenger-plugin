import { describe, expect, mock, test } from 'bun:test'
import { parseEnvFile, buildWsUrl, formatMessage, registerSession } from './lib'

describe('parseEnvFile', () => {
  test('parses key=value pairs', () => {
    const result = parseEnvFile('FOO=bar\nBAZ=qux')
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  test('skips blank lines', () => {
    const result = parseEnvFile('FOO=bar\n\nBAZ=qux\n')
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  test('skips comments', () => {
    const result = parseEnvFile('# this is a comment\nFOO=bar')
    expect(result).toEqual({ FOO: 'bar' })
  })

  test('handles values with equals signs', () => {
    const result = parseEnvFile('URL=http://example.com?a=1')
    expect(result).toEqual({ URL: 'http://example.com?a=1' })
  })

  test('returns empty object for empty string', () => {
    expect(parseEnvFile('')).toEqual({})
  })
})

describe('buildWsUrl', () => {
  test('converts http to ws', () => {
    expect(buildWsUrl('http://localhost:3000', 42))
      .toBe('ws://localhost:3000/api/ws/sessions/42')
  })

  test('converts https to wss', () => {
    expect(buildWsUrl('https://example.com', 1))
      .toBe('wss://example.com/api/ws/sessions/1')
  })
})

describe('formatMessage', () => {
  test('passes through string content', () => {
    const result = formatMessage({ content: 'hello' }, 1)
    expect(result.content).toBe('hello')
  })

  test('JSON-stringifies non-string content', () => {
    const msg = { data: 123 }
    const result = formatMessage(msg, 1)
    expect(result.content).toBe(JSON.stringify(msg))
  })

  test('sets chat_id from sessionId', () => {
    const result = formatMessage({ content: 'hi' }, 42)
    expect(result.meta.chat_id).toBe('42')
  })

  test('uses message.id for message_id when present', () => {
    const result = formatMessage({ content: 'hi', id: 99 }, 1)
    expect(result.meta.message_id).toBe('99')
  })

  test('generates UUID for message_id when id is missing', () => {
    const result = formatMessage({ content: 'hi' }, 1)
    expect(result.meta.message_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })

  test('uses message.from for user when present', () => {
    const result = formatMessage({ content: 'hi', from: 'alice' }, 1)
    expect(result.meta.user).toBe('alice')
  })

  test('defaults user to api when from is missing', () => {
    const result = formatMessage({ content: 'hi' }, 1)
    expect(result.meta.user).toBe('api')
  })

  test('sets ts as ISO string', () => {
    const result = formatMessage({ content: 'hi' }, 1)
    expect(new Date(result.meta.ts).toISOString()).toBe(result.meta.ts)
  })
})

describe('registerSession', () => {
  test('sends POST with auth header and returns session', async () => {
    const mockFetch = mock(async () =>
      new Response(JSON.stringify({ id: 1, name: 'test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    ) as unknown as typeof fetch
    globalThis.fetch = mockFetch

    const session = await registerSession('http://localhost:3000', 'my-token')

    expect(session).toEqual({ id: 1, name: 'test' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  test('throws on non-ok response', async () => {
    globalThis.fetch = mock(async () =>
      new Response('not found', { status: 404 })
    ) as unknown as typeof fetch

    await expect(registerSession('http://localhost:3000', 'bad-token'))
      .rejects.toThrow('Session registration failed: 404')
  })
})
