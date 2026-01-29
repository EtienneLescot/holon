from typing import Any, List, Optional
from holon import node
from typing import cast
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.language_models import BaseChatModel
from langchain_core.tools import BaseTool

@node
def langchain_agent(
    input: str = "",
    llm: BaseChatModel = None,
    system_prompt: str = "You are a helpful assistant.",
    user_prompt: str = "",
    tools: List[BaseTool] = None,
    memory: Any = None,
) -> str:
    """Run a LangChain agent.
    
    Args:
        input: User input from a port (dynamic).
        llm: The language model to use.
        system_prompt: The system message.
        user_prompt: Static user input from properties.
        tools: List of tools the agent can use.
        memory: Optional memory component.
    """
    if tools is None:
        tools = []
    
    # Use user_prompt as fallback if input is empty
    final_input = input if input else user_prompt
    
    if not llm:
        raise ValueError("LLM is required")

    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        MessagesPlaceholder(variable_name="chat_history") if memory else ("placeholder", "{chat_history}"),
        ("human", "{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad"),
    ])
    
    # Create an agent/executor compatible with multiple langchain versions.
    try:
        from langchain.agents import create_openai_functions_agent

        agent_or_executor = create_openai_functions_agent(llm, tools, prompt)
    except Exception:
        from langchain.agents import initialize_agent, AgentType

        agent_or_executor = initialize_agent(
            tools,
            llm,
            agent=AgentType.OPENAI_FUNCTIONS,
            verbose=True,
            agent_kwargs={"prompt": prompt},
        )

    # If initialize_agent/create_openai_functions_agent returned an executor-like object,
    # prefer its `invoke` or `run` methods. Otherwise, try to construct an executor.
    if hasattr(agent_or_executor, "invoke"):
        response = agent_or_executor.invoke({"input": final_input})
        return response["output"]
    if hasattr(agent_or_executor, "run"):
        return agent_or_executor.run(final_input)

    # As a last resort, try to import AgentExecutor dynamically and wrap the agent.
    try:
        from langchain.agents import AgentExecutor as _AgentExecutor

        agent_executor = _AgentExecutor(
            agent=agent_or_executor,
            tools=tools,
            verbose=True,
            memory=memory,
        )
        response = agent_executor.invoke({"input": final_input})
        return response["output"]
    except Exception as exc:
        raise RuntimeError("Unable to construct/run LangChain agent") from exc
