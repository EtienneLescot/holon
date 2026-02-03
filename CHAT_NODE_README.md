# Chat Node Implementation

This implementation adds an interactive chat node to Holon, as specified in `SPEC_CHAT_NODE.md`.

## Overview

The chat node (`ui.chat`) provides a conversational interface directly in the Holon UI, allowing users to:
- Send messages through an input form
- View message history with timestamps
- Connect to agents or LLMs for interactive conversations
- Export conversation history

## Architecture

### Backend (Python)
- **`core/holon/library/ui_nodes.py`**: Node type resolver for `ui.chat`
- **`core/holon/library/ui_nodes_meta.json`**: Metadata and configuration schema
- **Registry**: Auto-registered in `core/holon/library/__init__.py`

### Extension (TypeScript)
- **`extension/src/chatHandler.ts`**: Handles chat messages and control commands
- **`extension/src/webview.ts`**: Integrated chat handlers into message routing

### UI (React)
- **`ui/src/store/chat.store.ts`**: Zustand store for chat state management
- **`ui/src/components/ChatNode.tsx`**: Main chat node component
- **`ui/src/components/MessageList.tsx`**: Message history display
- **`ui/src/components/MessageItem.tsx`**: Individual message rendering
- **`ui/src/components/ChatStatusBar.tsx`**: Status bar with actions
- **`ui/src/protocol.ts`**: Extended with chat message schemas
- **`ui/src/App.tsx`**: Integrated ChatNode rendering and message handling
- **`ui/src/styles.css`**: Chat node styling

## Usage

### Basic Chat Node

```python
from holon import node, workflow

@node(type="ui.chat", id="spec:chat:main")
class ChatNode:
    """Interactive chat interface."""
    placeholder: str = "Type your message..."
    max_history: int = 50
    auto_scroll: bool = True
    show_timestamps: bool = True
    allow_markdown: bool = True
```

### Chat with Agent (Bidirectional Loop)

```python
from holon import node, workflow, port_map

@node(type="ui.chat", id="spec:chat:main")
class ChatNode:
    placeholder: str = "Ask me anything..."
    max_history: int = 50

@node(type="langchain.agent", id="spec:agent:assistant")
class AgentNode:
    system_prompt: str = "You are a helpful assistant."
    model: str = "gpt-4o"

@workflow
async def main() -> str:
    # User message → Agent
    @port_map
    class ChatToAgent:
        source = (ChatNode, "out.message")
        target = (AgentNode, "in.prompt")
        transform = "$.content"
        target_field = "user"
    
    # Agent response → Chat
    @port_map
    class AgentToChat:
        source = (AgentNode, "out.response")
        target = (ChatNode, "in.message")
    
    return "Chat system active"
```

## Configuration

The chat node supports the following configuration properties:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `placeholder` | string | "Tapez votre message..." | Input field placeholder text |
| `max_history` | int | 50 | Maximum number of messages to display |
| `auto_scroll` | bool | true | Auto-scroll to newest messages |
| `show_timestamps` | bool | true | Show timestamp for each message |
| `allow_markdown` | bool | true | Enable markdown rendering (future) |
| `theme` | string | "default" | Visual theme ("default" \| "minimal" \| "compact") |

## Ports

### Inputs
- **`in.message`** (data, multi): Receives messages from agents/systems to display
- **`in.control`** (control): Receives control commands (clear_history, set_config, pause, resume)

### Outputs
- **`out.message`** (data): Emits user messages as DataEnvelope
- **`out.event`** (control): Emits events (message_sent, message_received, error)

## Message Format (DataEnvelope)

### User Message
```python
DataEnvelope(
    type="message",
    content="Hello, can you help me?",
    contentType="text/plain",
    metadata={
        "role": "user",
        "conversationId": "conv_123"
    },
    origin={"nodeId": "spec:chat:main", "port": "out.message"}
)
```

### Assistant Message
```python
DataEnvelope(
    type="message",
    content="Of course! I'm here to help.",
    contentType="text/plain",
    metadata={
        "role": "assistant",
        "model": "gpt-4o"
    },
    origin={"nodeId": "spec:agent:1", "port": "out.response"}
)
```

## Examples

### 1. Simple Chat Demo
**File**: `core/examples/demo_chat.holon.py`

Standalone chat node for testing the UI without connections.

### 2. Chat with Agent
**File**: `core/examples/chat_agent.holon.py`

Full bidirectional chat system with a LangChain agent.

## Testing

### Python Tests
```bash
cd core
pytest tests/test_chat_node.py -v
```

Tests cover:
- Node resolution with correct ports and props
- Default property values
- DataEnvelope creation for different message types

### Manual UI Testing
1. Open a `.holon.py` file with a chat node
2. The chat node should render in the canvas with:
   - Message history area
   - Input field and send button
   - Status bar with message count
3. Type a message and press Enter or click Send
4. The message should appear in the history
5. If connected to an agent, responses should appear automatically

## UI Features

### Current Implementation
- ✅ Message input with keyboard support (Enter to send)
- ✅ Message history with scrolling
- ✅ Role-based styling (user/assistant/system)
- ✅ Timestamps
- ✅ Message count display
- ✅ Waiting indicator
- ✅ Clear history action
- ✅ Export conversation to JSON
- ✅ Metadata tooltip on messages

### Future Enhancements (Phase 6.3)
- [ ] Persistent history (SQLite/JSON storage)
- [ ] Streaming responses (token-by-token)
- [ ] Markdown rendering (react-markdown)
- [ ] Multi-thread conversations
- [ ] File/image attachments
- [ ] Voice input (speech-to-text)
- [ ] Copy individual messages
- [ ] Regenerate responses

## RPC Protocol

### UI → Extension

**Send Message**:
```typescript
{
  type: "ui.chat.sendMessage",
  nodeId: string,
  envelope: DataEnvelope
}
```

**Control Command**:
```typescript
{
  type: "ui.chat.control",
  nodeId: string,
  action: "clear_history" | "pause" | "resume",
  payload?: any
}
```

### Extension → UI

**Message Received**:
```typescript
{
  type: "chat.messageReceived",
  nodeId: string,
  envelope: DataEnvelope
}
```

**Event**:
```typescript
{
  type: "chat.event",
  nodeId: string,
  event: {
    action: "message_sent" | "message_received" | "error" | "clear_history",
    details?: any
  }
}
```

## Styling

Chat nodes use CSS classes from `ui/src/styles.css`:

- `.chat-node`: Main container
- `.chat-node-header`: Header with icon and label
- `.chat-node-messages`: Scrollable message area
- `.message`: Individual message
- `.message-user`: User message (blue tint)
- `.message-assistant`: Assistant message (green tint)
- `.message-system`: System message (yellow tint)
- `.chat-node-input`: Input area
- `.chat-status-bar`: Bottom status bar

## Limitations

### Current Phase (6.2)
- No persistence: History is lost on reload
- No streaming: Responses arrive in full
- Single conversation: No branching threads
- Text only: No attachments or images
- No markdown: Plain text rendering only

### Known Issues
- Metadata display is basic (hover tooltip only)
- No message editing or deletion yet
- No search within conversation history
- No configurable message styling per role

## Integration Points

### With Agents
The chat node is designed to work seamlessly with:
- `langchain.agent` nodes
- `llm.completion` nodes
- Custom agent implementations

Use `@port_map` to connect:
1. Chat `out.message` → Agent `in.prompt`
2. Agent `out.response` → Chat `in.message`

### With Data Transform
Use JSONPath transforms to extract/shape data:

```python
@port_map
class _:
    source = (ChatNode, "out.message")
    target = (AgentNode, "in.prompt")
    transform = "$.content"  # Extract just the message text
    target_field = "user"     # Map to specific field
```

## Debugging

### Enable Chat Logging
Messages are logged in the extension output channel:

1. View → Output
2. Select "Holon" from dropdown
3. Look for lines like:
   - `ui.chat.sendMessage: spec:chat:main`
   - `ui.chat.control: spec:chat:main action=clear_history`

### Check State
Inspect the chat store in browser dev tools:
```javascript
// In React DevTools console
window.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.get(1).getCurrentFiber()
```

Or check Zustand store directly:
```javascript
// Access store state
const chatStore = require('./store/chat.store').useChatStore;
console.log(chatStore.getState());
```

## Contributing

To extend the chat node:

1. **Add new config options**: Update `ui_nodes.py` and `ui_nodes_meta.json`
2. **Add new message types**: Extend `DataEnvelope` schema in `protocol.ts`
3. **Add UI features**: Update `ChatNode.tsx` or create new components
4. **Add control actions**: Extend `chatHandler.ts` switch statement
5. **Add tests**: Update `test_chat_node.py` and create UI component tests

## References

- **Specification**: `SPEC_CHAT_NODE.md`
- **Data Transport**: `SPEC_DATA_TRANSPORT.md` (DataEnvelope, @port_map)
- **Node Types**: `core/holon/REGISTRY_README.md`
- **Execution**: `core/holon/RUNNER_README.md`
