from __future__ import annotations

from holon import node, workflow, link, spec
spec("spec:llm.model:108c365b-01c7-4ff3-bb36-1d0c0739c66f", type = "llm.model", label = "LLM Model", props = {"model_name": "gpt-4o", "temperature": 0.7})

# Simple LLM Model spec
spec(
    "spec:llm.model:simple",
    type="llm.model",
    label="GPT-4o",
    props={
        "provider": "openai",
        "model_name": "gpt-4o",
        "temperature": 0.7
    }
)

# Simple Agent spec
spec(
    "spec:agent.simple:chat",
    type="langchain.agent",
    label="Simple Chat Agent",
    props={
        "system_prompt": "You are a helpful assistant.",
        "user_prompt": "Tell me a short joke about robots."
    }
)


@workflow
async def main() -> str:
    """Simple workflow: connect LLM to agent and execute."""
    # Connect LLM to agent's llm port
    link("spec:llm.model:simple", "llm", "spec:agent.simple:chat", "llm")
    link("workflow:main", "start", "spec:agent.simple:chat", "input")
    
    # The agent will use user_prompt from its props as input
    # In the future, we could connect an input node here
    
    return "Workflow will execute via graph engine"
