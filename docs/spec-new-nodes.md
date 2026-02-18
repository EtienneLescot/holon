# Spec — 4 nouveaux nœuds : Switch, Structured Output Parser, Code, HTTP Request

**Date** : 2026-02-18  
**Status** : Draft — pour validation  
**Phase** : 7.0 (flow control & utility nodes)  
**Dépendances** : [`spec-data-transport.md`](spec-data-transport.md) (DataEnvelope, PortMapping)

---

## 0) Résumé exécutif

Cet ajout apporte **quatre nœuds fondamentaux** absents de Holon, inspirés du workflow n8n "Social Post Assistant". Ensemble, ils débloquent les **workflows à embranchements**, le **traitement de données**, les **intégrations API** et le **contrôle fin des sorties LLM**.

| # | Nœud | Type ID | Catégorie | Rôle |
|---|---|---|---|---|
| 1 | **Switch** | `logic.switch` | Logic | Routage conditionnel multi-branches |
| 2 | **Structured Output Parser** | `parser.structured` | Parsers | Contraint la sortie LLM à un schéma JSON |
| 3 | **Code** | `code.python` | Transform | Exécution de code Python inline |
| 4 | **HTTP Request** | `http.request` | Integration | Appels HTTP sortants (GET/POST/PUT/DELETE) |

### Impact architectural

- **Engine** : introduction d'une nouvelle catégorie de nœuds "exécutables non-LangChain" (`logic.*`, `code.*`, `http.*`) dans `_build_execution_order()` et `_execute_nodes()`.
- **DSL** : ajout de 4 entrées dans `_STANDARD_PORTS`.
- **Registry** : 4 nouveaux `@register_spec_type(...)` resolvers.
- **UI** : 4 entrées dans `ui_nodes_meta.json` + métadonnées dans `api.py`.

---

## 1) Nœud Switch — `logic.switch`

### 1.1) Vue d'ensemble

Le **Switch** évalue une expression d'entrée contre N conditions ordonnées et **route les données vers la première sortie correspondante**. Si aucune condition ne matche, un port `fallback` est utilisé.

C'est l'équivalent d'un `switch/case` ou `if/elif/else`.

### 1.2) Déclaration DSL

```python
from holon import node, links

@node(type="logic.switch", id="node:switch:routing")
class InfoRouter:
    """Route based on needs_details field."""
    input_expression = "{{ data.needs_details }}"
    rules = [
        {"label": "Complete",   "operator": "equals", "value": False, "output": "out_0"},
        {"label": "Incomplete", "operator": "equals", "value": True,  "output": "out_1"},
    ]
    fallback = "out_fallback"
```

### 1.3) Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `input_expression` | `str` | `"{{ data }}"` | Expression évaluée sur le `DataEnvelope.content` entrant. Supporte les templates Mustache (ou accès dot-notation). |
| `rules` | `list[Rule]` | `[]` | Liste ordonnée de conditions. La première qui matche gagne. |
| `rules[i].label` | `str` | `"Rule {i}"` | Label d'affichage pour cette branche. |
| `rules[i].operator` | `str` | `"equals"` | Opérateur de comparaison (voir tableau ci-dessous). |
| `rules[i].value` | `Any` | — | Valeur de référence pour la comparaison. |
| `rules[i].output` | `str` | `"out_{i}"` | ID du port de sortie associé. |
| `fallback` | `str` | `"out_fallback"` | ID du port de sortie si aucune rule ne matche. |

**Opérateurs supportés** :

| Opérateur | Description | Exemple |
|---|---|---|
| `equals` | Égalité stricte (`==`) | `value: True` |
| `not_equals` | Différent (`!=`) | `value: "error"` |
| `contains` | Contient (substring ou élément) | `value: "urgent"` |
| `greater_than` | Supérieur (`>`) — numérique | `value: 10` |
| `less_than` | Inférieur (`<`) — numérique | `value: 0` |
| `is_empty` | Vide/None/falsy (pas de `value`) | — |
| `is_not_empty` | Non-vide/truthy (pas de `value`) | — |
| `regex` | Match regex | `value: "^err_.*"` |

### 1.4) Ports

```python
# Ports dynamiques : 1 input + N outputs (1 par rule) + 1 fallback
inputs = [
    PortSpec(id="input", kind="data", label="Input", multi=False),
]
outputs = [
    # Générés dynamiquement à partir des rules
    PortSpec(id="out_0", kind="data", label="Complete", multi=False),
    PortSpec(id="out_1", kind="data", label="Incomplete", multi=False),
    PortSpec(id="out_fallback", kind="data", label="Fallback", multi=False),
]
```

**Convention** : les ports de sortie sont nommés `out_0`, `out_1`, ..., `out_{N-1}`, `out_fallback`. Le label de chaque port reprend le `rules[i].label`.

### 1.5) DSL — connexion `>>`

```python
@links
def define_routing():
    OrchestratorAgent.output >> InfoRouter.input
    InfoRouter.out_0 >> DiscordValidation.input     # needs_details == False
    InfoRouter.out_1 >> DiscordAskQuestion.input     # needs_details == True
    InfoRouter.out_fallback >> ErrorHandler.input     # aucune rule ne matche
```

**Implémentation DSL** : comme les ports de sortie sont dynamiques (dépendants des rules), `_attach_ports_to_class()` doit générer les ports à partir de `rules` au moment du décorateur. En attendant, les ports `out_0`, `out_1`, etc. sont créés par accès dynamique via `__getattr__` sur la classe.

### 1.6) Comportement runtime (Engine)

```python
async def _execute_switch_node(self, ctx, node, inputs):
    """Évalue les rules et route le DataEnvelope vers le bon port de sortie."""
    
    envelope = inputs.get("input")
    content = unwrap(envelope)  # Extrait .content du DataEnvelope
    
    # Évaluer input_expression sur le content
    evaluated = evaluate_expression(node.props["input_expression"], content)
    
    # Tester chaque rule dans l'ordre
    for rule in node.props.get("rules", []):
        if match_rule(evaluated, rule["operator"], rule.get("value")):
            output_port = rule.get("output", f"out_{i}")
            ctx.port_registry.set_value(node.id, output_port, envelope)
            return envelope
    
    # Fallback
    fallback_port = node.props.get("fallback", "out_fallback")
    ctx.port_registry.set_value(node.id, fallback_port, envelope)
    return envelope
```

**Point clé** : contrairement aux autres nœuds qui écrivent sur un seul port `output`, le Switch écrit sur **un seul port parmi N**. L'engine doit gérer ce cas : les nœuds connectés aux ports non-activés ne sont **pas exécutés** (pas de données = pas de déclenchement).

### 1.7) Format des données

Le Switch **ne transforme pas** les données : il fait du pass-through. Le `DataEnvelope` entrant est redistribué tel quel sur le port de sortie sélectionné.

```python
# Input
DataEnvelope(type="data", content={"needs_details": False, "Subject": "AI"}, ...)

# Output (sur out_0 si needs_details == False) — même objet
DataEnvelope(type="data", content={"needs_details": False, "Subject": "AI"}, ...)
```

---

## 2) Nœud Structured Output Parser — `parser.structured`

### 2.1) Vue d'ensemble

Le **Structured Output Parser** prend un **JSON Schema** en configuration et produit un objet runtime qui peut être injecté dans un agent LangChain. Il force le LLM à retourner une sortie conforme au schéma.

Dans le workflow n8n, ce nœud est utilisé 7 fois pour contraindre les agents à retourner des JSON typés (`approved`, `needs_details`, `image_prompt`, etc.).

### 2.2) Déclaration DSL

```python
@node(type="parser.structured", id="node:parser:brief_format")
class BriefFormat:
    """Parse LLM output into structured brief fields."""
    json_schema = {
        "type": "object",
        "properties": {
            "needs_details": {
                "type": "boolean",
                "description": "Whether missing info prevents generation"
            },
            "Subject": {
                "type": "string",
                "description": "Main subject of the post"
            },
            "Tone": {
                "type": "string",
                "description": "Tone/style (professional, casual, etc.)"
            },
        },
        "required": ["needs_details", "Subject", "Tone"]
    }
```

### 2.3) Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `json_schema` | `dict` | `{}` | JSON Schema définissant la structure attendue de la sortie LLM. |
| `auto_fix` | `bool` | `True` | Si le LLM retourne un JSON invalide, tenter de le corriger automatiquement (retry avec instructions explicites). |

### 2.4) Ports

```python
inputs = []   # Pas d'input data — c'est un provider
outputs = [
    PortSpec(id="output", kind="parser", label="Parser", multi=False),
]
```

**Rôle** : Ce nœud est un **provider** (comme `llm.model` ou `memory.buffer`). Il ne reçoit pas de données mais est **injecté** dans un agent via `.uses()`.

### 2.5) DSL — injection via `.uses()`

```python
@links
def define_routing():
    OrchestratorAgent.uses(
        llm=LlmModel.output,
        parser=BriefFormat.output,  # Injecte le parser
    )
```

**Note** : Cela nécessite d'ajouter un port `parser` aux inputs de `langchain.agent` dans `_STANDARD_PORTS`.

### 2.6) Comportement runtime (Resolver)

```python
@register_spec_type("parser.structured")
def resolve_structured_parser(props: dict) -> Any:
    """Crée un LangChain StructuredOutputParser ou PydanticOutputParser."""
    
    json_schema = props.get("json_schema", {})
    auto_fix = props.get("auto_fix", True)
    
    from langchain.output_parsers import PydanticOutputParser
    from pydantic import create_model
    
    # Convertir le JSON Schema en modèle Pydantic dynamique
    pydantic_model = json_schema_to_pydantic(json_schema)
    parser = PydanticOutputParser(pydantic_model=pydantic_model)
    
    return parser
```

**Intégration avec l'agent** : Dans `_execute_agent_node()`, si un parser est fourni via le port `parser`, il est passé à `langchain_agent()` qui l'utilise pour formater les instructions et parser la sortie.

### 2.7) Modification nécessaire de `langchain_agent()`

La fonction `langchain_agent()` dans `library/langchain.py` doit accepter un paramètre `output_parser` optionnel :

```python
async def langchain_agent(
    input: str,
    llm: Any,
    system_prompt: str,
    user_prompt: str = "",
    tools: list = [],
    memory: Any = None,
    output_parser: Any = None,  # NOUVEAU
) -> str | dict:
    """..."""
    
    if output_parser:
        # Injecter les format_instructions dans le system_prompt
        format_instructions = output_parser.get_format_instructions()
        system_prompt += f"\n\n{format_instructions}"
        
        # Après exécution, parser la sortie
        raw_output = await agent.ainvoke(...)
        return output_parser.parse(raw_output)
    else:
        return await agent.ainvoke(...)
```

---

## 3) Nœud Code — `code.python`

### 3.1) Vue d'ensemble

Le nœud **Code** exécute du code Python arbitraire dans un sandbox restreint. Il reçoit des données en entrée, les transforme via du code utilisateur, et émet le résultat.

Dans le workflow n8n, le nœud Code est utilisé pour transformer des données (construire des phrases à partir de champs, extraire des champs spécifiques, etc.).

### 3.2) Déclaration DSL

**Option A — Code inline dans les props** (pour les petites transformations) :

```python
@node(type="code.python", id="node:code:build_brief")
class BuildBrief:
    """Build a readable sentence from brief fields."""
    code = """
subject = data.get("Subject", "")
tone = data.get("Tone", "")
audience = data.get("Audience", "")
parts = []
if subject: parts.append(f"Subject: {subject}")
if tone: parts.append(f"Tone: {tone}")
if audience: parts.append(f"Audience: {audience}")
result = ", ".join(parts) if parts else "No brief provided."
return {"output": result}
"""
```

**Option B — Décorateur `@node` sur une fonction** (existant mais non exécuté) :

```python
@node
def build_brief(data: dict) -> dict:
    """Build a readable sentence from brief fields."""
    subject = data.get("Subject", "")
    tone = data.get("Tone", "")
    parts = []
    if subject:
        parts.append(f"Subject: {subject}")
    if tone:
        parts.append(f"Tone: {tone}")
    result = ", ".join(parts) if parts else "No brief provided."
    return {"output": result}
```

> **Recommandation** : implémenter les deux modes. L'option B (`@node` sur fonction) est plus idiomatique pour Holon et nécessite principalement de compléter le support `inline_code` dans l'engine. L'option A (`code.python` spec) est utile pour du code configurable depuis l'UI.

### 3.3) Props (Option A uniquement)

| Prop | Type | Default | Description |
|---|---|---|---|
| `code` | `str` | `""` | Code Python à exécuter. La variable `data` contient le contenu du `DataEnvelope` entrant. Doit retourner un `dict`. |
| `timeout` | `int` | `30` | Timeout d'exécution en secondes. |
| `allowed_imports` | `list[str]` | `["json", "re", "math", "datetime"]` | Modules autorisés dans le code. |

### 3.4) Ports

```python
inputs = [
    PortSpec(id="input", kind="data", label="Input", multi=False),
]
outputs = [
    PortSpec(id="output", kind="data", label="Output", multi=False),
]
```

### 3.5) DSL — connexions

```python
@links
def define_routing():
    DiscordValidation.output >> BuildBrief.input
    BuildBrief.output >> WriterAgent.input
```

### 3.6) Comportement runtime

```python
@register_spec_type("code.python")
def resolve_code_python(props: dict) -> Any:
    """Crée un exécuteur de code Python sandboxé."""
    
    code = props.get("code", "")
    timeout = props.get("timeout", 30)
    allowed_imports = props.get("allowed_imports", ["json", "re", "math", "datetime"])
    
    async def execute(data: Any) -> dict:
        """Exécute le code utilisateur dans un namespace restreint."""
        import json, re, math, datetime
        
        # Namespace sandbox
        safe_globals = {"__builtins__": {
            "len": len, "str": str, "int": int, "float": float, "bool": bool,
            "list": list, "dict": dict, "tuple": tuple, "set": set,
            "range": range, "enumerate": enumerate, "zip": zip,
            "min": min, "max": max, "sum": sum, "abs": abs, "round": round,
            "sorted": sorted, "reversed": reversed, "filter": filter, "map": map,
            "isinstance": isinstance, "type": type, "print": print,
            "True": True, "False": False, "None": None,
        }}
        
        # Injecter les modules autorisés
        import_map = {"json": json, "re": re, "math": math, "datetime": datetime}
        for mod_name in allowed_imports:
            if mod_name in import_map:
                safe_globals[mod_name] = import_map[mod_name]
        
        # Injecter les données d'entrée
        safe_globals["data"] = data
        
        # Envelopper le code dans une fonction pour supporter return
        wrapped = f"def __holon_code__():\n"
        for line in code.strip().split("\n"):
            wrapped += f"    {line}\n"
        wrapped += "\n__holon_result__ = __holon_code__()\n"
        
        local_ns = {}
        exec(wrapped, safe_globals, local_ns)
        
        return local_ns.get("__holon_result__", {})
    
    return execute
```

**Pour l'Option B** (`@node` sur fonction — `inline_code`) : l'engine doit retrouver la fonction Python originale (stockée dans le module parsé) et l'appeler avec les inputs :

```python
async def _execute_inline_code_node(self, ctx, node, inputs):
    """Exécute un nœud inline_code (fonction @node)."""
    
    # La fonction est stockée dans le module chargé par le runner
    func = ctx.module_namespace.get(node.name)
    if func is None:
        raise RuntimeError(f"Function '{node.name}' not found")
    
    # Préparer les arguments
    data = unwrap(inputs.get("input"))
    
    # Appeler la fonction (sync ou async)
    import asyncio, inspect
    if inspect.iscoroutinefunction(func):
        result = await func(data)
    else:
        result = func(data)
    
    return result
```

### 3.7) Format des données

```python
# Input
DataEnvelope(
    type="data",
    content={"Subject": "AI Trends", "Tone": "Professional", "Audience": "Developers"},
    ...
)

# Output (après exécution du code)
DataEnvelope(
    type="data",
    content={"output": "Subject: AI Trends, Tone: Professional, Audience: Developers"},
    origin={"nodeId": "node:code:build_brief", "port": "output"},
    ...
)
```

---

## 4) Nœud HTTP Request — `http.request`

### 4.1) Vue d'ensemble

Le nœud **HTTP Request** effectue des **appels HTTP sortants** vers des APIs externes. Il supporte GET, POST, PUT, PATCH, DELETE avec headers configurables, body JSON/form, et authentification.

### 4.2) Déclaration DSL

```python
@node(type="http.request", id="node:http:search_api")
class SearchAPI:
    """Search for current news via SerpApi."""
    method = "GET"
    url = "https://serpapi.com/search"
    query_params = {
        "engine": "google",
        "q": "{{ data.query }}",
    }
    headers = {
        "Content-Type": "application/json",
    }
    auth_type = "api_key"
    auth_credential = "serpapi"  # Référence au credentials_manager
    response_type = "json"
```

### 4.3) Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `method` | `str` | `"GET"` | Méthode HTTP (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`). |
| `url` | `str` | `""` | URL de destination. Supporte les templates : `{{ data.field }}`. |
| `headers` | `dict[str, str]` | `{}` | Headers HTTP. Supporte les templates. |
| `query_params` | `dict[str, str]` | `{}` | Paramètres de query string. Supporte les templates. |
| `body` | `dict \| str \| None` | `None` | Corps de la requête (pour POST/PUT/PATCH). Supporte les templates. |
| `body_type` | `str` | `"json"` | Format du body : `"json"`, `"form"`, `"raw"`. |
| `auth_type` | `str` | `"none"` | Type d'authentification : `"none"`, `"api_key"`, `"bearer"`, `"basic"`. |
| `auth_credential` | `str` | `""` | Nom du credential dans `credentials_manager`. |
| `auth_header` | `str` | `"Authorization"` | Header utilisé pour l'auth (pour `api_key`). |
| `auth_query_param` | `str` | `""` | Param de querystring pour l'API key (ex: `"api_key"`). Si défini, la clé est ajoutée en query param au lieu du header. |
| `response_type` | `str` | `"json"` | Parsing de la réponse : `"json"`, `"text"`, `"binary"`. |
| `timeout` | `int` | `30` | Timeout en secondes. |
| `retry` | `int` | `0` | Nombre de retries en cas d'erreur. |
| `ignore_errors` | `bool` | `False` | Si `True`, ne lève pas d'exception sur HTTP 4xx/5xx. |

### 4.4) Ports

```python
inputs = [
    PortSpec(id="input", kind="data", label="Input", multi=False),
]
outputs = [
    PortSpec(id="output", kind="data", label="Response", multi=False),
]
```

### 4.5) DSL — connexions

```python
@links
def define_routing():
    BuildBrief.output >> SearchAPI.input
    SearchAPI.output >> WriterAgent.input
```

### 4.6) Comportement runtime

```python
@register_spec_type("http.request")
def resolve_http_request(props: dict) -> Any:
    """Crée un exécuteur HTTP configurable."""
    
    import aiohttp
    from holon.library.credentials import credentials_manager
    
    method = props.get("method", "GET").upper()
    url_template = props.get("url", "")
    headers_template = props.get("headers", {})
    query_params_template = props.get("query_params", {})
    body_template = props.get("body")
    body_type = props.get("body_type", "json")
    auth_type = props.get("auth_type", "none")
    auth_credential = props.get("auth_credential", "")
    auth_header = props.get("auth_header", "Authorization")
    auth_query_param = props.get("auth_query_param", "")
    response_type = props.get("response_type", "json")
    timeout = props.get("timeout", 30)
    retry_count = props.get("retry", 0)
    ignore_errors = props.get("ignore_errors", False)
    
    async def execute(data: Any = None) -> dict:
        """Exécute la requête HTTP."""
        
        # Résoudre les templates
        context = {"data": data} if data else {"data": {}}
        url = render_template(url_template, context)
        headers = {k: render_template(v, context) for k, v in headers_template.items()}
        query_params = {k: render_template(v, context) for k, v in query_params_template.items()}
        
        # Authentification
        if auth_type == "bearer" and auth_credential:
            api_key = credentials_manager.get_api_key(auth_credential)
            if api_key:
                headers[auth_header] = f"Bearer {api_key}"
        elif auth_type == "api_key" and auth_credential:
            api_key = credentials_manager.get_api_key(auth_credential)
            if api_key:
                if auth_query_param:
                    query_params[auth_query_param] = api_key
                else:
                    headers[auth_header] = api_key
        
        # Body
        body = None
        if body_template and method in ("POST", "PUT", "PATCH"):
            if isinstance(body_template, dict):
                body = {k: render_template(str(v), context) for k, v in body_template.items()}
            else:
                body = render_template(str(body_template), context)
        
        # Exécuter la requête
        async with aiohttp.ClientSession() as session:
            for attempt in range(retry_count + 1):
                try:
                    kwargs = {
                        "url": url,
                        "headers": headers,
                        "params": query_params,
                        "timeout": aiohttp.ClientTimeout(total=timeout),
                    }
                    
                    if body and body_type == "json":
                        kwargs["json"] = body
                    elif body and body_type == "form":
                        kwargs["data"] = body
                    elif body:
                        kwargs["data"] = body
                    
                    async with session.request(method, **kwargs) as resp:
                        if not ignore_errors:
                            resp.raise_for_status()
                        
                        if response_type == "json":
                            response_data = await resp.json()
                        elif response_type == "text":
                            response_data = await resp.text()
                        else:
                            response_data = await resp.read()
                        
                        return {
                            "status": resp.status,
                            "headers": dict(resp.headers),
                            "data": response_data,
                        }
                        
                except Exception as e:
                    if attempt == retry_count:
                        raise
                    continue
    
    return execute
```

### 4.7) Template engine

Pour les templates `{{ data.field }}` dans les URL, headers, query params et body :

```python
import re

def render_template(template: str, context: dict) -> str:
    """Résout les expressions {{ ... }} dans une string."""
    def replace_match(match):
        expr = match.group(1).strip()
        try:
            # Accès dot-notation simple : data.field.subfield
            parts = expr.split(".")
            value = context
            for part in parts:
                if isinstance(value, dict):
                    value = value.get(part, "")
                else:
                    value = getattr(value, part, "")
            return str(value)
        except Exception:
            return match.group(0)  # Retourner le template inchangé
    
    return re.sub(r"\{\{\s*(.+?)\s*\}\}", replace_match, template)
```

### 4.8) Format des données

```python
# Input (optionnel — fournit le contexte pour les templates)
DataEnvelope(
    type="data",
    content={"query": "AI trends 2026", "api_key": "..."},
    ...
)

# Output
DataEnvelope(
    type="data",
    content={
        "status": 200,
        "headers": {"Content-Type": "application/json", ...},
        "data": {"results": [...], "total": 42}
    },
    contentType="application/json",
    origin={"nodeId": "node:http:search_api", "port": "output"},
    ...
)
```

---

## 5) Modifications transversales

### 5.1) `_STANDARD_PORTS` (dsl.py)

Ajouter les 4 types :

```python
_STANDARD_PORTS: dict[str, dict[str, list[str]]] = {
    # ... existants ...
    
    "logic.switch": {
        "inputs": ["input"],
        "outputs": ["out_0", "out_1", "out_fallback"],  # Sera étendu dynamiquement
    },
    "parser.structured": {
        "inputs": [],
        "outputs": ["output"],
    },
    "code.python": {
        "inputs": ["input"],
        "outputs": ["output"],
    },
    "http.request": {
        "inputs": ["input"],
        "outputs": ["output"],
    },
}
```

**Switch — ports dynamiques** : les ports `out_0..out_N` dépendent du nombre de rules. Une approche pragmatique : enregistrer 2 sorties par défaut (`out_0`, `out_1`) + fallback dans `_STANDARD_PORTS`, et supporter les ports supplémentaires via `__getattr__` dynamique sur la classe décorée. Le parser graph (`_RShiftLinkCollector`) détecte déjà n'importe quel `ClassName.port_name` dans l'expression `>>`.

### 5.2) Port `parser` dans `langchain.agent`

Ajouter `"parser"` aux inputs de `langchain.agent` :

```python
"langchain.agent": {
    "inputs": ["input", "llm", "memory", "tools", "parser"],  # parser ajouté
    "outputs": ["output"],
},
```

### 5.3) Engine — nœuds exécutables

Dans `_build_execution_order()`, élargir la liste des nœuds exécutables :

```python
# Types de spec nodes qui nécessitent une exécution (pas juste une résolution)
EXECUTABLE_SPEC_TYPES = {
    "langchain.agent",
    "logic.switch",
    "code.python",
    "http.request",
}

for node in ctx.graph.nodes:
    if node.kind == "inline_code":
        executable.append(node.id)
    if node.kind == "spec" and node.node_type in EXECUTABLE_SPEC_TYPES:
        executable.append(node.id)
```

Dans `_execute_nodes()`, router vers les bons handlers :

```python
if node.node_type == "langchain.agent":
    output = await self._execute_agent_node(ctx, node, mapped_inputs)
elif node.node_type == "logic.switch":
    output = await self._execute_switch_node(ctx, node, mapped_inputs)
elif node.node_type in ("code.python",):
    output = await self._execute_callable_node(ctx, node, mapped_inputs)
elif node.node_type == "http.request":
    output = await self._execute_callable_node(ctx, node, mapped_inputs)
```

`_execute_callable_node()` est un handler générique pour les nœuds dont le resolver retourne un `async callable` :

```python
async def _execute_callable_node(self, ctx, node, inputs):
    """Exécute un nœud dont le resolver a retourné un callable."""
    resolved = ctx.resolver.get_cached(node.id)
    if not resolved:
        raise RuntimeError(f"Node {node.id} not resolved")
    
    executor = resolved.runtime_object
    data = unwrap(inputs.get("input"))
    
    if callable(executor):
        if inspect.iscoroutinefunction(executor):
            return await executor(data)
        else:
            return executor(data)
    else:
        raise RuntimeError(f"Resolved object for {node.id} is not callable")
```

### 5.4) Switch — exécution conditionnelle en aval

Le Switch active **un seul** port de sortie. Les nœuds connectés aux autres ports ne doivent pas être exécutés. Deux options :

**Option A (recommandée)** : vérifier dans `_execute_nodes()` que les inputs requis sont présents avant d'exécuter un nœud. Si le port `input` est `None` (pas de données), skip le nœud.

```python
# Avant d'exécuter chaque nœud
raw_inputs = ctx.port_registry.get_inputs_for_node(node_id)
if not raw_inputs and node.node_type != "langchain.agent":
    # Pas d'inputs = pas de déclenchement (branche morte du Switch)
    ctx.execution_trace.append({"node_id": node_id, "status": "skipped"})
    continue
```

**Option B** : recalculer l'ordre d'exécution après chaque Switch.

### 5.5) `api.py` — métadonnées UI

Ajouter au dictionnaire `metadata` :

```python
"logic.switch": {
    "label": "Switch",
    "category": "Logic",
    "description": "Conditional routing based on rules",
    "defaultProps": {
        "input_expression": "{{ data }}",
        "rules": [],
        "fallback": "out_fallback",
    },
},
"parser.structured": {
    "label": "Structured Output Parser",
    "category": "Parsers",
    "description": "Constrains LLM output to a JSON schema",
    "defaultProps": {
        "json_schema": {},
        "auto_fix": True,
    },
    "connectionRole": "provider",
},
"code.python": {
    "label": "Code (Python)",
    "category": "Transform",
    "description": "Execute Python code to transform data",
    "defaultProps": {
        "code": "# data contains the input\nresult = data\nreturn result",
        "timeout": 30,
    },
},
"http.request": {
    "label": "HTTP Request",
    "category": "Integration",
    "description": "Make outbound HTTP requests to external APIs",
    "defaultProps": {
        "method": "GET",
        "url": "",
        "headers": {},
        "response_type": "json",
    },
},
```

### 5.6) `ui_nodes_meta.json`

Ajouter la configuration pour l'UI :

```json
{
  "logic.switch": {
    "label": "Switch",
    "category": "Logic",
    "icon": "🔀",
    "description": "Route data based on conditions",
    "defaultProps": {
      "input_expression": "{{ data }}",
      "rules": [],
      "fallback": "out_fallback"
    },
    "configSchema": {
      "input_expression": { "type": "string", "label": "Expression" },
      "rules": { "type": "array", "label": "Rules" },
      "fallback": { "type": "string", "label": "Fallback output" }
    }
  },
  "parser.structured": {
    "label": "Structured Output Parser",
    "category": "Parsers",
    "icon": "📋",
    "description": "JSON schema for LLM output",
    "defaultProps": {
      "json_schema": {},
      "auto_fix": true
    },
    "configSchema": {
      "json_schema": { "type": "json", "label": "JSON Schema" },
      "auto_fix": { "type": "boolean", "label": "Auto-fix invalid output" }
    }
  },
  "code.python": {
    "label": "Code (Python)",
    "category": "Transform",
    "icon": "🐍",
    "description": "Execute Python code",
    "defaultProps": {
      "code": "return data",
      "timeout": 30
    },
    "configSchema": {
      "code": { "type": "code", "label": "Python Code", "language": "python" },
      "timeout": { "type": "number", "label": "Timeout (seconds)", "min": 1, "max": 300 }
    }
  },
  "http.request": {
    "label": "HTTP Request",
    "category": "Integration",
    "icon": "🌐",
    "description": "Call external APIs",
    "defaultProps": {
      "method": "GET",
      "url": "",
      "headers": {},
      "response_type": "json"
    },
    "configSchema": {
      "method": {
        "type": "select",
        "label": "Method",
        "options": ["GET", "POST", "PUT", "PATCH", "DELETE"]
      },
      "url": { "type": "string", "label": "URL" },
      "headers": { "type": "json", "label": "Headers" },
      "body": { "type": "json", "label": "Request Body" },
      "response_type": {
        "type": "select",
        "label": "Response Type",
        "options": ["json", "text", "binary"]
      },
      "auth_type": {
        "type": "select",
        "label": "Auth Type",
        "options": ["none", "api_key", "bearer", "basic"]
      },
      "auth_credential": { "type": "string", "label": "Credential Name" },
      "timeout": { "type": "number", "label": "Timeout (seconds)", "min": 1, "max": 120 }
    }
  }
}
```

---

## 6) Exemple de workflow complet

Voici un exemple utilisant les 4 nouveaux nœuds ensemble :

```python
"""
News Research Pipeline

Workflow: Chat → Agent → Switch → [Code → HTTP → Agent] / [Chat]
"""

from holon import node, links


# === Triggers ===

@node(type="trigger.chat", id="node:trigger:chat:main")
class ChatTrigger:
    placeholder = "Describe what you want to research..."


# === LLM & Parser ===

@node(type="llm.model", id="node:llm:gpt4")
class LLM:
    provider = "openai"
    model_name = "gpt-4o"
    temperature = 0.7

@node(type="parser.structured", id="node:parser:analysis")
class AnalysisParser:
    """Parse the orchestrator's output into structured fields."""
    json_schema = {
        "type": "object",
        "properties": {
            "has_enough_info": {
                "type": "boolean",
                "description": "Whether the user provided enough detail"
            },
            "topic": {
                "type": "string",
                "description": "Research topic"
            },
            "search_queries": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Search queries to execute"
            },
        },
        "required": ["has_enough_info", "topic"]
    }


# === Agents ===

@node(type="langchain.agent", id="node:agent:orchestrator")
class OrchestratorAgent:
    system_prompt = """Analyze the user's request. 
Determine if you have enough info to proceed with research.
Return a structured analysis with has_enough_info, topic, and search_queries."""


# === Logic ===

@node(type="logic.switch", id="node:switch:info_check")
class InfoCheck:
    """Route based on whether we have enough info."""
    input_expression = "{{ data.has_enough_info }}"
    rules = [
        {"label": "Ready",     "operator": "equals", "value": True,  "output": "out_0"},
        {"label": "Need more", "operator": "equals", "value": False, "output": "out_1"},
    ]
    fallback = "out_fallback"


# === Transform & HTTP ===

@node(type="code.python", id="node:code:build_query")
class BuildQuery:
    """Prepare the HTTP request from agent output."""
    code = """
topic = data.get("topic", "")
queries = data.get("search_queries", [topic])
return {"query": queries[0] if queries else topic}
"""

@node(type="http.request", id="node:http:search")
class SearchAPI:
    """Search for information via SerpApi."""
    method = "GET"
    url = "https://serpapi.com/search"
    query_params = {
        "engine": "google",
        "q": "{{ data.query }}",
    }
    auth_type = "api_key"
    auth_credential = "serpapi"
    auth_query_param = "api_key"
    response_type = "json"


# === Connections ===

@links
def define_routing():
    # Dependencies
    OrchestratorAgent.uses(
        llm=LLM.output,
        parser=AnalysisParser.output,
    )
    
    # Flow
    ChatTrigger.out >> OrchestratorAgent.input
    OrchestratorAgent.output >> InfoCheck.input
    
    # Branch: enough info → search pipeline
    InfoCheck.out_0 >> BuildQuery.input
    BuildQuery.output >> SearchAPI.input
    SearchAPI.output >> ChatTrigger.response
    
    # Branch: need more info → ask again
    InfoCheck.out_1 >> ChatTrigger.response
```

---

## 7) Plan d'implémentation

### Phase 1 — Fondations (transversal)
1. Ajouter `_STANDARD_PORTS` pour les 4 types dans `dsl.py`
2. Élargir `_build_execution_order()` dans `engine.py`
3. Ajouter le routing `_execute_nodes()` pour `logic.switch`, `code.python`, `http.request`
4. Ajouter le handler générique `_execute_callable_node()`
5. Ajouter le handler `_execute_switch_node()` avec logique de skip des branches mortes
6. Ajouter le port `parser` à `langchain.agent` dans `_STANDARD_PORTS`

### Phase 2 — Resolvers
7. `@register_spec_type("logic.switch")` dans un nouveau `library/logic_nodes.py`
8. `@register_spec_type("parser.structured")` dans un nouveau `library/parser_nodes.py`
9. `@register_spec_type("code.python")` dans un nouveau `library/code_nodes.py`
10. `@register_spec_type("http.request")` dans un nouveau `library/http_nodes.py`

### Phase 3 — Intégration
11. Modifier `langchain_agent()` pour accepter `output_parser`
12. Modifier `_execute_agent_node()` pour passer le parser
13. Compléter `_execute_inline_code_node()` pour les fonctions `@node`
14. Ajouter métadonnées dans `api.py` et `ui_nodes_meta.json`
15. Importer les nouveaux modules dans `api.py`

### Phase 4 — Tests
16. Tests unitaires pour les resolvers (4 fichiers)
17. Tests d'intégration pour l'engine (switch routing, skip logic)
18. Test end-to-end avec le workflow exemple
19. Créer un fichier `examples/research_pipeline.holon.py`

---

## 8) Dépendances Python

| Package | Usage | Déjà installé ? |
|---|---|---|
| `aiohttp` | HTTP Request node | À vérifier |
| `langchain` | Structured Output Parser (PydanticOutputParser) | ✅ Oui |
| `pydantic` | Modèle dynamique pour le parser | ✅ Oui |

> **Note** : `aiohttp` est la seule dépendance potentiellement nouvelle. Alternative : `httpx` (async-native, souvent déjà présent avec LangChain).

---

## 9) Questions ouvertes

1. **Switch — ports dynamiques** : faut-il supporter un nombre illimité de branches ou limiter à 6 (comme n8n) ?
2. **Code node — sandbox** : le sandbox `exec()` est basique. Faut-il envisager un sandbox plus robuste (subprocess, Docker) pour la production ?
3. **HTTP Request — streaming** : faut-il supporter le streaming de réponses (SSE, WebSocket) dans une version ultérieure ?
4. **Template engine** : le système `{{ data.field }}` est simple. Faut-il réutiliser le `PortMapper` existant (JSONPath, Mustache) pour la cohérence ?
