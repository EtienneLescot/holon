# Spec — Data Transport & Port Mapping (Holon)

**Date**: 2026-02-03  
**Status**: Draft — pour validation  
**Phase**: 6.1 (extension du runner)

---

## 1) Contexte & motivation

Actuellement, Holon gère les **connexions entre ports** (via `PortRegistry`, `PortConnection`) et le flux de données brutes entre nodes. Cependant, il manque un mécanisme de **transformation et mapping** des données.

**Cas d'usage clé**:
- Un `Chat` node émet un message utilisateur sur `out.message` (type `MessageEnvelope`).
- Un `Agent` node attend sur `in.prompt` un champ `user` (type `str`).
- Il faut **extraire** `content` de `MessageEnvelope` et le **mapper** vers `prompt.user`.

**Objectif**:
- Définir un **format de transport standardisé** (envelope).
- Spécifier un **système de mapping** entre ports avec transformations.
- Rester conforme à la philosophie Holon : **Code is Truth** (les mappings sont déclarés dans le code Python).

---

## 2) Décisions de design

### 2.0) Philosophie : Code-First + AI-Friendly + UI-Assisted

**Principes directeurs** :

1. **Code is Truth** : les mappings sont déclarés dans le `*.holon.py` (source de vérité).
2. **AI-Friendly syntax** : syntaxe déclarative simple que l'IA peut lire/écrire/modifier facilement.
3. **UI-Assisted** : l'UI fournit des outils visuels pour **générer** et **corriger** le code de mapping.
4. **Dev-Friendly** : pendant le dev, l'UI permet de prototyper rapidement sans passer par l'IA.

**Flow de travail** :
```
Utilisateur → "Connecte le chat à l'agent" → IA génère @port_map → Code ajouté au .holon.py
     OU
Utilisateur → Port Browser UI → Drag & Drop → Génère @port_map → Code ajouté au .holon.py
```

### 2.1) Format de transport : `DataEnvelope`

Un contrat standardisé pour tout payload circulant entre ports.

**Structure Python** (domain model):

```python
from pydantic import BaseModel, Field
from typing import Literal, Any
from datetime import datetime

class DataEnvelope(BaseModel):
    """Standardized data transport format between nodes."""
    
    type: Literal["message", "event", "data", "control"] = Field(
        "data",
        description="Payload type"
    )
    
    content: Any = Field(
        ...,
        description="Main payload content (str, dict, list, etc.)"
    )
    
    contentType: str = Field(
        "text/plain",
        description="MIME-type or schema hint (e.g., 'application/json', 'text/plain')"
    )
    
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Arbitrary key-values (conversationId, timestamp, model, etc.)"
    )
    
    origin: dict[str, str] | None = Field(
        default=None,
        description="Source node+port: { 'nodeId': '...', 'port': '...' }"
    )
    
    timestamp: datetime = Field(
        default_factory=datetime.utcnow,
        description="Creation timestamp (ISO8601)"
    )
```

**Exemples**:

```python
# Message utilisateur simple
DataEnvelope(
    type="message",
    content="Bonjour, peux-tu m'aider ?",
    contentType="text/plain",
    metadata={"role": "user", "conversationId": "c123"},
    origin={"nodeId": "chat-1", "port": "out.message"}
)

# Event système
DataEnvelope(
    type="event",
    content={"action": "clear_history"},
    contentType="application/json",
    origin={"nodeId": "chat-1", "port": "out.control"}
)

# Data structurée
DataEnvelope(
    type="data",
    content={"query": "SELECT * FROM users", "params": []},
    contentType="application/json",
    metadata={"source": "db_node"}
)
```

---

### 2.2) Mapping entre ports : `@port_map`

**Philosophie** : suivre le pattern Holon (`@node`, `@links`, `@workflow`) → utiliser `>>` pour le flux simple, `.uses()` pour les dépendances, et `@port_map` pour les transformations complexes.

**Contexte d'utilisation** :
- **Pipeline simple** : `SourceNode.out >> TargetNode.in` (pas de transformation)
- **Dépendance** : `AgentNode.uses(llm=LlmModel.output)` (injection de ressource)
- **Transformation** : `@port_map` (extraction, mapping de champs, JSONPath)

**Syntaxe @port_map** (pour transformations complexes):

```python
from holon import port_map

@workflow
async def main() -> str:
    # ... nodes déclarés ...
    
    # Mapping explicite : Chat.out.message → Agent.in.prompt (field "user")
    @port_map
    class _:
        source = (ChatNode, "out.message")
        target = (AgentNode, "in.prompt")
        transform = "$.content"  # JSONPath pour extraire "content"
        target_field = "user"    # Injecte dans prompt.user
```

**Attributs de `@port_map`**:

| Attribut       | Type                          | Description                                           |
|----------------|-------------------------------|-------------------------------------------------------|
| `source`       | `(node_ref, port_name)`       | Source node + port                                    |
| `target`       | `(node_ref, port_name)`       | Target node + port                                    |
| `transform`    | `str \| None`                 | Expression de transformation (JSONPath, template, JS) |
| `target_field` | `str \| None`                 | Champ cible dans le payload (e.g., "user", "system")  |
| `when`         | `str \| None`                 | Condition de filtrage (optionnel)                     |
| `on_error`     | `"stop" \| "skip" \| "pass"`  | Comportement en cas d'erreur                          |

**Règles**:
- Si `transform` est absent → mapping identité (`content` → `content`).
- Si `target_field` est spécifié → injecte dans un sous-champ du payload cible.
- Les transformations sont appliquées par le `ExecutionEngine` lors du passage de données entre ports.

---

### 2.3) Langages de transformation supportés

**Phase 6.1 (MVP)** — 3 langages supportés:

1. **JSONPath** (lecture seule) — extraction de champs:
   ```python
   transform = "$.content"           # Extrait le champ "content"
   transform = "$.metadata.role"     # Extrait metadata.role
   transform = "$[0].value"          # Extraction depuis array
   ```

2. **Template simple** (Mustache-like) — interpolation:
   ```python
   transform = "User: {{content}}"   # Préfixe avec "User: "
   transform = "{{metadata.role}}: {{content}}"
   ```

3. **Python expression** (sandboxée, optionnel) — transformation arbitraire:
   ```python
   transform = "lambda env: env.content.upper()"
   ```
   ⚠️ Attention : limiter aux expressions simples, sans imports. Utiliser `ast.literal_eval` + whitelist.

**Implémentation** : classe `PortMapper` dans `holon/execution/mapper.py`.

```python
from typing import Any, Protocol
import jsonpath_ng

class PortMapper:
    """Transforms data between ports according to mapping rules."""
    
    def apply_transform(self, envelope: DataEnvelope, transform: str | None) -> Any:
        """Apply a transformation expression to extract/transform data."""
        if transform is None:
            return envelope.content  # Identity
        
        # JSONPath
        if transform.startswith("$."):
            parser = jsonpath_ng.parse(transform)
            matches = parser.find(envelope.model_dump())
            return matches[0].value if matches else None
        
        # Template (Mustache)
        if "{{" in transform:
            return self._apply_template(transform, envelope)
        
        # Python lambda (sandboxée)
        if transform.startswith("lambda"):
            return self._apply_python_expr(transform, envelope)
        
        raise ValueError(f"Unsupported transform: {transform}")
    
    def _apply_template(self, template: str, envelope: DataEnvelope) -> str:
        """Simple Mustache-like template."""
        # Remplace {{content}}, {{metadata.role}}, etc.
        ...
    
    def _apply_python_expr(self, expr: str, envelope: DataEnvelope) -> Any:
        """Evaluate a sandboxed Python lambda."""
        # ⚠️ Security: use ast.literal_eval + restricted builtins
        ...
```

---

## 3) Intégration dans le `ExecutionEngine`

**Modification de `engine.py`** (Phase 6.1):

```python
class ExecutionEngine:
    def __init__(self) -> None:
        self.mapper = PortMapper()
    
    async def _execute_nodes(self, ctx: ExecutionContext, order: list[str]) -> Any:
        for node_id in order:
            # 1) Récupérer les inputs bruts depuis PortRegistry
            raw_inputs = ctx.port_registry.get_inputs_for_node(node_id)
            
            # 2) Appliquer les mappings (transformations)
            mapped_inputs = {}
            for port_name, envelope in raw_inputs.items():
                # Chercher un mapping pour (source → target, port_name)
                mapping = ctx.port_registry.get_mapping(node_id, port_name)
                if mapping:
                    value = self.mapper.apply_transform(envelope, mapping.transform)
                    if mapping.target_field:
                        # Injection dans un sous-champ
                        mapped_inputs.setdefault(port_name, {})[mapping.target_field] = value
                    else:
                        mapped_inputs[port_name] = value
                else:
                    # Pas de mapping → passer tel quel
                    mapped_inputs[port_name] = envelope
            
            # 3) Exécuter la node avec les inputs mappés
            output = await self._execute_node(node, mapped_inputs)
            
            # 4) Envelopper l'output dans un DataEnvelope et stocker
            envelope_out = DataEnvelope(
                type="data",
                content=output,
                origin={"nodeId": node_id, "port": "output"}
            )
            ctx.port_registry.set_value(node_id, "output", envelope_out)
```

**Nouvelle méthode dans `PortRegistry`**:

```python
@dataclass
class PortMapping:
    """Mapping rule for a port connection."""
    source_node: str
    source_port: str
    target_node: str
    target_port: str
    transform: str | None
    target_field: str | None
    when: str | None
    on_error: str

class PortRegistry:
    def __init__(self) -> None:
        self.connections: list[PortConnection] = []
        self.values: dict[tuple[str, str], Any] = {}
        self.mappings: list[PortMapping] = []  # ← Nouveau
    
    def add_mapping(self, mapping: PortMapping) -> None:
        """Register a port mapping rule."""
        self.mappings.append(mapping)
    
    def get_mapping(self, target_node: str, target_port: str) -> PortMapping | None:
        """Find mapping rule for a target port."""
        for m in self.mappings:
            if m.target_node == target_node and m.target_port == target_port:
                return m
        return None
```

---

## 4) Parsing des `@port_map` (graph_parser.py)

**Extension du parser** pour détecter `@port_map`:

```python
class GraphParser:
    def parse_port_maps(self, source: str) -> list[PortMapping]:
        """Extract @port_map declarations from source code."""
        module = cst.parse_module(source)
        visitor = PortMapVisitor()
        module.walk(visitor)
        return visitor.port_maps

class PortMapVisitor(cst.CSTVisitor):
    def visit_ClassDef(self, node: cst.ClassDef) -> None:
        # Chercher décorateur @port_map
        if self._has_decorator(node, "port_map"):
            # Extraire attributs: source, target, transform, target_field, etc.
            attrs = self._extract_class_attributes(node)
            self.port_maps.append(PortMapping(
                source_node=attrs["source"][0],
                source_port=attrs["source"][1],
                target_node=attrs["target"][0],
                target_port=attrs["target"][1],
                transform=attrs.get("transform"),
                target_field=attrs.get("target_field"),
                when=attrs.get("when"),
                on_error=attrs.get("on_error", "stop")
            ))
```

**Note** : Le parser extrait les `@port_map` de la même manière que les opérations `>>` et `.uses()` (déjà implémenté dans `graph_parser.py`).

---

## 5) Interface utilisateur pour le mapping

### 5.1) Philosophie UI

L'UI ne **stocke pas** les mappings (Code is Truth), mais elle :
- **Visualise** les mappings existants (depuis le code parsé).
- **Génère** du code `@port_map` via interactions visuelles.
- **Valide** la cohérence des connexions (types de ports compatibles).
- **Suggère** des mappings automatiques (heuristiques + IA).

### 5.2) Port Library Browser

**Objectif** : afficher tous les ports disponibles dans le workflow pour faciliter le mapping manuel.

**Composant** : `PortLibraryPanel.tsx`

```tsx
interface PortLibraryPanel {
  // Affichage par node
  nodes: Array<{
    id: string;
    label: string;
    type: string;
    ports: {
      inputs: PortInfo[];
      outputs: PortInfo[];
    }
  }>;
  
  // Filtres
  filters: {
    searchQuery: string;
    portKind: PortKind | "all";
    direction: "input" | "output" | "all";
  };
  
  // Actions
  onPortDragStart: (nodeId: string, port: PortInfo) => void;
  onPortSelect: (nodeId: string, port: PortInfo) => void;
}

interface PortInfo {
  id: string;              // "out.message"
  direction: "input" | "output";
  kind: PortKind;          // "data" | "llm" | "memory" | ...
  label: string;           // "User message"
  schema?: string;         // "DataEnvelope" | "str" | "dict"
  connected: boolean;      // Déjà connecté ?
  compatibleWith?: string[]; // Types compatibles
}
```

**Visuel** (wireframe ASCII) :

```
┌─────────────────────────────────────┐
│ 🔌 Port Library                     │
│ ┌─────────────────────────────────┐ │
│ │ 🔍 Search ports...              │ │
│ └─────────────────────────────────┘ │
│ Filter: [All ▾] [Data ▾] [All ▾]   │
│─────────────────────────────────────│
│ 📦 ChatNode (spec:chat:main)        │
│   Inputs:                            │
│   ├─ 📥 in.message (data) ●         │
│   └─ 🎛️ in.control (control)        │
│   Outputs:                           │
│   ├─ 📤 out.message (data) ●        │
│   └─ ⚡ out.event (control)         │
│─────────────────────────────────────│
│ 🤖 AgentNode (spec:agent:1)         │
│   Inputs:                            │
│   ├─ 💬 in.prompt (data)            │
│   ├─ 🧠 in.llm (llm)                │
│   └─ 💾 in.memory (memory)          │
│   Outputs:                           │
│   └─ 📤 out.response (data) ●       │
│─────────────────────────────────────│
│ ● = Already connected               │
└─────────────────────────────────────┘
```

**Comportements** :

1. **Drag & Drop** :
   - Drag depuis `out.message` → drop sur `in.prompt` → ouvre le Mapping Editor.
   
2. **Click to connect** :
   - Click sur `out.message` → mode "connecting" → click sur `in.prompt` → Mapping Editor.

3. **Visual feedback** :
   - Ports compatibles (même `kind` ou transformables) = highlight vert.
   - Ports incompatibles = grisés.
   - Ports déjà connectés = badge "●".

---

### 5.3) Mapping Editor (Modal)

**Objectif** : configurer un mapping port-à-port avec transformation.

**Composant** : `MappingEditorModal.tsx`

```tsx
interface MappingEditorProps {
  source: { nodeId: string; port: PortInfo };
  target: { nodeId: string; port: PortInfo };
  existingMapping?: PortMapping; // Si édition
  onSave: (mapping: PortMappingConfig) => void;
  onCancel: () => void;
}

interface PortMappingConfig {
  transform?: string;
  target_field?: string;
  when?: string;
  on_error: "stop" | "skip" | "pass";
}
```

**Visuel** (wireframe) :

```
┌──────────────────────────────────────────────┐
│ Map: ChatNode.out.message → AgentNode.in.prompt │
├──────────────────────────────────────────────┤
│ Source Schema: DataEnvelope                  │
│ {                                            │
│   type: "message",                           │
│   content: "Hello",        ← Draggable       │
│   metadata: {                                │
│     role: "user"           ← Draggable       │
│   }                                          │
│ }                                            │
├──────────────────────────────────────────────┤
│ Target Schema: AgentPrompt                   │
│ {                                            │
│   user: <DROP HERE>        ← Drop zone       │
│   system?: <DROP HERE>                       │
│ }                                            │
├──────────────────────────────────────────────┤
│ Transformation:                              │
│ ○ Identity (pass through)                    │
│ ● Extract field: [$.content        ▾]       │
│ ○ Template:      [{{content}}      ▾]       │
│ ○ Custom (Python): [lambda...       ]       │
├──────────────────────────────────────────────┤
│ Target field (optional):                     │
│ [user                             ▾]         │
├──────────────────────────────────────────────┤
│ Advanced:                                    │
│ ☐ Conditional (when): [          ]          │
│ On error: [Stop ▾]                          │
├──────────────────────────────────────────────┤
│ Preview Generated Code:                      │
│ ┌──────────────────────────────────────────┐ │
│ │ @port_map                                │ │
│ │ class _:                                 │ │
│ │     source = (ChatNode, "out.message")   │ │
│ │     target = (AgentNode, "in.prompt")    │ │
│ │     transform = "$.content"              │ │
│ │     target_field = "user"                │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ [Cancel]  [Apply via AI]  [Insert Code]     │
└──────────────────────────────────────────────┘
```

**Fonctionnalités** :

1. **Schema viewer** : affiche la structure des payloads source/target.
2. **Drag & Drop fields** : drag `content` → drop dans `user` → génère `transform = "$.content"` + `target_field = "user"`.
3. **Transform templates** : bibliothèque de transforms communs (extract, template, uppercase, etc.).
4. **Code preview** : affiche le `@port_map` qui sera généré.
5. **Validation** : vérifie que le mapping est valide (types compatibles, JSONPath correcte).
6. **Deux modes d'application** :
   - **Apply via AI** : envoie un prompt à Copilot pour insérer le code avec contexte.
   - **Insert Code** : insère directement le code dans le `@workflow` (via RPC patch).

---

### 5.4) Edge Inspector (affichage des mappings)

**Objectif** : visualiser et éditer un mapping existant directement sur l'edge.

**Comportement** :

1. **Click sur edge** → affiche tooltip/popover :
   ```
   ┌────────────────────────────────┐
   │ ChatNode → AgentNode           │
   │ Transform: $.content           │
   │ Target: prompt.user            │
   │ [Edit] [Delete] [View Code]    │
   └────────────────────────────────┘
   ```

2. **Edge styling** :
   - Edge avec mapping = ligne solide + icône 🔄.
   - Edge sans mapping = ligne pointillée (connexion simple).
   - Edge avec erreur = ligne rouge.

3. **Edit** → ouvre le Mapping Editor pré-rempli.

4. **View Code** → scroll vers le `@port_map` dans l'éditeur VS Code (highlight).

---

### 5.5) AI-Assisted Mapping

**Objectif** : laisser l'IA proposer/générer les mappings.

**Déclencheurs** :

1. **Connexion automatique** :
   - User connecte deux nodes via l'UI (edge sans ports spécifiques).
   - IA analyse les ports disponibles et propose un mapping.
   - Prompt : "Connect ChatNode.out.message to AgentNode.in.prompt. Extract the message content and map it to the user field."

2. **Command palette** :
   - User : "Map chat output to agent input"
   - IA détecte les nodes concernées et génère le `@port_map`.

3. **Smart suggestions** :
   - Lors du drag & drop, l'UI suggère des transforms basés sur les types.
   - Ex : `DataEnvelope` → `str` suggère `"$.content"`.

**Interaction flow** :

```
User: "Connect chat to agent"
  ↓
AI: Analyse les ports (out.message vs in.prompt)
  ↓
AI: Propose mapping avec transform
  ↓
UI: Affiche preview du code généré
  ↓
User: [Accept] ou [Edit] ou [Reject]
  ↓
AI: Insère le @port_map dans le code (patch chirurgical)
```

---

### 5.6) Workflow : exemple complet UI → Code

**Scenario** : l'utilisateur veut connecter un Chat à un Agent.

**Étape 1** : User drag edge de `ChatNode` vers `AgentNode` (sans spécifier les ports).

**Étape 2** : UI détecte que la connexion nécessite un mapping (incompatibilité de types).

**Étape 3** : UI affiche modal "Connection Assistant" :

```
┌──────────────────────────────────────────┐
│ Connect ChatNode → AgentNode             │
│                                          │
│ ⚠️ Port types don't match                │
│                                          │
│ ChatNode.out.message (DataEnvelope)      │
│        ↓                                 │
│ AgentNode.in.prompt (AgentPrompt)        │
│                                          │
│ 🤖 AI Suggestion:                        │
│ Extract message content and map to       │
│ the 'user' field of the prompt.          │
│                                          │
│ [Let AI create mapping]                  │
│ [Configure manually]                     │
│ [Cancel]                                 │
└──────────────────────────────────────────┘
```

**Étape 4a** (AI path) :
- User click "Let AI create mapping".
- Prompt envoyé à Copilot avec contexte (schémas des ports, nodes existantes).
- IA génère le code `@port_map` et l'insère dans le `@workflow`.

**Étape 4b** (Manual path) :
- User click "Configure manually".
- Ouvre le Mapping Editor (section 5.3).
- User configure via drag & drop fields.
- Click "Insert Code" → génère et insère le `@port_map`.

**Étape 5** : Code généré dans `chat_agent.holon.py` :

```python
@workflow
async def main() -> str:
    # ... existing code ...
    
    @port_map
    class _:
        source = (ChatNode, "out.message")
        target = (AgentNode, "in.prompt")
        transform = "$.content"
        target_field = "user"
    
    # ... rest of workflow ...
```

**Étape 6** : UI re-parse le fichier, détecte le nouveau mapping, et l'affiche sur l'edge.

---

### 5.7) Port Compatibility Matrix (aide visuelle)

**Objectif** : aider l'utilisateur à comprendre quels ports peuvent se connecter.

**Affichage** : dans une section "Help" ou tooltip.

| Source Kind | Target Kind | Compatible ? | Transform suggérée     |
|-------------|-------------|--------------|------------------------|
| data        | data        | ✅ Direct    | Identity               |
| data        | llm         | ⚠️ Transform | Extract config         |
| llm         | data        | ⚠️ Transform | Wrap in envelope       |
| memory      | memory      | ✅ Direct    | Identity               |
| control     | control     | ✅ Direct    | Identity               |
| data        | control     | ❌ Invalid   | Type mismatch          |

**Usage** : lors du drag & drop, afficher dynamiquement la compatibilité.

---

### 5.8) Implémentation UI (composants React)

**Nouveaux composants** :

```
ui/src/components/
├─ PortLibraryPanel.tsx      (browser de ports)
├─ MappingEditorModal.tsx    (éditeur de mapping)
├─ EdgeInspector.tsx         (tooltip sur edge)
├─ SchemaViewer.tsx          (affichage de schemas JSON)
├─ TransformBuilder.tsx      (constructeur de transforms)
└─ PortCompatibilityHelper.tsx (aide visuelle)
```

**Store state** :

```typescript
// ui/src/store/mapping.store.ts
interface MappingStore {
  // Mappings parsés depuis le code
  mappings: PortMapping[];
  
  // UI state
  selectedSource: { nodeId: string; port: string } | null;
  selectedTarget: { nodeId: string; port: string } | null;
  isEditorOpen: boolean;
  currentMapping: PortMappingConfig | null;
  
  // Actions
  selectSourcePort: (nodeId: string, port: string) => void;
  selectTargetPort: (nodeId: string, port: string) => void;
  openMappingEditor: (source, target) => void;
  saveMappingViaAI: (config: PortMappingConfig) => void;
  saveMappingDirect: (config: PortMappingConfig) => void;
  deleteMapping: (mappingId: string) => void;
}
```

**RPC calls** (UI → Extension) :

```typescript
// Générer et insérer un @port_map via AI
{
  type: "ui.mapping.createViaAI",
  source: { nodeId, port },
  target: { nodeId, port },
  config: { transform, target_field, ... }
}

// Insérer directement (patch chirurgical)
{
  type: "ui.mapping.insertCode",
  workflowNodeId: string,
  mappingCode: string  // Le @port_map complet
}

// Supprimer un mapping
{
  type: "ui.mapping.delete",
  mappingId: string
}

// Demander les schemas des ports
{
  type: "ui.mapping.getSchemas",
  nodeIds: string[]
}
```

---

## 5.9) Workflow UI → Backend (décision finale)

**Option choisie** : **Code-First avec assistance UI**

- Les mappings sont **toujours** déclarés dans le `*.holon.py` (source de vérité).
- L'UI fournit des outils visuels pour **générer** le code (drag & drop, templates).
- Deux modes de génération :
  - **Via AI** (recommandé) : prompt contextualisé → IA écrit le code.
  - **Direct** (dev/debug) : génération mécanique → insertion via LibCST patch.
- Pas de stockage dans `.holon/mappings.json` (violation de "Code is Truth").

**Avantages** :
- Source de vérité unique (code).
- UI reste un outil de productivité (ne dicte pas la topologie).
- Refactoring-friendly (renommage de variables, etc.).
- AI-friendly (syntaxe déclarative simple).

---

## 6) Exemple complet : Chat → Agent

**Fichier `chat_agent.holon.py`**:

```python
from holon import node, workflow, port_map
from holon.types import DataEnvelope

# Node Chat (interactive)
@node(type="ui.chat", id="spec:chat:main")
class ChatNode:
    """Interactive chat node."""
    placeholder = "Tapez votre message..."
    max_history = 50

# Node Agent
@node(type="langchain.agent", id="spec:agent:assistant")
class AgentNode:
    """LangChain agent."""
    system_prompt = "Tu es un assistant utile."
    model = "gpt-4o"

@workflow
async def main() -> str:
    """Chat loop with agent."""
    
    # Mapping: Chat output → Agent input (user prompt)
    @port_map
    class _:
        source = (ChatNode, "out.message")
        target = (AgentNode, "in.prompt")
        transform = "$.content"       # Extrait le texte du message
        target_field = "user"         # Injecte dans prompt.user
    
    # Mapping: Agent output → Chat input (affichage réponse)
    @port_map
    class _:
        source = (AgentNode, "out.response")
        target = (ChatNode, "in.message")
        transform = "lambda env: DataEnvelope(type='message', content=env.content, metadata={'role': 'assistant'})"
    
    # Implicit call establishes workflow
    await AgentNode()
    
    return "Chat loop active"
```

**Flux de données**:

1. Utilisateur envoie "Bonjour" dans l'UI.
2. `ChatNode` émet sur `out.message`:
   ```python
   DataEnvelope(
       type="message",
       content="Bonjour",
       metadata={"role": "user"},
       origin={"nodeId": "spec:chat:main", "port": "out.message"}
   )
   ```
3. Le `PortMapper` applique `transform = "$.content"` → extrait `"Bonjour"`.
4. Injection dans `AgentNode.in.prompt.user` → `{"user": "Bonjour"}`.
5. `AgentNode` traite et émet sur `out.response` → `"Bonjour ! Comment puis-je vous aider ?"`.
6. Le mapping inverse crée un `DataEnvelope` avec `role="assistant"`.
7. `ChatNode` reçoit et affiche la réponse dans l'UI.

---

## 7) Tests & validation

**Unit tests** (`tests/test_port_mapper.py`):

```python
def test_jsonpath_transform():
    envelope = DataEnvelope(
        type="message",
        content="Hello world",
        metadata={"role": "user"}
    )
    mapper = PortMapper()
    result = mapper.apply_transform(envelope, "$.content")
    assert result == "Hello world"

def test_template_transform():
    envelope = DataEnvelope(content="Hello", metadata={"role": "user"})
    mapper = PortMapper()
    result = mapper.apply_transform(envelope, "{{metadata.role}}: {{content}}")
    assert result == "user: Hello"

def test_port_map_parsing():
    source = '''
@port_map
class _:
    source = (NodeA, "out")
    target = (NodeB, "in")
    transform = "$.content"
    '''
    parser = GraphParser()
    mappings = parser.parse_port_maps(source)
    assert len(mappings) == 1
    assert mappings[0].transform == "$.content"
```

**Integration test** (`tests/test_chat_agent_flow.py`):

```python
async def test_chat_agent_mapping():
    # Charger workflow avec mappings
    graph = parse_file("examples/chat_agent.holon.py")
    ctx = ExecutionContext(graph=graph)
    
    # Simuler message utilisateur
    chat_node = graph.get_node("spec:chat:main")
    envelope = DataEnvelope(type="message", content="Hello")
    ctx.port_registry.set_value(chat_node.id, "out.message", envelope)
    
    # Exécuter
    engine = ExecutionEngine()
    await engine.execute_graph(ctx)
    
    # Vérifier que AgentNode a reçu le texte mappé
    agent_inputs = ctx.port_registry.get_inputs_for_node("spec:agent:assistant")
    assert agent_inputs["in.prompt"]["user"] == "Hello"
```

---

## 8) Sécurité & limites

### Sécurité
- **Transformations Python** : restreindre aux lambdas simples, pas d'imports, pas d'`eval()` direct.
- **JSONPath** : safe par design (lecture seule).
- **Templates** : échapper les injections (pas d'`exec()`).

### Limites Phase 6.1
- Pas de mapping conditionnel avancé (`when` simple uniquement).
- Pas de mapping N→1 ou 1→N (merger/split).
- Pas de mapping cyclique détecté automatiquement (à documenter).

---

## 9) Plan d'implémentation

### Phase 6.1.1 — Core mapping (2-3 jours)
- [ ] Ajouter `DataEnvelope` dans `domain/models.py`.
- [ ] Créer `execution/mapper.py` avec `PortMapper`.
- [ ] Étendre `PortRegistry` pour stocker `PortMapping`.
- [ ] Modifier `ExecutionEngine` pour appliquer les mappings.

### Phase 6.1.2 — Parsing (1-2 jours)
- [ ] Ajouter `@port_map` dans `dsl.py`.
- [ ] Implémenter `parse_port_maps()` dans `graph_parser.py`.
- [ ] Tests unitaires pour parsing + transformation.

### Phase 6.1.3 — UI Core (3-4 jours)
- [ ] Composant `PortLibraryPanel` (browser de ports).
- [ ] Composant `MappingEditorModal` (éditeur visuel).
- [ ] Composant `EdgeInspector` (affichage mappings sur edges).
- [ ] Store `mapping.store.ts` (state management).
- [ ] RPC handlers pour création/édition/suppression de mappings.

### Phase 6.1.4 — UI Advanced (2-3 jours)
- [ ] Drag & Drop fields (schema → schema).
- [ ] Transform templates library (JSONPath, Mustache).
- [ ] Code preview & validation.
- [ ] Port compatibility matrix & visual feedback.

### Phase 6.1.5 — AI Integration (2 jours)
- [ ] AI-assisted mapping (prompt generation).
- [ ] Smart suggestions (heuristiques).
- [ ] "Connection Assistant" modal.

### Phase 6.1.6 — Tests E2E (1 jour)
- [ ] Test complet Chat → Agent → Chat (UI + code).
- [ ] Test drag & drop → code generation.
- [ ] Documentation + exemples + vidéo démo.

**Total estimé** : ~2 semaines (10-14 jours).

---

## 10) Décisions à valider

1. **Nom du décorateur** : `@port_map` vs `@mapping` vs `@transform` ?
2. **Enveloppe obligatoire** : forcer tous les ports à utiliser `DataEnvelope` ou permettre raw data ?
3. **Transformations Python** : autoriser ou non (risque sécurité) ?
4. **UI drag & drop** : prioritaire ou phase 2 (après AI-assisted) ?
5. **Schema inference** : inférer automatiquement les schemas depuis le code ou les déclarer explicitement ?

---

**Prochaines étapes** : valider cette spec, puis passer à la spec du `Chat` node.

---

## Annexe : Syntaxe agentic-friendly

### Pourquoi cette syntaxe est AI-friendly ?

```python
@port_map
class _:
    source = (ChatNode, "out.message")
    target = (AgentNode, "in.prompt")
    transform = "$.content"
    target_field = "user"
```

**Raisons** :

1. **Déclarative** : pas de logique procédurale, juste des attributs.
2. **Contextuelle** : les références directes (`ChatNode`) sont résolvables par l'IA (follow imports).
3. **Lisible** : structure claire (1 mapping = 1 classe).
4. **Modifiable** : l'IA peut facilement remplacer `transform = "$.content"` par `transform = "$.metadata.text"`.
5. **Pattern matching** : l'IA reconnaît le pattern `@port_map` avec déclaration de classe (similaire aux autres décorateurs Holon).
6. **Type hints implicites** : les tuples `(Node, "port")` sont explicites.
7. **No magic strings** : les node references sont des symboles Python (autocomplete, refactoring).

**Contre-exemple (moins AI-friendly)** :

```python
# ❌ Moins lisible, plus fragile
link_ports("spec:chat:main", "out.message", "spec:agent:1", "in.prompt", 
           transform=lambda x: x["content"], target="user")
```

**Pourquoi moins bien ?** :
- Strings magiques (`"spec:chat:main"`) → l'IA doit deviner les IDs.
- Lambda inline → difficile à parser/modifier.
- Positional args → ordre non-évident.
- Pas de structure claire (tout sur une ligne).
