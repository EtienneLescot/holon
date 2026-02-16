# Data References - Implementation Guide

**Date**: 2026-02-03  
**Status**: Implemented  
**Feature**: Data Browser & Template References

## Overview

This document describes the **Data References** feature, which is distinct from Port Mappings (@port_map).

### Two Complementary Systems

| Feature | Purpose | Syntax | When |
|---------|---------|--------|------|
| **Port Mappings** | Define execution order & data flow | `@port_map` decorator | Graph structure |
| **Data References** | Inject values into properties | `{{node.field}}` | Authoring time |

### Key Difference

```python
# Port Mapping - defines HOW data flows and transforms
@port_map
class ChatToAgent:
    source = (chat_node, "output")
    target = (agent_node, "input")
    transform = "$.data.message"  # JSONPath extraction
    on_error = "stop"

# Data Reference - injects VALUE into a property
@node(type="langchain.agent")
class MyAgent:
    system_prompt = "You are helpful"
    user_prompt = "{{chat_node.data.message}}"  # Template reference
```

**Port Mapping** = Edge on canvas, defines dependencies  
**Data Reference** = Value in node property, injected at execution

## User Flow

### 1. Authoring Phase (UI)

1. User selects a node → ConfigPanel opens
2. For each text field, there's a "🔗 Map" button
3. Click button → DataBrowserModal opens
4. Modal shows:
   - List of upstream nodes (connected via edges)
   - Available output fields for each node
   - Type hints and descriptions
5. User clicks a field
6. UI inserts `{{node_id.field.path}}` at cursor position
7. Reference is saved in node props

### 2. Execution Phase (Backend)

1. Engine resolves `{{...}}` templates before node execution
2. Looks up referenced node's output from previous execution
3. Extracts field using path (e.g., `data.message`)
4. Replaces template with actual value
5. Passes resolved props to node function

## Discovery Strategies

The DataBrowserModal uses multiple strategies to determine available fields:

### Strategy 1: Output Port Schemas

```typescript
const outputPorts = node.ports?.filter((p) => p.direction === 'output');
outputPorts.forEach((port) => {
  fields.push({
    path: `${nodeId}.${port.id}`,
    type: port.kind,
    description: port.label,
  });
});
```

### Strategy 2: Structured Output (Pydantic)

For nodes with `structured_output` prop:

```python
@node(type="langchain.agent")
class MyAgent:
    structured_output = json.dumps({
        "type": "object",
        "properties": {
            "content": {"type": "string", "description": "Message text"},
            "role": {"type": "string", "description": "Speaker role"},
        }
    })
```

UI parses this and extracts fields:
- `my_agent.content` (string) - Message text
- `my_agent.role` (string) - Speaker role

### Strategy 3: Heuristic Fallbacks

Based on node type, assume common fields:

```typescript
if (nodeType.includes('agent') || nodeType.includes('chat')) {
  fields.push(
    { path: `${nodeId}.content`, type: 'string' },
    { path: `${nodeId}.data`, type: 'object' }
  );
} else if (nodeType.includes('llm')) {
  fields.push(
    { path: `${nodeId}.text`, type: 'string' },
    { path: `${nodeId}.response`, type: 'string' }
  );
}
```

## Implementation Details

### Frontend Components

**DataBrowserModal** (`ui/src/components/DataBrowserModal.tsx`):
- Calculates upstream nodes from edges
- Extracts available fields using strategies
- Displays searchable list grouped by node
- Inserts `{{reference}}` on click

**ConfigPanel** (`ui/src/ConfigPanel.tsx`):
- Added "🔗 Map" button next to each textarea
- Opens DataBrowserModal with current node context
- Inserts reference at cursor position
- Triggers save via onPatch

### Template Resolution (Backend - TODO)

The execution engine needs to resolve templates:

```python
def resolve_templates(props: dict, context: ExecutionContext) -> dict:
    """Replace {{node.field}} references with actual values."""
    resolved = {}
    for key, value in props.items():
        if isinstance(value, str) and '{{' in value:
            # Extract all {{...}} patterns
            pattern = r'\{\{([^}]+)\}\}'
            matches = re.findall(pattern, value)
            
            for match in matches:
                # Parse node_id and field path
                parts = match.split('.', 1)
                node_id = parts[0]
                field_path = parts[1] if len(parts) > 1 else None
                
                # Get node output from context
                node_output = context.get_output(node_id)
                
                # Extract field using path
                if field_path:
                    extracted = extract_field(node_output, field_path)
                else:
                    extracted = node_output
                
                # Replace in string
                value = value.replace(f'{{{{{match}}}}}', str(extracted))
            
        resolved[key] = value
    return resolved
```

## Examples

### Example 1: Simple Reference

```python
@node
def chat(user_input: str) -> dict:
    return {
        "content": "Hello, how are you?",
        "role": "assistant"
    }

@node(type="langchain.agent")
class Summarizer:
    user_prompt = "Summarize this: {{chat.content}}"  # Reference
```

At execution:
- `chat` runs → outputs `{"content": "Hello, how are you?", "role": "assistant"}`
- Engine resolves `{{chat.content}}` → `"Hello, how are you?"`
- `Summarizer` receives `user_prompt = "Summarize this: Hello, how are you?"`

### Example 2: Nested Path

```python
@node
def api_call() -> dict:
    return {
        "data": {
            "user": {
                "name": "Alice",
                "email": "alice@example.com"
            }
        }
    }

@node(type="notification")
class EmailSender:
    recipient = "{{api_call.data.user.email}}"
    subject = "Hello {{api_call.data.user.name}}!"
```

Resolution:
- `{{api_call.data.user.email}}` → `"alice@example.com"`
- `{{api_call.data.user.name}}` → `"Alice"`

### Example 3: Multiple References

```python
@node(type="template")
class MessageFormatter:
    template = "From: {{sender.name}}, To: {{recipient.name}}, Subject: {{subject.text}}"
```

All three references resolved independently before execution.

## Future Enhancements

1. **Type Validation**: Check that referenced field type matches expected type
2. **Autocomplete**: IDE support for `{{...}}` references
3. **Preview**: Show resolved value in UI before execution
4. **Nested Objects**: Support array indexing (`{{node.items[0].name}}`)
5. **Filters**: Add transformation filters (`{{node.text | uppercase}}`)

## Relationship to Port Mappings

Port mappings and data references work together:

```python
# 1. Port mapping defines the connection
@port_map
class Link:
    source = (chat_node, "output")
    target = (agent_node, "input")

# 2. This creates an edge in the graph
# 3. Because of this edge, agent_node can see chat_node as upstream
# 4. In the UI, chat_node's fields appear in DataBrowserModal
# 5. User can insert {{chat_node.content}} in agent_node props

# 6. Data reference uses the connection
@node(type="agent")
class MyAgent:
    prompt = "{{chat_node.content}}"  # Requires the port mapping above
```

**Port mappings enable discovery** of available data sources.  
**Data references consume** the discovered data.

---

**Status**: UI implemented ✅  
**Next**: Backend template resolution in execution engine
