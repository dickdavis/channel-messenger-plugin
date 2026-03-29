const file = Bun.file('.mcp.json')
const content = await file.text()

try {
  const parsed = JSON.parse(content)
  const formatted = JSON.stringify(parsed, null, 2) + '\n'
  if (content !== formatted) {
    console.error('.mcp.json: not formatted correctly')
    process.exit(1)
  }
} catch (err) {
  console.error(`.mcp.json: invalid JSON - ${(err as Error).message}`)
  process.exit(1)
}

console.log('.mcp.json: valid')
