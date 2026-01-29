from __future__ import annotations

from holon import node, workflow, link


@node(type="langchain.agent", id="spec:langchain.agent:1992b72f-78a7-4e0a-8f2f-9c7bbea81344")
class LangChainAgent1:
    """LangChain Agent for telling a story about a brave robot."""
    system_prompt = "You are a helpful assistant."
    user_prompt = "Tell me a story about a brave robot."


@node(type="langchain.agent", id="spec:langchain.agent:935fae62-2635-49d1-9b9d-49d4f899ed43")
class LangChainAgent2:
    """LangChain Agent for telling a story about a brave robot."""
    system_prompt = "You are a helpful assistant."
    user_prompt = "Tell me a story about a brave robot."


@node(type="llm.model", id="spec:llm.model:aa92f5e2-4ffe-48a9-97a3-a91eefb1fc4a")
class LLMModel:
    """GPT-4o model configuration."""
    model_name = "gpt-4o"
    temperature = 0.7
    provider = "openai"


@node(type="parser.json", id="spec:parser.json:55773ecd-02c4-419e-b754-091e7d54f06b")
class JSONParser:
    """JSON Parser with empty schema."""
    schema = {}


@node(type="langchain.agent", id="spec:langchain.agent:9c36310c-95e5-4b41-885f-62d0200f7f4f")
class LangChainAgent3:
    """LangChain Agent asking about France's capital."""
    system_prompt = "You are a helpful assistant."
    user_prompt = "What is the capital of France?"


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
    link("spec:parser.json:55773ecd-02c4-419e-b754-091e7d54f06b", "parser", "spec:langchain.agent:9c36310c-95e5-4b41-885f-62d0200f7f4f", "outputParser")
    link("node:analyze", "output", "spec:langchain.agent:9c36310c-95e5-4b41-885f-62d0200f7f4f", "input")
    link("node:analyze", "output", "spec:langchain.agent:9c36310c-95e5-4b41-885f-62d0200f7f4f", "memory")
    link("spec:llm.model:aa92f5e2-4ffe-48a9-97a3-a91eefb1fc4a", "llm", "spec:langchain.agent:9c36310c-95e5-4b41-885f-62d0200f7f4f", "llm")
    link("spec:parser.json:55773ecd-02c4-419e-b754-091e7d54f06b", "parser", "spec:langchain.agent:9c36310c-95e5-4b41-885f-62d0200f7f4f", "input")
    return await summarize(y)
