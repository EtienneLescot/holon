"""Research Pipeline — Holon example workflow.

Demonstrates the four new node types:
  • logic.switch          — route query based on language detection
  • parser.structured     — parse LLM summary into a typed schema
  • code.python           — post-process the structured result
  • http.request          — fetch live data from a public API

Graph topology (simplified):

  [chat_trigger]
        │ out
        ▼
  [detect_lang]   ← llm (gpt-4o-mini)
        │ output (raw text "fr" / "en" / …)
        ▼
  [lang_switch]
     out_0 ─────► [fr_agent]  ← llm (gpt-4o)
     out_fallback ► [en_agent] ← llm (gpt-4o)
        both ▼ output
  [structure_output]           ← parser.structured
        │ output (SummaryResult Pydantic model)
        ▼
  [enrich_json]               ← code.python
        │ output
        ▼
  [post_result]               ← http.request (mock webhook)

Run with:
    holon run examples/research_pipeline.holon.py
"""

from holon.dsl import node, links, workflow

# ---------------------------------------------------------------------------
# Trigger
# ---------------------------------------------------------------------------

@node(type="trigger.chat", id="chat_trigger")
class ChatTrigger:
    """Chat trigger — the user types a research question; the answer is streamed back."""
    placeholder = "Ask a research question…"
    max_history = 50
    allow_markdown = True


# ---------------------------------------------------------------------------
# Step 1 — Detect language (LLM provider + agent)
# ---------------------------------------------------------------------------

@node(type="llm.model", id="mini_llm")
class MiniLLM:
    provider = "openai"
    model_name = "gpt-4o-mini"
    temperature = 0.0


@node(type="langchain.agent", id="detect_lang")
class DetectLang:
    system_prompt = (
        "You are a language detector. "
        "Reply with only the ISO 639-1 code of the input language (e.g. 'fr', 'en', 'de')."
    )
    user_prompt = ""


# ---------------------------------------------------------------------------
# Step 2 — Switch on detected language
# ---------------------------------------------------------------------------

@node(type="logic.switch", id="lang_switch")
class LangSwitch:
    input_expression = "{{ value }}"          # the raw text content
    rules = [
        {"operator": "equals", "value": "fr", "output": "out_0"},
    ]
    fallback = "out_fallback"


# ---------------------------------------------------------------------------
# Step 3a — French research agent
# ---------------------------------------------------------------------------

@node(type="llm.model", id="power_llm")
class PowerLLM:
    provider = "openai"
    model_name = "gpt-4o"
    temperature = 0.3


@node(type="langchain.agent", id="fr_agent")
class FrAgent:
    system_prompt = (
        "Tu es un expert en recherche scientifique. "
        "Fournis un résumé structuré de la question posée en français."
    )
    user_prompt = ""


# ---------------------------------------------------------------------------
# Step 3b — English research agent (fallback)
# ---------------------------------------------------------------------------

@node(type="langchain.agent", id="en_agent")
class EnAgent:
    system_prompt = (
        "You are a research expert. "
        "Provide a structured summary of the topic in English."
    )
    user_prompt = ""


# ---------------------------------------------------------------------------
# Step 4 — Parse LLM output into structured JSON
# ---------------------------------------------------------------------------

@node(type="parser.structured", id="structure_output")
class StructureOutput:
    schema = {
        "type": "object",
        "properties": {
            "title":    {"type": "string"},
            "summary":  {"type": "string"},
            "keywords": {"type": "array", "items": {"type": "string"}},
            "language": {"type": "string"},
        },
        "required": ["title", "summary", "keywords", "language"],
    }
    auto_fix = True


# ---------------------------------------------------------------------------
# Step 5 — Enrich with Python (add timestamp + word count)
# ---------------------------------------------------------------------------

@node(type="code.python", id="enrich_json")
class EnrichJson:
    code = """\
import datetime, json

# `data` is already a dict (the parsed Pydantic model dump)
result = dict(data) if isinstance(data, dict) else {"raw": str(data)}
result["word_count"] = len(result.get("summary", "").split())
result["processed_at"] = datetime.datetime.utcnow().isoformat() + "Z"
return result
"""
    timeout = 10


# ---------------------------------------------------------------------------
# Step 6 — POST the enriched result to a webhook
# ---------------------------------------------------------------------------

@node(type="http.request", id="post_result")
class PostResult:
    method = "POST"
    # httpbin.org echoes whatever we POST — great for demos
    url = "https://httpbin.org/post"
    headers = {"Content-Type": "application/json", "X-Holon-Origin": "research-pipeline"}
    response_type = "json"
    timeout = 15
    retry_count = 1
    ignore_errors = True          # don't fail the workflow if the webhook is down


# ---------------------------------------------------------------------------
# Wiring
# ---------------------------------------------------------------------------

@links
def research_pipeline_links():
    # trigger → language detector
    ChatTrigger.out      >> DetectLang.input
    MiniLLM.output       >> DetectLang.llm

    # detector → switch
    DetectLang.output    >> LangSwitch.input

    # switch → branch agents
    LangSwitch.out_0        >> FrAgent.input       # "fr" branch
    LangSwitch.out_fallback >> EnAgent.input        # everything else

    PowerLLM.output >> FrAgent.llm
    PowerLLM.output >> EnAgent.llm

    # both agents share the same structured-output parser
    StructureOutput.output >> FrAgent.parser
    StructureOutput.output >> EnAgent.parser

    # whichever agent ran → enrich
    FrAgent.output >> EnrichJson.input
    EnAgent.output >> EnrichJson.input

    # enriched result → webhook, then reply to chat
    EnrichJson.output    >> PostResult.input
    PostResult.output    >> ChatTrigger.response


@workflow
def research_pipeline():
    """Entry point — automatically resolved by the runner in graph mode."""
    pass
