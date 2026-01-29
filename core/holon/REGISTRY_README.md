# Holon Spec Type Registry

## Overview

The spec type registry provides a flexible system for resolving spec nodes (library nodes) to runtime objects during workflow execution. This allows workflows to use pre-configured, library-provided components like LLM models, memory stores, and tools.

## Quick Start

### Defining Spec Nodes

Spec nodes are classes decorated with `@node(type="...", ...)`:

```python
from holon import node, workflow

@node(type="llm.model", id="spec:llm:gpt4")
class GPT4:
    model_name = "gpt-4o"
    temperature = 0.7

@node(type="memory.buffer", id="spec:mem:chat")
class ChatMemory:
    max_messages = 10

@workflow
async def main():
    # At runtime, GPT4 and ChatMemory are resolved to actual objects
    # based on their type and configuration properties
    pass
```

### Using Spec Nodes

During execution, the runner automatically:
1. Detects spec node classes
2. Extracts configuration from class attributes
3. Calls the appropriate resolver function
4. Replaces the class with the resolved object

```python
from holon.runner import WorkflowRunner

runner = WorkflowRunner()
result = await runner.run_workflow_file("workflow.holon.py", "main")
```

## Built-in Spec Types

### llm.model

Language model configuration.

**Props:**
- `model_name` (str): Model identifier (e.g., "gpt-4o", "claude-3-opus")
- `temperature` (float): Sampling temperature (default: 0.7)
- `max_tokens` (int): Maximum tokens to generate
- Additional model-specific parameters

**Example:**
```python
@node(type="llm.model", id="spec:llm:creative")
class CreativeLLM:
    model_name = "gpt-4o"
    temperature = 0.9
    max_tokens = 2000
```

### memory.buffer

In-memory message buffer with maximum size.

**Props:**
- `max_messages` (int): Maximum number of messages to store

**Example:**
```python
@node(type="memory.buffer", id="spec:mem:conversation")
class ConversationMemory:
    max_messages = 20
```

**Runtime API:**
```python
# After resolution, provides these methods:
memory.add(message)           # Add a message
memory.get_messages()         # Get all messages
memory.clear()                # Clear all messages
```

### tool.function

Function tool wrapper.

**Props:**
- `name` (str): Tool name
- `description` (str): Tool description
- `function` (callable): Tool function

**Example:**
```python
@node(type="tool.function", id="spec:tool:calc")
class CalculatorTool:
    name = "calculator"
    description = "Performs basic arithmetic"
```

## Custom Spec Types

### Registering a Custom Type

Use the `@register_spec_type` decorator:

```python
from holon.registry import register_spec_type

@register_spec_type("my.custom.type")
def resolve_my_type(props: dict) -> MyCustomObject:
    """Resolve a custom spec node to runtime object.
    
    Args:
        props: Configuration properties extracted from class attributes
    
    Returns:
        Instantiated runtime object
    """
    return MyCustomObject(
        config=props.get("config", "default"),
        timeout=props.get("timeout", 30),
    )
```

### Using Custom Types

```python
@node(type="my.custom.type", id="spec:custom:instance")
class MyCustomNode:
    config = "production"
    timeout = 60

@workflow
async def main():
    # MyCustomNode is now a MyCustomObject instance
    result = MyCustomNode.execute()
    return result
```

### Resolver Best Practices

1. **Validate props**: Check for required configuration
   ```python
   @register_spec_type("validated.type")
   def resolver(props: dict) -> object:
       if "required_field" not in props:
           raise ValueError("Missing required_field")
       return MyObject(**props)
   ```

2. **Provide defaults**: Make configuration optional where sensible
   ```python
   @register_spec_type("defaulted.type")
   def resolver(props: dict) -> object:
       return MyObject(
           field1=props.get("field1", "default"),
           field2=props.get("field2", 42),
       )
   ```

3. **Return callable objects**: For node-like behavior
   ```python
   @register_spec_type("callable.type")
   def resolver(props: dict) -> object:
       class CallableNode:
           def __init__(self, config):
               self.config = config
           
           def __call__(self, input):
               # Process input using config
               return self.process(input)
       
       return CallableNode(props)
   ```

## LangChain Integration

Import `holon.library.langchain_registry` to register LangChain-specific types:

```python
# This registers: langchain.agent, langchain.memory.buffer, langchain.tool
import holon.library.langchain_registry

@node(type="langchain.agent", id="spec:agent:assistant")
class Assistant:
    system_prompt = "You are a helpful assistant."
    agent_type = "openai-functions"
    verbose = True

@workflow
async def main(user_input: str):
    # Assistant is resolved to a LangChain agent runner
    response = Assistant(
        input=user_input,
        llm=my_llm,
        tools=[tool1, tool2],
    )
    return response
```

## Advanced Usage

### Registry API

```python
from holon.registry import get_global_registry

registry = get_global_registry()

# Check if type has resolver
if registry.has_resolver("my.type"):
    print("Resolver exists")

# Register programmatically
registry.register("dynamic.type", my_resolver_function)

# Resolve directly
obj = registry.resolve("my.type", {"config": "value"})
```

### Disabling Resolution

To keep spec nodes as classes (no resolution):

```python
runner = WorkflowRunner(resolve_specs=False)
```

### Caching

Spec nodes with IDs are cached per runner instance:

```python
# First resolution creates object
@node(type="expensive.type", id="spec:exp:1")
class ExpensiveNode:
    config = "value"

# Subsequent references use cached object
# This ensures consistency within a workflow execution
```

## Prop Extraction

Class attributes are automatically extracted as props:

```python
@node(type="my.type", id="spec:my:1")
class MyNode:
    # These become props
    string_prop = "value"
    number_prop = 42
    list_prop = [1, 2, 3]
    dict_prop = {"key": "value"}
    
    # These are IGNORED
    def method(self):  # Methods
        pass
    
    _private = "hidden"  # Private attributes
    __holon_spec_type__ = "..."  # Internal metadata
```

Extracted props:
```python
{
    "string_prop": "value",
    "number_prop": 42,
    "list_prop": [1, 2, 3],
    "dict_prop": {"key": "value"}
}
```

## Error Handling

### Unknown Type

If no resolver exists, the class is left as-is:

```python
@node(type="unknown.type", id="spec:unknown:1")
class UnknownNode:
    value = 42

# In workflow: UnknownNode is still a class
# Can still access: UnknownNode.value
```

### Resolver Errors

Resolver exceptions propagate to the workflow:

```python
@register_spec_type("failing.type")
def resolver(props: dict):
    raise ValueError("Invalid configuration")

# Workflow execution fails with clear error
```

## Testing

Test spec resolution in workflows:

```python
import pytest
from holon.runner import WorkflowRunner

@pytest.mark.asyncio
async def test_spec_resolution(tmp_path):
    workflow_file = tmp_path / "test.holon.py"
    workflow_file.write_text('''
from holon import node, workflow

@node(type="memory.buffer", id="spec:mem:test")
class TestMem:
    max_messages = 5

@workflow
async def main():
    TestMem.add("msg1")
    return len(TestMem.get_messages())
''')
    
    runner = WorkflowRunner()
    result = await runner.run_workflow_file(workflow_file, "main")
    
    assert result.success
    assert result.output == 1
```

## Next Steps

- **Port-based connections**: Connect spec nodes via explicit port links
- **Parallel resolution**: Resolve independent spec nodes concurrently
- **Hot reloading**: Update resolver implementations without restart
- **Type validation**: Validate props against schemas
- **Dependency injection**: Inject services into resolvers
