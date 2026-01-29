"""Tests for spec type registry and resolution.

These tests verify:
- Registry registration and lookup
- Spec node resolution
- Built-in type resolvers
- Custom resolver registration
- Error handling for unknown types
"""

from __future__ import annotations

import pytest

from holon.registry import (
    SpecTypeRegistry,
    register_spec_type,
    resolve_spec_node,
    has_spec_type,
    get_global_registry,
)


class TestSpecTypeRegistry:
    """Test the SpecTypeRegistry class."""
    
    def test_register_and_resolve(self):
        """Test basic registration and resolution."""
        registry = SpecTypeRegistry()
        
        def my_resolver(props: dict) -> str:
            return f"resolved: {props.get('value', 'default')}"
        
        registry.register("test.type", my_resolver)
        
        result = registry.resolve("test.type", {"value": "hello"})
        assert result == "resolved: hello"
    
    def test_register_with_decorator(self):
        """Test registration using decorator."""
        registry = SpecTypeRegistry()
        
        @registry.register_resolver("decorated.type")
        def my_resolver(props: dict) -> int:
            return props.get("count", 0) * 2
        
        result = registry.resolve("decorated.type", {"count": 5})
        assert result == 10
    
    def test_has_resolver(self):
        """Test checking if resolver exists."""
        registry = SpecTypeRegistry()
        
        registry.register("exists.type", lambda props: None)
        
        assert registry.has_resolver("exists.type") is True
        assert registry.has_resolver("missing.type") is False
    
    def test_resolve_unknown_type(self):
        """Test resolving an unknown type raises ValueError."""
        registry = SpecTypeRegistry()
        
        with pytest.raises(ValueError) as exc_info:
            registry.resolve("unknown.type", {})
        
        assert "No resolver registered" in str(exc_info.value)
        assert "unknown.type" in str(exc_info.value)


class TestGlobalRegistry:
    """Test global registry functions."""
    
    def test_register_spec_type_decorator(self):
        """Test global registration decorator."""
        @register_spec_type("global.test.type")
        def resolver(props: dict) -> str:
            return f"global: {props.get('name', 'unknown')}"
        
        assert has_spec_type("global.test.type") is True
        result = resolve_spec_node("global.test.type", {"name": "test"})
        assert result == "global: test"
    
    def test_resolve_spec_node_with_empty_props(self):
        """Test resolving with no props."""
        @register_spec_type("empty.props.type")
        def resolver(props: dict) -> str:
            return "no props"
        
        result = resolve_spec_node("empty.props.type")
        assert result == "no props"
    
    def test_get_global_registry(self):
        """Test accessing global registry."""
        registry = get_global_registry()
        assert isinstance(registry, SpecTypeRegistry)


class TestBuiltInResolvers:
    """Test built-in spec type resolvers."""
    
    def test_llm_model_resolver(self):
        """Test LLM model resolver."""
        result = resolve_spec_node("llm.model", {
            "model_name": "gpt-4o",
            "temperature": 0.8,
        })
        
        # Should return a config object if holon.library.llm not available
        assert hasattr(result, "model_name")
        assert result.model_name == "gpt-4o"
        assert result.temperature == 0.8
    
    def test_memory_buffer_resolver(self):
        """Test memory buffer resolver."""
        result = resolve_spec_node("memory.buffer", {"max_messages": 20})
        
        # Should create a MemoryBuffer instance
        assert hasattr(result, "max_messages")
        assert result.max_messages == 20
        assert hasattr(result, "add")
        assert hasattr(result, "get_messages")
        
        # Test memory operations
        result.add("message1")
        result.add("message2")
        messages = result.get_messages()
        assert len(messages) == 2
        assert messages[0] == "message1"
    
    def test_memory_buffer_max_limit(self):
        """Test memory buffer respects max limit."""
        buffer = resolve_spec_node("memory.buffer", {"max_messages": 3})
        
        for i in range(5):
            buffer.add(f"msg{i}")
        
        messages = buffer.get_messages()
        assert len(messages) == 3
        assert messages == ["msg2", "msg3", "msg4"]
    
    def test_tool_function_resolver(self):
        """Test tool function resolver."""
        result = resolve_spec_node("tool.function", {
            "name": "calculator",
            "description": "Performs calculations",
        })
        
        assert hasattr(result, "name")
        assert result.name == "calculator"
        assert result.description == "Performs calculations"


class TestCustomResolvers:
    """Test custom resolver registration and usage."""
    
    def test_custom_resolver_with_validation(self):
        """Test custom resolver with prop validation."""
        @register_spec_type("validated.type")
        def resolver(props: dict) -> dict:
            required = ["field1", "field2"]
            missing = [f for f in required if f not in props]
            if missing:
                raise ValueError(f"Missing required fields: {missing}")
            
            return {
                "field1": props["field1"],
                "field2": props["field2"],
                "computed": props["field1"] + props["field2"],
            }
        
        # Valid props
        result = resolve_spec_node("validated.type", {
            "field1": "hello",
            "field2": "world",
        })
        assert result["computed"] == "helloworld"
        
        # Invalid props
        with pytest.raises(ValueError) as exc_info:
            resolve_spec_node("validated.type", {"field1": "only one"})
        assert "Missing required fields" in str(exc_info.value)
    
    def test_custom_resolver_returning_class_instance(self):
        """Test custom resolver that returns a class instance."""
        class CustomObject:
            def __init__(self, config: str):
                self.config = config
            
            def execute(self) -> str:
                return f"executed with {self.config}"
        
        @register_spec_type("custom.object.type")
        def resolver(props: dict) -> CustomObject:
            return CustomObject(props.get("config", "default"))
        
        result = resolve_spec_node("custom.object.type", {"config": "test"})
        assert isinstance(result, CustomObject)
        assert result.execute() == "executed with test"


class TestResolverEdgeCases:
    """Test edge cases and error conditions."""
    
    def test_resolver_with_no_props(self):
        """Test resolver called with empty props."""
        @register_spec_type("no.props.needed")
        def resolver(props: dict) -> str:
            return "constant value"
        
        result = resolve_spec_node("no.props.needed", {})
        assert result == "constant value"
    
    def test_resolver_modifies_props(self):
        """Test that resolver can modify props dict."""
        @register_spec_type("modifying.resolver")
        def resolver(props: dict) -> dict:
            props["added"] = "new value"
            return props
        
        original = {"existing": "value"}
        result = resolve_spec_node("modifying.resolver", original)
        
        # Result should have both original and added
        assert result["existing"] == "value"
        assert result["added"] == "new value"
        
        # Original should be modified (dict is mutable)
        assert original["added"] == "new value"
    
    def test_resolver_raises_exception(self):
        """Test that resolver exceptions propagate correctly."""
        @register_spec_type("failing.resolver")
        def resolver(props: dict) -> None:
            raise RuntimeError("Resolver failed intentionally")
        
        with pytest.raises(RuntimeError) as exc_info:
            resolve_spec_node("failing.resolver", {})
        
        assert "Resolver failed intentionally" in str(exc_info.value)
