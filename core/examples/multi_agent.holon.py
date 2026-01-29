"""Advanced example: Multi-agent workflow with spec nodes.

This example demonstrates a realistic workflow using:
- Multiple spec nodes (LLM, memory, tools)
- Data flow between nodes
- Custom resolvers
"""

from __future__ import annotations

from holon import node, workflow


# Spec nodes configuration

@node(type="llm.model", id="spec:llm:analyst")
class AnalystLLM:
    """LLM configured for data analysis."""
    model_name = "gpt-4o"
    temperature = 0.3  # Lower temperature for more focused analysis


@node(type="llm.model", id="spec:llm:creative")
class CreativeLLM:
    """LLM configured for creative writing."""
    model_name = "gpt-4o"
    temperature = 0.9  # Higher temperature for more creative output


@node(type="memory.buffer", id="spec:mem:conversation")
class ConversationMemory:
    """Shared conversation memory."""
    max_messages = 50


@node(type="memory.buffer", id="spec:mem:analysis")
class AnalysisMemory:
    """Memory for storing analysis results."""
    max_messages = 10


# Regular function nodes

@node
def extract_keywords(text: str) -> list[str]:
    """Extract keywords from text (mock implementation)."""
    # In real implementation, this would use NLP
    words = text.lower().split()
    keywords = [w for w in words if len(w) > 4]
    return keywords[:5]


@node
async def analyze_sentiment(text: str, llm_config: object) -> dict:
    """Analyze sentiment of text using LLM.
    
    In a real implementation, this would call the LLM API.
    For now, it's a mock that uses the LLM config.
    """
    # Mock sentiment analysis
    sentiment = "positive" if "good" in text.lower() else "neutral"
    confidence = 0.85
    
    # Store in analysis memory
    AnalysisMemory.add({
        "text": text[:50] + "..." if len(text) > 50 else text,
        "sentiment": sentiment,
        "confidence": confidence,
        "model": getattr(llm_config, "model_name", "unknown"),
    })
    
    return {
        "sentiment": sentiment,
        "confidence": confidence,
        "keywords": extract_keywords(text),
    }


@node
async def generate_response(
    analysis: dict,
    creative_llm: object,
) -> str:
    """Generate a creative response based on sentiment analysis.
    
    In a real implementation, this would use the LLM to generate text.
    """
    sentiment = analysis["sentiment"]
    keywords = analysis.get("keywords", [])
    
    # Mock response generation
    if sentiment == "positive":
        response = f"That's wonderful! I noticed you mentioned: {', '.join(keywords)}. "
        response += "Would you like to explore these topics further?"
    else:
        response = f"I understand. Key themes I detected: {', '.join(keywords)}. "
        response += "How can I help you with these?"
    
    # Store in conversation memory
    ConversationMemory.add({
        "type": "response",
        "content": response,
        "model": getattr(creative_llm, "model_name", "unknown"),
    })
    
    return response


@node
def get_context_summary() -> dict:
    """Get a summary of the current conversation context."""
    conv_messages = ConversationMemory.get_messages()
    analysis_history = AnalysisMemory.get_messages()
    
    return {
        "conversation_length": len(conv_messages),
        "analyses_performed": len(analysis_history),
        "recent_analyses": analysis_history[-3:] if analysis_history else [],
    }


# Main workflow

@workflow
async def multi_agent_workflow(user_input: str = "This is a good example of how spec nodes work!") -> dict:
    """Multi-agent workflow demonstrating spec node resolution.
    
    Flow:
    1. Analyze user input sentiment (using analyst LLM config)
    2. Generate creative response (using creative LLM config)
    3. Store everything in appropriate memory buffers
    4. Return comprehensive result
    
    Args:
        user_input: User's input message
    
    Returns:
        Dictionary with analysis, response, and context
    """
    # Store user input in conversation memory
    ConversationMemory.add({
        "type": "user_input",
        "content": user_input,
    })
    
    # Step 1: Analyze sentiment using analyst LLM
    analysis = await analyze_sentiment(user_input, AnalystLLM)
    
    # Step 2: Generate creative response
    response = await generate_response(analysis, CreativeLLM)
    
    # Step 3: Get context summary
    context = get_context_summary()
    
    # Return comprehensive result
    return {
        "user_input": user_input,
        "analysis": analysis,
        "response": response,
        "context": context,
        "spec_nodes_used": {
            "analyst_llm": {
                "model": getattr(AnalystLLM, "model_name", "not resolved"),
                "temperature": getattr(AnalystLLM, "temperature", "not resolved"),
            },
            "creative_llm": {
                "model": getattr(CreativeLLM, "model_name", "not resolved"),
                "temperature": getattr(CreativeLLM, "temperature", "not resolved"),
            },
            "memories": {
                "conversation_size": len(ConversationMemory.get_messages()),
                "analysis_size": len(AnalysisMemory.get_messages()),
            },
        },
    }


# Note: This file should be run via run_multi_agent.py to ensure
# spec nodes are properly resolved during module loading.
