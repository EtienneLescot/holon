"""LangChain node specifications.

Defines NodeSpec metadata for LangChain nodes to be displayed in the UI.
"""

from holon.registry import register_spec_type
from holon.domain.models import NodeSpec, PortSpec


@register_spec_type("langchain.agent.spec")
def resolve_langchain_agent_spec(props: dict) -> NodeSpec:
    """Resolve LangChain agent node spec for UI display.
    
    Note: This is separate from the runtime resolver in langchain_registry.py
    """
    return NodeSpec(
        id=props.get("id", "spec:langchain:agent:default"),
        type="langchain.agent",
        label=props.get("label", "LangChain Agent"),
        inputs=[
            PortSpec(
                id="input",
                kind="data",
                label="Input",
                multi=False
            ),
            PortSpec(
                id="llm",
                kind="llm",
                label="LLM",
                multi=False
            ),
            PortSpec(
                id="memory",
                kind="memory",
                label="Memory",
                multi=False
            ),
            PortSpec(
                id="tools",
                kind="tool",
                label="Tools",
                multi=True
            ),
        ],
        outputs=[
            PortSpec(
                id="output",
                kind="data",
                label="Output",
                multi=False
            ),
        ],
        props={
            "system_prompt": props.get("system_prompt", "You are a helpful assistant."),
            "user_prompt": props.get("user_prompt", ""),
            **props
        },
        required_inputs=["llm"],  # LLM is required
    )


@register_spec_type("llm.model.spec")
def resolve_llm_model_spec(props: dict) -> NodeSpec:
    """Resolve LLM model node spec for UI display."""
    return NodeSpec(
        id=props.get("id", "spec:llm:model:default"),
        type="llm.model",
        label=props.get("label", "LLM Model"),
        inputs=[],
        outputs=[
            PortSpec(
                id="output",
                kind="llm",
                label="LLM",
                multi=False
            ),
        ],
        props={
            "provider": props.get("provider", "openai"),
            "model_name": props.get("model_name", "gpt-4o"),
            "temperature": props.get("temperature", 0.7),
            **props
        },
    )
