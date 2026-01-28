from holon.dsl import node, spec, link, workflow
from holon.library import langchain_agent, llm_model

@node
def researcher(topic: str) -> str:
    """Simulates a researcher node."""
    return f"Research results about {topic}: Holon is a code-first workflow engine."

@workflow
def assistant_workflow():
    # 1. Define the LLM model
    model = spec(
        llm_model,
        type="llm.model",
        label="GPT-4o",
        props={
            "model_name": "gpt-4o",
            "temperature": 0.7
        }
    )

    # 2. Define the Langchain Agent
    agent = spec(
        langchain_agent,
        type="langchain.agent",
        label="AI Assistant",
        props={
            "system_prompt": "You are a helpful assistant. Use the tools provided to answer the user's question.",
            "user_prompt": "Tell me about {topic}"
        }
    )

    # 3. Connection: model -> agent
    link(model, agent, target_port="llm")
    
    # 4. Connection: researcher -> agent (as a tool)
    link(researcher, agent, target_port="tools")

    return agent
