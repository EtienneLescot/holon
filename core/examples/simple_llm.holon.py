from __future__ import annotations

from holon import node, workflow, link, spec

# Simple LLM Model spec
spec(
    "spec:llm.openai:simple",
    type="llm.openai",
    label="GPT-4o",
    props={"model_name": "gpt-4o", "temperature": 0.7}
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
    """Simple workflow: send a prompt to an LLM agent and return the response."""
    link("spec:llm.openai:simple", "output", "spec:agent.simple:chat", "input")
    link("workflow:main", "start", "spec:agent.simple:chat", "input")
    link("spec:llm.openai:simple", "output", "spec:agent.simple:chat", "input")
    # For now, just return a mock response since we don't have the full execution engine
    return "Workflow executed successfully (mock response)"
