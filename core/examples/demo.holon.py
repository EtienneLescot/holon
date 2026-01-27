from __future__ import annotations

from holon import node, spec, workflow, link
spec("spec:langchain.agent:9c36310c-95e5-4b41-885f-62d0200f7f4f", type = "langchain.agent", label = "LangChain Agent", props = {"systemPrompt": "You are a helpful assistant.", "promptTemplate": "{input}", "temperature": 0.2, "maxTokens": 1024, "agentType": "tool-calling"})

spec(
    "spec:langchain.agent:13b5b27a-6528-4164-bc86-704a53e86070",
    type="langchain.agent",
    label="LangChain Agent",
    props={
        "systemPrompt": "You are a helpful assistant.",
        "promptTemplate": "{input}",
        "temperature": 0.2,
        "maxTokens": 1024,
        "agentType": "tool-calling",
    },
)


@node
def analyze(x: int) -> int:
    """Toy node for end-to-end demo."""

    return x + 1


@node
async def summarize(x: int) -> str:
    return f"result={x}"


@workflow
async def main() -> str:
    y = analyze(1)
    link("node:summarize", "output", "spec:langchain.agent:bcdef6df-2792-4b59-af0f-f62392b1337e", "input")
    return await summarize(y)
