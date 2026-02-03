"""Port mapping and data transformation engine.

This module provides the PortMapper class which applies transformations
to data flowing between ports according to mapping rules defined in
@port_map decorators.

Supports:
- JSONPath expressions for field extraction
- Mustache-like templates for string interpolation  
- Python lambda expressions (sandboxed)
"""

from __future__ import annotations

import ast
import re
from typing import Any

from holon.domain.models import DataEnvelope


class PortMapper:
    """Transforms data between ports according to mapping rules.
    
    Applies transformations to DataEnvelope objects using various
    expression languages (JSONPath, templates, Python lambdas).
    """

    def apply_transform(self, envelope: DataEnvelope, transform: str | None) -> Any:
        """Apply a transformation expression to extract/transform data.
        
        Args:
            envelope: Source data envelope to transform
            transform: Transformation expression (JSONPath, template, or lambda)
                      If None, returns envelope.content (identity transform)
        
        Returns:
            Transformed value
            
        Raises:
            ValueError: If transform syntax is unsupported
        """
        if transform is None:
            return envelope.content  # Identity transform
        
        # JSONPath: extract fields using $.path notation
        if transform.startswith("$."):
            return self._apply_jsonpath(transform, envelope)
        
        # Mustache template: interpolate {{field}} placeholders
        if "{{" in transform and "}}" in transform:
            return self._apply_template(transform, envelope)
        
        # Python lambda: sandboxed expression evaluation
        if transform.startswith("lambda"):
            return self._apply_python_expr(transform, envelope)
        
        raise ValueError(f"Unsupported transform syntax: {transform}")
    
    def _apply_jsonpath(self, path: str, envelope: DataEnvelope) -> Any:
        """Extract field using JSONPath-like syntax.
        
        Supports basic paths like:
        - $.content
        - $.metadata.role
        - $.metadata.conversationId
        
        Args:
            path: JSONPath expression starting with $
            envelope: Source envelope
            
        Returns:
            Extracted value or None if path not found
        """
        try:
            # Use jsonpath-ng for proper JSONPath support
            import jsonpath_ng
            parser = jsonpath_ng.parse(path)
            envelope_dict = envelope.model_dump()
            matches = parser.find(envelope_dict)
            return matches[0].value if matches else None
        except ImportError:
            # Fallback to simple dot notation parsing
            return self._simple_path_extract(path, envelope)
    
    def _simple_path_extract(self, path: str, envelope: DataEnvelope) -> Any:
        """Simple fallback for JSONPath without external dependency.
        
        Supports basic dot notation: $.field or $.field.subfield
        """
        # Remove leading $ and split by dots
        parts = path.lstrip("$").lstrip(".").split(".")
        
        # Convert envelope to dict
        data = envelope.model_dump()
        
        # Navigate through nested fields
        current = data
        for part in parts:
            if isinstance(current, dict) and part in current:
                current = current[part]
            else:
                return None
        
        return current
    
    def _apply_template(self, template: str, envelope: DataEnvelope) -> str:
        """Apply Mustache-like template with variable interpolation.
        
        Replaces {{field}} and {{field.subfield}} with values from envelope.
        
        Examples:
            "User: {{content}}" -> "User: Hello"
            "{{metadata.role}}: {{content}}" -> "user: Hello"
        
        Args:
            template: Template string with {{...}} placeholders
            envelope: Source envelope
            
        Returns:
            Interpolated string
        """
        envelope_dict = envelope.model_dump()
        
        # Find all {{...}} placeholders
        pattern = r"\{\{([^}]+)\}\}"
        
        def replace_placeholder(match: re.Match) -> str:
            field_path = match.group(1).strip()
            
            # Extract value using dot notation
            parts = field_path.split(".")
            current = envelope_dict
            
            for part in parts:
                if isinstance(current, dict) and part in current:
                    current = current[part]
                else:
                    return match.group(0)  # Keep placeholder if not found
            
            return str(current)
        
        return re.sub(pattern, replace_placeholder, template)
    
    def _apply_python_expr(self, expr: str, envelope: DataEnvelope) -> Any:
        """Evaluate a sandboxed Python lambda expression.
        
        ⚠️ Security: Only allows simple lambdas without imports or dangerous operations.
        
        Example:
            "lambda env: env.content.upper()" -> transforms content to uppercase
            
        Args:
            expr: Lambda expression string
            envelope: Source envelope
            
        Returns:
            Result of lambda evaluation
            
        Raises:
            ValueError: If expression is unsafe or invalid
        """
        # Parse the expression to ensure it's safe
        try:
            parsed = ast.parse(expr, mode='eval')
        except SyntaxError as e:
            raise ValueError(f"Invalid Python expression: {e}")
        
        # Verify it's a lambda with no dangerous operations
        if not isinstance(parsed.body, ast.Lambda):
            raise ValueError("Expression must be a lambda function")
        
        # Check for dangerous operations (imports, exec, eval, etc.)
        for node in ast.walk(parsed):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                raise ValueError("Imports are not allowed in transform expressions")
            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name):
                    if node.func.id in ('exec', 'eval', 'compile', '__import__'):
                        raise ValueError(f"Function {node.func.id} is not allowed")
        
        # Create restricted namespace with only safe builtins
        safe_builtins = {
            'str': str,
            'int': int,
            'float': float,
            'bool': bool,
            'len': len,
            'list': list,
            'dict': dict,
            'tuple': tuple,
            'DataEnvelope': DataEnvelope,
        }
        
        # Evaluate the lambda
        namespace = {'__builtins__': safe_builtins}
        func = eval(expr, namespace)
        
        # Execute the lambda with the envelope
        return func(envelope)


class MappingError(Exception):
    """Raised when a port mapping transformation fails."""
    pass
