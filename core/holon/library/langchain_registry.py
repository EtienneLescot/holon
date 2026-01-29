"""LangChain spec type resolvers.

This module provides resolvers for LangChain-specific spec types:
- langchain.agent: Agent with tools, memory, and LLM
- langchain.tool: Tool wrapper
- langchain.memory: Memory/conversation buffer

These resolvers integrate with the global spec type registry.
"""

from __future__ import annotations

from typing import Any

from holon.registry import register_spec_type


@register_spec_type("langchain.agent")
def resolve_langchain_agent(props: dict[str, Any]) -> Any:
    """Resolve a LangChain agent spec node.
    
    Props:
        system_prompt: System message for the agent
        user_prompt: Default user prompt/input
        llm: LLM model (resolved separately)
        tools: List of tools (resolved separately)
        memory: Memory component (resolved separately)
        agent_type: Agent type (default: "openai-functions")
        verbose: Whether to enable verbose logging (default: False)
    
    Returns:
        A callable agent function that can be invoked with input
    
    Note:
        The actual LLM, tools, and memory should be provided at runtime
        via port connections. This resolver creates a factory/wrapper.
    """
    from types import SimpleNamespace
    
    # Create a config object that can be used at runtime
    config = SimpleNamespace(
        system_prompt=props.get("system_prompt", "You are a helpful assistant."),
        user_prompt=props.get("user_prompt", ""),
        agent_type=props.get("agent_type", "openai-functions"),
        verbose=props.get("verbose", False),
    )
    
    # Return a callable that wraps the agent logic
    def agent_runner(
        input: str,
        llm: Any = None,
        tools: list[Any] | None = None,
        memory: Any = None,
    ) -> str:
        """Execute the agent with given inputs."""
        from holon.library.langchain import langchain_agent
        
        return langchain_agent(
            input=input,
            llm=llm,
            system_prompt=config.system_prompt,
            user_prompt=config.user_prompt,
            tools=tools or [],
            memory=memory,
        )
    
    # Attach config for inspection
    agent_runner.config = config  # type: ignore[attr-defined]
    
    return agent_runner


@register_spec_type("langchain.memory.buffer")
def resolve_langchain_memory_buffer(props: dict[str, Any]) -> Any:
    """Resolve a LangChain conversation buffer memory.
    
    Props:
        max_token_limit: Maximum tokens to keep in memory
        return_messages: Whether to return messages or string (default: True)
        **kwargs: Additional LangChain memory parameters
    
    Returns:
        ConversationBufferMemory instance
    """
    try:
        from langchain.memory import ConversationBufferMemory
        
        return ConversationBufferMemory(
            max_token_limit=props.get("max_token_limit"),
            return_messages=props.get("return_messages", True),
            **{k: v for k, v in props.items() if k not in ("max_token_limit", "return_messages")},
        )
    except ImportError as e:
        raise ImportError(
            "LangChain not available. Install with: pip install langchain"
        ) from e


@register_spec_type("langchain.tool")
def resolve_langchain_tool(props: dict[str, Any]) -> Any:
    """Resolve a LangChain tool spec node.
    
    Props:
        name: Tool name
        description: Tool description
        func: Tool function (if provided as string, needs to be resolved)
        **kwargs: Additional tool parameters
    
    Returns:
        LangChain Tool instance
    """
    try:
        from langchain_core.tools import Tool
        
        name = props.get("name")
        description = props.get("description")
        func = props.get("func")
        
        if not name or not description:
            raise ValueError("Tool requires 'name' and 'description' properties")
        
        if not callable(func):
            # If func is not callable, create a simple echo tool
            def echo_func(input: str) -> str:
                return f"Tool {name} called with: {input}"
            func = echo_func
        
        return Tool(
            name=name,
            description=description,
            func=func,
            **{k: v for k, v in props.items() if k not in ("name", "description", "func")},
        )
    except ImportError as e:
        raise ImportError(
            "LangChain not available. Install with: pip install langchain"
        ) from e
