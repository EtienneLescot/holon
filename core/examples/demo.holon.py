from __future__ import annotations

from holon import node, workflow, link

@node(type="trigger.chat", id="node:trigger:chat:main")
class TriggerChat:
    "Chat Trigger"
    placeholder = "Posez votre question..."
    max_history = 50
    auto_scroll = True
    show_timestamps = True
    allow_markdown = True


@node(type="langchain.agent", id="node:langchain:agent:assistant")
class LangchainAgent:
    "LangChain Agent"
    system_prompt = "You are a helpful assistant."
    user_prompt = ""


@node(type="llm.model", id="node:llm:model:gpt4o")
class LlmModel:
    "LLM Model"
    provider = "openai"
    model_name = "gpt-4o"
    temperature = 0.7


@workflow
async def main() -> str:
    """Simple chat workflow: user → agent → user (conversation loop)."""

    # Chat user message → Agent input
    @link
    class _:
        source = ("node:trigger:chat:main", "out")
        target = ("node:langchain:agent:assistant", "input")

    # LLM → Agent (required connection)
    @link
    class _:
        source = ("node:llm:model:gpt4o", "output")
        target = ("node:langchain:agent:assistant", "llm")

    # Agent response → Chat (loop back)
    @link
    class _:
        source = ("node:langchain:agent:assistant", "output")
        target = ("node:trigger:chat:main", "response")

    return "Chat demo active - send a message in the trigger chat node"
