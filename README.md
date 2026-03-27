# channel-messenger-plugin

This Claude Code plugin provides a channel that bridges Claude Code sessions with a messaging API via WebSocket.

The messaging API source code is available at [dickdavis/channel-messenger](https://github.com/dickdavis/channel-messenger).

## Setup (Research Preview)

During the research preview, plugins cannot be loaded from marketplaces. Follow these steps to set up the plugin for local development and testing.

### 1. Configure environment variables

The server reads `CHANNEL_MESSENGER_HOST` and `CHANNEL_MESSENGER_TOKEN` from the environment, falling back to `~/.claude/channels/messenger/.env`.

Create the `.env` file:

```bash
mkdir -p ~/.claude/channels/messenger
cat > ~/.claude/channels/messenger/.env << 'EOF'
CHANNEL_MESSENGER_HOST=http://localhost:3000
CHANNEL_MESSENGER_TOKEN=your-token-here
EOF
chmod 600 ~/.claude/channels/messenger/.env
```

Replace the values with your actual API host and token.

### 2. Install dependencies

```bash
cd /path/to/channel-messenger-plugin
bun install
```

### 3. Launch Claude Code with the channel

From the plugin project directory:

```bash
cd /path/to/channel-messenger-plugin
claude --dangerously-load-development-channels server:messenger
```

The `server:messenger` flag references the `messenger` MCP server defined in the project's `.mcp.json`. You must run this command from the plugin's project directory.

## Usage

Once enabled, the plugin automatically:

1. Registers a new session with the messaging API
2. Connects via WebSocket to receive messages in real-time
3. Delivers incoming messages to Claude as channel notifications

### Receiving messages

Incoming messages appear as `<channel source="messenger">` notifications in your Claude Code session. Claude will see the message content along with metadata like `chat_id`, `message_id`, and sender info.

### Sending messages

#### Tool - `reply`

Send a message back through the messenger channel.

```
Use the reply tool to respond to the latest message
```

Parameters:

- **text** (required) - Message text to send

