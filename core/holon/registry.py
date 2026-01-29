"""Spec type registry and resolution (Phase 6).

This module provides:
- A registry mapping spec types to factory functions
- Resolution logic to instantiate runtime objects from spec declarations
- Built-in support for common types (LLM, memory, tools)
- Extensibility for user-defined types

Design:
- Each spec type has a resolver function: (props: dict) → Any
- Resolvers instantiate the actual runtime object (LLM client, memory store, etc.)
- The runner calls resolve_spec_node(type, props) during execution

Example:
    # Register a custom type
    @register_spec_type("my.custom.type")
    def resolve_custom(props: dict) -> MyCustomObject:
        return MyCustomObject(**props)
    
    # Use in workflow
    @node(type="my.custom.type", id="spec:custom:1")
    class MyCustomNode:
        config_value = "test"
"""

from __future__ import annotations

from typing import Any, Callable, Protocol

# Type alias for resolver functions
SpecResolver = Callable[[dict[str, Any]], Any]


class _RegistryProtocol(Protocol):
    """Protocol for the spec type registry."""
    
    def register(self, type_id: str, resolver: SpecResolver) -> None:
        """Register a resolver for a spec type."""
        ...
    
    def resolve(self, type_id: str, props: dict[str, Any]) -> Any:
        """Resolve a spec node to a runtime object."""
        ...
    
    def has_resolver(self, type_id: str) -> bool:
        """Check if a resolver exists for a type."""
        ...


class SpecTypeRegistry:
    """Registry of spec type resolvers.
    
    This registry maps spec type identifiers (e.g., "llm.model", "langchain.agent")
    to factory functions that instantiate runtime objects.
    
    Example:
        registry = SpecTypeRegistry()
        
        @registry.register_resolver("my.type")
        def resolve_my_type(props: dict) -> MyType:
            return MyType(**props)
        
        obj = registry.resolve("my.type", {"config": "value"})
    """
    
    def __init__(self) -> None:
        self._resolvers: dict[str, SpecResolver] = {}
    
    def register(self, type_id: str, resolver: SpecResolver) -> None:
        """Register a resolver function for a spec type.
        
        Args:
            type_id: Type identifier (e.g., "llm.model")
            resolver: Function that takes props dict and returns runtime object
        """
        self._resolvers[type_id] = resolver
    
    def register_resolver(self, type_id: str) -> Callable[[SpecResolver], SpecResolver]:
        """Decorator for registering a resolver.
        
        Args:
            type_id: Type identifier (e.g., "llm.model")
        
        Returns:
            Decorator function
        
        Example:
            @registry.register_resolver("my.type")
            def resolve_my_type(props: dict) -> MyType:
                return MyType(**props)
        """
        def decorator(resolver: SpecResolver) -> SpecResolver:
            self.register(type_id, resolver)
            return resolver
        return decorator
    
    def resolve(self, type_id: str, props: dict[str, Any]) -> Any:
        """Resolve a spec node to a runtime object.
        
        Args:
            type_id: Type identifier (e.g., "llm.model")
            props: Configuration properties
        
        Returns:
            Instantiated runtime object
        
        Raises:
            ValueError: If no resolver found for the type
        """
        resolver = self._resolvers.get(type_id)
        if resolver is None:
            raise ValueError(
                f"No resolver registered for spec type: {type_id}\n"
                f"Available types: {', '.join(sorted(self._resolvers.keys()))}"
            )
        
        return resolver(props)
    
    def has_resolver(self, type_id: str) -> bool:
        """Check if a resolver exists for a type.
        
        Args:
            type_id: Type identifier
        
        Returns:
            True if resolver exists, False otherwise
        """
        return type_id in self._resolvers


# Global registry instance
_global_registry = SpecTypeRegistry()


def register_spec_type(type_id: str) -> Callable[[SpecResolver], SpecResolver]:
    """Decorator to register a spec type resolver in the global registry.
    
    Args:
        type_id: Type identifier (e.g., "llm.model")
    
    Returns:
        Decorator function
    
    Example:
        @register_spec_type("my.type")
        def resolve_my_type(props: dict) -> MyType:
            return MyType(**props)
    """
    return _global_registry.register_resolver(type_id)


def resolve_spec_node(type_id: str, props: dict[str, Any] | None = None) -> Any:
    """Resolve a spec node using the global registry.
    
    Args:
        type_id: Type identifier (e.g., "llm.model")
        props: Configuration properties (default: empty dict)
    
    Returns:
        Instantiated runtime object
    
    Raises:
        ValueError: If no resolver found for the type
    
    Example:
        llm = resolve_spec_node("llm.model", {"model_name": "gpt-4o"})
    """
    return _global_registry.resolve(type_id, props or {})


def has_spec_type(type_id: str) -> bool:
    """Check if a spec type has a registered resolver.
    
    Args:
        type_id: Type identifier
    
    Returns:
        True if resolver exists, False otherwise
    """
    return _global_registry.has_resolver(type_id)


def get_global_registry() -> SpecTypeRegistry:
    """Get the global spec type registry.
    
    Returns:
        The global registry instance
    """
    return _global_registry


# Built-in resolvers for common types
# These provide basic functionality that can be extended with library-specific implementations


@register_spec_type("llm.model")
def _resolve_llm_model(props: dict[str, Any]) -> Any:
    """Resolve an LLM model spec node.
    
    This is a basic resolver. For production use, register library-specific
    resolvers (e.g., via holon.library.llm or holon.library.langchain).
    
    Props:
        model_name: Model identifier (e.g., "gpt-4o", "claude-3-opus")
        temperature: Sampling temperature (default: 0.7)
        max_tokens: Maximum tokens to generate
        **kwargs: Additional model-specific parameters
    """
    try:
        from holon.library.llm import create_llm_model
        return create_llm_model(props)
    except ImportError:
        # Fallback: return a simple config object
        from types import SimpleNamespace
        return SimpleNamespace(**props)


@register_spec_type("memory.buffer")
def _resolve_memory_buffer(props: dict[str, Any]) -> Any:
    """Resolve a memory buffer spec node.
    
    Props:
        max_messages: Maximum number of messages to store
        **kwargs: Additional configuration
    """
    # Simple in-memory buffer
    class MemoryBuffer:
        def __init__(self, max_messages: int = 10, **kwargs: Any):
            self.max_messages = max_messages
            self.messages: list[Any] = []
            self.config = kwargs
        
        def add(self, message: Any) -> None:
            self.messages.append(message)
            if len(self.messages) > self.max_messages:
                self.messages.pop(0)
        
        def get_messages(self) -> list[Any]:
            return self.messages.copy()
        
        def clear(self) -> None:
            self.messages.clear()
    
    return MemoryBuffer(**props)


@register_spec_type("tool.function")
def _resolve_tool_function(props: dict[str, Any]) -> Any:
    """Resolve a function tool spec node.
    
    Props:
        name: Tool name
        description: Tool description
        function: Callable function (if available at parse time)
        **kwargs: Additional configuration
    """
    from types import SimpleNamespace
    return SimpleNamespace(**props)
