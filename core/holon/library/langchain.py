from typing import Any, List, Optional
from holon import node
from typing import cast
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.language_models import BaseChatModel
from langchain_core.tools import BaseTool

@node
async def langchain_agent(
    input: str = "",
    llm: BaseChatModel = None,
    system_prompt: str = "You are a helpful assistant.",
    user_prompt: str = "",
    tools: List[BaseTool] = None,
    memory: Any = None,
    output_parser: Any = None,
) -> Any:
    """Run a LangChain agent.
    
    Args:
        input: User input from a port (dynamic).
        llm: The language model to use.
        system_prompt: The system message.
        user_prompt: Static user input from properties.
        tools: List of tools the agent can use.
        memory: Optional memory component.
        output_parser: Optional structured output parser (parser.structured node).
            When provided, its format instructions are appended to the system
            prompt and the raw LLM output is parsed before returning.
    """
    if tools is None:
        tools = []
    
    # Use user_prompt as fallback if input is empty
    final_input = input if input else user_prompt
    
    if not llm:
        raise ValueError("LLM is required")

    # Inject format instructions when a structured parser is attached
    effective_system_prompt = system_prompt
    if output_parser is not None:
        try:
            format_instructions = output_parser.get_format_instructions()
            effective_system_prompt = f"{system_prompt}\n\n{format_instructions}"
        except Exception:
            pass  # Parser missing get_format_instructions — skip gracefully

    # For now, use a simple chain without tools (modern LangChain API)
    # This avoids deprecated initialize_agent and create_openai_functions_agent
    prompt = ChatPromptTemplate.from_messages([
        ("system", effective_system_prompt),
        ("human", "{input}"),
    ])
    
    # Create a simple chain: prompt | llm
    chain = prompt | llm
    
    # Invoke the chain (async to support async API key retrieval)
    response = await chain.ainvoke({"input": final_input})
    
    # Extract text content
    if hasattr(response, "content"):
        raw_text = response.content
    else:
        raw_text = str(response)

    # Parse structured output when a parser is present
    if output_parser is not None:
        try:
            return output_parser.parse(raw_text)
        except Exception:
            # Return raw text if parsing fails (prefer not to crash)
            return raw_text

    return raw_text
