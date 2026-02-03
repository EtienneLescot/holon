from holon.dsl import node, link, workflow

@node
def researcher(topic: str) -> str:
    """Simulates a researcher node."""
    return f"Research results about {topic}: Holon is a code-first workflow engine."

# LLM Model configuration
@node(type="llm.model")
class GPT4o:
    """GPT-4o language model."""
    model_name = "gpt-4o"
    temperature = 0.7

# Langchain Agent configuration
@node(type="langchain.agent")
class AIAssistant:
    """AI Assistant agent."""
    system_prompt = "You are a helpful assistant. Use the tools provided to answer the user's question."
    user_prompt = "Tell me about {{researcher.output}}"

@workflow
def assistant_workflow():
    # Connect model to agent's LLM port
    @link
    class _:
        source = (GPT4o, "output")
        target = (AIAssistant, "llm")
    
    # Connect researcher to agent as a tool
    @link
    class _:
        source = (researcher, "output")
        target = (AIAssistant, "tools")

    return AIAssistant
