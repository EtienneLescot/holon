"""Logic/flow-control node resolvers — Phase 7.0.

Registers:
- ``logic.switch``  conditional routing with up to 10 branches + fallback
"""

from __future__ import annotations

import re
import sys
from typing import Any

from holon.registry import register_spec_type
from holon.library.template import evaluate_expression


# ---------------------------------------------------------------------------
# Switch resolver
# ---------------------------------------------------------------------------

_MAX_BRANCHES = 10


@register_spec_type("logic.switch")
def resolve_logic_switch(props: dict[str, Any]) -> Any:
    """Resolve a logic.switch spec node.

    The resolver returns a *config snapshot* (SimpleNamespace) because the
    Switch is not a callable: the engine's dedicated
    ``_execute_switch_node()`` handler drives evaluation.

    Props:
        input_expression (str): ``{{ data.field }}`` expression evaluated on
            the incoming ``DataEnvelope.content``.
        rules (list[dict]): Ordered list of conditions.  Each rule has:
            - ``label``    (str)  display name
            - ``operator`` (str)  comparison operator (see OPERATORS below)
            - ``value``    (Any)  reference value (omit for is_empty / is_not_empty)
            - ``output``   (str)  port id to activate (e.g. ``"out_0"``)
        fallback (str): Port id used when no rule matches. Default ``"out_fallback"``.

    Max branches: 10 (out_0 … out_9) + 1 fallback.

    Supported operators:
        equals, not_equals, contains, greater_than, less_than,
        is_empty, is_not_empty, regex
    """
    from types import SimpleNamespace

    rules = props.get("rules", [])
    if len(rules) > _MAX_BRANCHES:
        sys.stderr.write(
            f"[SWITCH] WARNING: {len(rules)} rules declared but max is {_MAX_BRANCHES}. "
            f"Extra rules will be ignored.\n"
        )
        sys.stderr.flush()
        rules = rules[:_MAX_BRANCHES]

    return SimpleNamespace(
        input_expression=props.get("input_expression", "{{ data }}"),
        rules=rules,
        fallback=props.get("fallback", "out_fallback"),
    )


# ---------------------------------------------------------------------------
# Rule evaluation helpers
# ---------------------------------------------------------------------------

def evaluate_rule(evaluated_value: Any, operator: str, rule_value: Any) -> bool:
    """Test whether *evaluated_value* satisfies the rule condition.

    Args:
        evaluated_value: Value extracted from the input DataEnvelope.
        operator:        Operator name (string).
        rule_value:      Reference value from the rule definition.

    Returns:
        ``True`` if the condition is satisfied.
    """
    try:
        if operator == "equals":
            return evaluated_value == rule_value
        if operator == "not_equals":
            return evaluated_value != rule_value
        if operator == "contains":
            if isinstance(evaluated_value, str):
                return str(rule_value) in evaluated_value
            if isinstance(evaluated_value, (list, tuple, set)):
                return rule_value in evaluated_value
            return False
        if operator == "greater_than":
            return float(evaluated_value) > float(rule_value)
        if operator == "less_than":
            return float(evaluated_value) < float(rule_value)
        if operator == "is_empty":
            return not bool(evaluated_value)
        if operator == "is_not_empty":
            return bool(evaluated_value)
        if operator == "regex":
            return bool(re.search(str(rule_value), str(evaluated_value)))
    except Exception:
        return False
    return False
