# channel-messenger-plugin

This Claude Code plugin provides a channel that bridges Claude Code sessions with a messaging API via WebSocket.

The messaging API source code is available at [dickdavis/channel-messenger](https://github.com/dickdavis/channel-messenger).

## Configuration

When enabling the plugin, you will be prompted for:

- **host** - API base URL (e.g. `https://api.example.com`)
- **token** - Authentication token for the messaging API (stored securely in system keychain)

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
- **reply_to** (optional) - Message ID to reply to

#### Tool - `edit_message`

Edit a previously sent message.

```
Use the edit_message tool to correct the last message
```

Parameters:

- **message_id** (required) - ID of the message to edit
- **text** (required) - New message text
