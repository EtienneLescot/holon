"""Tests for port mapping and data transformation."""

from datetime import datetime

import pytest

from holon.domain.models import DataEnvelope
from holon.execution.mapper import MappingError, PortMapper


class TestPortMapper:
    """Test suite for PortMapper transformations."""

    def setup_method(self):
        """Set up test fixtures."""
        self.mapper = PortMapper()
        self.sample_envelope = DataEnvelope(
            type="message",
            content="Hello world",
            contentType="text/plain",
            metadata={"role": "user", "conversationId": "c123"},
            origin={"nodeId": "chat-1", "port": "out.message"},
        )

    def test_identity_transform(self):
        """Test identity transform (None) returns content."""
        result = self.mapper.apply_transform(self.sample_envelope, None)
        assert result == "Hello world"

    def test_jsonpath_content(self):
        """Test JSONPath extraction of content field."""
        result = self.mapper.apply_transform(self.sample_envelope, "$.content")
        assert result == "Hello world"

    def test_jsonpath_metadata_role(self):
        """Test JSONPath extraction of nested metadata field."""
        result = self.mapper.apply_transform(self.sample_envelope, "$.metadata.role")
        assert result == "user"

    def test_jsonpath_metadata_conversation(self):
        """Test JSONPath extraction of conversationId."""
        result = self.mapper.apply_transform(
            self.sample_envelope, "$.metadata.conversationId"
        )
        assert result == "c123"

    def test_jsonpath_missing_field(self):
        """Test JSONPath returns None for missing field."""
        result = self.mapper.apply_transform(self.sample_envelope, "$.missing.field")
        assert result is None

    def test_simple_path_fallback(self):
        """Test simple path extraction without jsonpath-ng library."""
        # Test the fallback implementation
        result = self.mapper._simple_path_extract("$.content", self.sample_envelope)
        assert result == "Hello world"
        
        result = self.mapper._simple_path_extract(
            "$.metadata.role", self.sample_envelope
        )
        assert result == "user"

    def test_template_simple(self):
        """Test simple template interpolation."""
        result = self.mapper.apply_transform(
            self.sample_envelope, "User: {{content}}"
        )
        assert result == "User: Hello world"

    def test_template_with_metadata(self):
        """Test template with metadata field."""
        result = self.mapper.apply_transform(
            self.sample_envelope, "{{metadata.role}}: {{content}}"
        )
        assert result == "user: Hello world"

    def test_template_multiple_fields(self):
        """Test template with multiple interpolations."""
        result = self.mapper.apply_transform(
            self.sample_envelope,
            "[{{metadata.conversationId}}] {{metadata.role}}: {{content}}",
        )
        assert result == "[c123] user: Hello world"

    def test_template_missing_field(self):
        """Test template preserves placeholder for missing field."""
        result = self.mapper.apply_transform(
            self.sample_envelope, "{{missing}}: {{content}}"
        )
        assert result == "{{missing}}: Hello world"

    def test_python_lambda_uppercase(self):
        """Test Python lambda transformation."""
        result = self.mapper.apply_transform(
            self.sample_envelope, "lambda env: env.content.upper()"
        )
        assert result == "HELLO WORLD"

    def test_python_lambda_length(self):
        """Test Python lambda with len()."""
        result = self.mapper.apply_transform(
            self.sample_envelope, "lambda env: len(env.content)"
        )
        assert result == 11

    def test_python_lambda_dict_access(self):
        """Test Python lambda accessing metadata."""
        result = self.mapper.apply_transform(
            self.sample_envelope, "lambda env: env.metadata['role']"
        )
        assert result == "user"

    def test_python_lambda_envelope_construction(self):
        """Test Python lambda creating new DataEnvelope."""
        result = self.mapper.apply_transform(
            self.sample_envelope,
            "lambda env: DataEnvelope(type='message', content=env.content.upper(), metadata={'processed': True})",
        )
        assert isinstance(result, DataEnvelope)
        assert result.content == "HELLO WORLD"
        assert result.metadata == {"processed": True}

    def test_python_lambda_security_no_imports(self):
        """Test that Python lambda rejects imports."""
        with pytest.raises(ValueError, match="Function __import__ is not allowed"):
            self.mapper.apply_transform(
                self.sample_envelope, "lambda env: __import__('os').system('ls')"
            )

    def test_python_lambda_security_no_eval(self):
        """Test that Python lambda rejects eval()."""
        with pytest.raises(ValueError, match="Function eval is not allowed"):
            self.mapper.apply_transform(
                self.sample_envelope, "lambda env: eval('1+1')"
            )

    def test_python_lambda_security_no_exec(self):
        """Test that Python lambda rejects exec()."""
        with pytest.raises(ValueError, match="Function exec is not allowed"):
            self.mapper.apply_transform(
                self.sample_envelope, "lambda env: exec('print(1)')"
            )

    def test_python_lambda_invalid_syntax(self):
        """Test that invalid Python syntax is rejected."""
        with pytest.raises(ValueError, match="Invalid Python expression"):
            self.mapper.apply_transform(self.sample_envelope, "lambda env: env.content +")

    def test_python_lambda_not_lambda(self):
        """Test that non-lambda expressions are rejected."""
        with pytest.raises(ValueError, match="Unsupported transform syntax"):
            self.mapper.apply_transform(self.sample_envelope, "def foo(): pass")

    def test_unsupported_transform(self):
        """Test that unsupported transform syntax raises error."""
        with pytest.raises(ValueError, match="Unsupported transform syntax"):
            self.mapper.apply_transform(self.sample_envelope, "unsupported syntax")

    def test_complex_envelope(self):
        """Test with complex nested envelope."""
        complex_envelope = DataEnvelope(
            type="data",
            content={
                "query": "SELECT * FROM users",
                "params": [1, 2, 3],
                "nested": {"deep": {"value": "found"}},
            },
            contentType="application/json",
            metadata={"source": "db_node", "timestamp": "2026-02-03"},
        )

        # JSONPath on nested structure
        result = self.mapper.apply_transform(complex_envelope, "$.content.query")
        assert result == "SELECT * FROM users"

        # Template with nested data
        result = self.mapper.apply_transform(
            complex_envelope, "Source: {{metadata.source}}"
        )
        assert result == "Source: db_node"

    def test_list_content(self):
        """Test envelope with list content."""
        list_envelope = DataEnvelope(
            type="data",
            content=["item1", "item2", "item3"],
            contentType="application/json",
        )

        result = self.mapper.apply_transform(list_envelope, None)
        assert result == ["item1", "item2", "item3"]

        # Lambda on list
        result = self.mapper.apply_transform(
            list_envelope, "lambda env: len(env.content)"
        )
        assert result == 3
