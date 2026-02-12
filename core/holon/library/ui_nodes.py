"""UI node types for interactive elements."""

from holon.registry import register_spec_type
from holon.domain.models import NodeSpec, PortSpec


@register_spec_type("trigger.manual")
def resolve_manual_trigger(props: dict) -> NodeSpec:
    """Resolve a manual trigger node spec.
    
    Manual trigger node marks the starting point of a workflow.
    It has no inputs and provides an output to start the workflow execution.
    """
    return NodeSpec(
        id=props.get("id", "spec:trigger:manual:default"),
        type="trigger.manual",
        label=props.get("label", "Manual Trigger"),
        inputs=[],
        outputs=[
            PortSpec(
                id="start",
                kind="data",
                label="Start",
                multi=False
            ),
        ],
        props={
            **props
        },
    )


@register_spec_type("trigger.chat")
def resolve_chat_trigger(props: dict) -> NodeSpec:
    """Resolve a chat trigger node spec.
    
    Chat trigger node is an interactive interface that starts workflows.
    It provides user input/output with message history and markdown support.
    As a trigger, it has no regular inputs but has a special 'response' port
    for agent replies to loop back.
    """
    return NodeSpec(
        id=props.get("id", "spec:trigger:chat:default"),
        type="trigger.chat",
        label=props.get("label", "Chat"),
        inputs=[
            PortSpec(
                id="response",
                kind="response",
                label="↩ Response",
                multi=True
            ),
        ],
        outputs=[
            PortSpec(
                id="out",
                kind="data",
                label="Message",
                multi=False
            ),
        ],
        props={
            "placeholder": props.get("placeholder", "Tapez votre message..."),
            "max_history": props.get("max_history", 50),
            "auto_scroll": props.get("auto_scroll", True),
            "show_timestamps": props.get("show_timestamps", True),
            "allow_markdown": props.get("allow_markdown", True),
            "theme": props.get("theme", "default"),
            **props
        },
    )
