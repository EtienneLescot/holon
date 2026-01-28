from typing import Any, List, Optional
from holon import node
from langchain.agents import AgentExecutor, create_openai_functions_agent
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
    
    agent = create_openai_functions_agent(llm, tools, prompt)
    
    agent_executor = AgentExecutor(
        agent=agent,
        tools=tools,
        verbose=True,
        memory=memory
    )
    
    response = agent_executor.invoke({"input": final_input})
    return response["output"]
        memory=memory
    )
    
    response = agent_executor.invoke({"input": input})
    return response["output"]
