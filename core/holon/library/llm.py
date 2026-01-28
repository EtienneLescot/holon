from holon import node
from holon.library.credentials import credentials_manager
from langchain_openai import ChatOpenAI
from langchain_core.language_models import BaseChatModel

@node
def llm_model(
    model_name: str = "gpt-4o",
    temperature: float = 0.7,
    provider: str = "openai",
) -> BaseChatModel:
    """Initialize a LangChain chat model.
    
    Args:
        model_name: The name of the model to use (e.g., 'gpt-4o', 'gpt-3.5-turbo').
        temperature: Sampling temperature.
        provider: The provider to use (currently only 'openai' supported).
    """
    api_key = credentials_manager.get_api_key(provider)
    
    if provider == "openai":
        return ChatOpenAI(model=model_name, temperature=temperature, openai_api_key=api_key)
    
    raise ValueError(f"Unsupported provider: {provider}")
