from __future__ import annotations

from holon import node, spec, workflow, link
spec("spec:parser.json:55773ecd-02c4-419e-b754-091e7d54f06b", type = "parser.json", label = "JSON Parser", props = {"schema": {}})
spec("spec:langchain.agent:f5c4f0d2-b59a-49e9-939e-b169309606fa", type = "langchain.agent", label = "LangChain Agent", props = {"systemPrompt": "You are a helpful assistant.", "promptTemplate": "{input}", "temperature": 0.2, "maxTokens": 1024, "agentType": "tool-calling"})
spec("spec:llm.model:e1f41d4a-7b51-451e-a25d-a35a3d411d76", type = "llm.model", label = "LLM Model", props = {"provider": "openai", "model": "gpt-4o-mini"})
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
    link("node:analyze", "output", "spec:langchain.agent:9c36310c-95e5-4b41-885f-62d0200f7f4f", "input")
    link("spec:llm.model:e1f41d4a-7b51-451e-a25d-a35a3d411d76", "llm", "spec:langchain.agent:9c36310c-95e5-4b41-885f-62d0200f7f4f", "llm")
    return await summarize(y)
