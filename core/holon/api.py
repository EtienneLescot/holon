"""API endpoint for exposing node types from the registry."""

from __future__ import annotations

from typing import Any

from holon.registry import get_global_registry

# Import modules to register their resolvers
import holon.library.langchain_registry  # noqa: F401
import holon.library.ui_nodes  # noqa: F401
import holon.library.logic_nodes  # noqa: F401
import holon.library.parser_nodes  # noqa: F401
import holon.library.code_nodes  # noqa: F401
import holon.library.http_nodes  # noqa: F401


def get_available_node_types() -> list[dict[str, Any]]:
    """Get all registered spec types from the registry.
    
    Returns:
        List of node type definitions with metadata.
    """
    import sys
    registry = get_global_registry()
    
    # Get all registered types
    types = list(registry._resolvers.keys())
    print(f"[API] Registry has {len(types)} types: {types}", file=sys.stderr)
    
    # Category mapping and metadata
    node_types = []
    
    # Define metadata for known types
    metadata = {
        "llm.model": {
            "label": "LLM Model",
            "category": "AI",
            "description": "Large Language Model (OpenAI, Anthropic, etc.)",
            "defaultProps": {"provider": "openai", "model_name": "gpt-4o", "temperature": 0.7},
            "connectionRole": "provider",
        },
        "langchain.agent": {
            "label": "LangChain Agent",
            "category": "AI",
            "description": "Autonomous agent with tools and memory",
            "defaultProps": {
                "system_prompt": "You are a helpful assistant.",
                "user_prompt": "Tell me a story.",
            },
        },
        "memory.buffer": {
            "label": "Memory Buffer",
            "category": "Memory",
            "description": "Simple message buffer for conversation history",
            "defaultProps": {"maxMessages": 20},
            "connectionRole": "provider",
        },
        "langchain.memory.buffer": {
            "label": "LangChain Memory",
            "category": "Memory",
            "description": "LangChain conversation buffer memory",
            "defaultProps": {"k": 5},
            "connectionRole": "provider",
        },
        "tool.function": {
            "label": "Function Tool",
            "category": "Tools",
            "description": "Custom function tool",
            "defaultProps": {"name": "my_tool"},
            "connectionRole": "provider",
        },
        "langchain.tool": {
            "label": "LangChain Tool",
            "category": "Tools",
            "description": "LangChain-compatible tool",
            "defaultProps": {"name": "example_tool"},
            "connectionRole": "provider",
        },
        "parser.json": {
            "label": "JSON Parser",
            "category": "Parsers",
            "description": "Parse JSON responses",
            "defaultProps": {"schema": {}},
        },
        "ui.chat": {
            "label": "Chat",
            "category": "UI",
            "description": "Interactive chat node for user input/output",
            "defaultProps": {
                "placeholder": "Tapez votre message...",
                "max_history": 50,
                "auto_scroll": True,
                "show_timestamps": True,
                "allow_markdown": True,
                "theme": "default",
            },
        },
        # ---- New nodes --------------------------------------------------------
        "logic.switch": {
            "label": "Switch",
            "category": "Logic",
            "description": "Route data to one branch based on conditional rules",
            "defaultProps": {
                "input_expression": "{{ value }}",
                "rules": [
                    {"operator": "equals", "value": "", "output": "out_0"},
                ],
                "fallback": "out_fallback",
            },
        },
        "parser.structured": {
            "label": "Structured Output Parser",
            "category": "Parsers",
            "description": "Parse LLM output into structured JSON using a schema",
            "defaultProps": {
                "schema": {
                    "type": "object",
                    "properties": {"result": {"type": "string"}},
                    "required": ["result"],
                },
                "auto_fix": True,
            },
            "connectionRole": "provider",
        },
        "code.python": {
            "label": "Python Code",
            "category": "Code",
            "description": "Execute custom Python code in a sandboxed environment",
            "defaultProps": {
                "code": "# data is the incoming payload\nreturn data",
                "timeout": 30,
            },
        },
        "http.request": {
            "label": "HTTP Request",
            "category": "Network",
            "description": "Make HTTP requests to external APIs",
            "defaultProps": {
                "method": "GET",
                "url": "https://api.example.com/endpoint",
                "headers": {},
                "query_params": {},
                "timeout": 30,
                "retry_count": 0,
                "ignore_errors": False,
                "response_type": "json",
            },
        },
    }
    
    for type_id in sorted(types):
        meta = metadata.get(type_id, {})
        node_types.append({
            "type": type_id,
            "label": meta.get("label", type_id),
            "category": meta.get("category", "Other"),
            "description": meta.get("description", ""),
            "defaultProps": meta.get("defaultProps", {}),
            "connectionRole": meta.get("connectionRole", "flow"),
        })
    
    return node_types


def get_node_type_categories() -> list[str]:
    """Get all unique categories of node types.
    
    Returns:
        List of category names.
    """
    types = get_available_node_types()
    categories = sorted(set(t["category"] for t in types))
    return categories
