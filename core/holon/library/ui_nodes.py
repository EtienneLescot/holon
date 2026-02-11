"""UI node types for interactive elements."""

from holon.registry import register_spec_type
from holon.domain.models import NodeSpec, PortSpec


@register_spec_type("ui.chat")
def resolve_chat_node(props: dict) -> NodeSpec:
    """Resolve a chat node spec.
    
    Chat node provides an interactive interface for user input/output
    with message history, markdown support, and bidirectional communication.
    """
    return NodeSpec(
        id=props.get("id", "spec:chat:default"),
        type="ui.chat",
        label=props.get("label", "Chat"),
        inputs=[
            PortSpec(
                id="in",
                kind="data",
                label="Response",
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
