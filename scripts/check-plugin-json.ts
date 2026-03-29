const file = Bun.file('.claude-plugin/plugin.json')
const content = await file.text()

try {
  const parsed = JSON.parse(content)
  const formatted = JSON.stringify(parsed, null, 2) + '\n'
  if (content !== formatted) {
    console.error('.claude-plugin/plugin.json: not formatted correctly')
    process.exit(1)
  }
} catch (err) {
  console.error(`.claude-plugin/plugin.json: invalid JSON - ${(err as Error).message}`)
  process.exit(1)
}

console.log('.claude-plugin/plugin.json: valid')
