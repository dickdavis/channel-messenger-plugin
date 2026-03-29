# channel-messenger-plugin

This Claude Code plugin provides a channel that bridges Claude Code sessions with a messaging API via WebSocket.

The messaging API source code is available at [dickdavis/channel-messenger](https://github.com/dickdavis/channel-messenger).

## Setup

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

### 2. Install the plugin

#### From the marketplace

Installing from the marketplace is not possible during the research preview.

#### Local development (Research Preview)

Clone the repository and install dependencies:

```bash
cd /path/to/channel-messenger-plugin
bun install
```

Export the plugin root so Claude Code can locate the channel:

```bash
export CLAUDE_PLUGIN_ROOT=/path/to/channel-messenger-plugin
```

Register the MCP server globally so it can be loaded from any project:

```bash
claude mcp add messenger -s user -- bun run --cwd /path/to/channel-messenger-plugin server.ts
```

> **Note:** The MCP server maintains a persistent WebSocket connection. If your OS suspends the process when the computer locks or sleeps, the connection will drop. Take measures to prevent this — for example, use tools like [tmux](https://github.com/tmux/tmux) with [tmuxinator](https://github.com/tmuxinator/tmuxinator) to run `caffeinate` on project start:
>
> ```yaml
> # Runs on project start, always
> on_project_start: caffeinate -i &
> ```

### 3. Launch Claude Code with the channel

From any project directory:

```bash
claude --dangerously-load-development-channels server:messenger
```

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

### Permissions

The plugin supports remote permission handling. When Claude Code needs approval to use a tool, the plugin forwards the permission request to the messaging API over WebSocket. The remote user can then allow or deny the request.

- If the remote user **allows** the request, Claude proceeds with the tool call.
- If the remote user **denies** the request, Claude is informed and will not proceed.
- If the WebSocket is **disconnected** when a permission request arrives, or disconnects while requests are pending, those requests are automatically denied.

