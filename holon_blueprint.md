# Holon — Blueprint (Single Source of Truth)

⚠️ CONTEXTE CRITIQUE POUR L'AGENT IA

Ce document est la source de vérité du projet Holon.

Règle d'or : si une décision d'architecture, une primitive du DSL, ou un invariant de persistance change, ce fichier doit être mis à jour.

Mantra : "Code is Truth. Visual is Interface. AI is the Worker."

---

## 1) Ce document (règles d'usage)

- Ce blueprint doit rester un unique fichier lisible qui capture l'esprit, les décisions et les invariants.
- Si un autre document contredit celui-ci, c'est ce fichier qu'il faut mettre à jour (puis réaligner le reste).

Nom du projet : Holon

Nom du package Python : `holon`

## 2) Identité & philosophie

Holon est un éditeur de workflows AI-native où :
- Le **code** encode la topologie et la configuration (source de vérité).
- Le **visuel** sert à naviguer, comprendre, et déclencher des actions.
- L'**IA** exécute le travail (patchs chirurgicaux, description), sans casser le reste.

Concept clé : **Dualité récursive**
- Chaque nœud est un mini-agent (code/config).
- Le graphe est un méta-agent (composition visuelle).
- L'utilisateur utilise le visuel pour prompter des modifications de code.

## 3) Décisions non négociables (architecture)

### Code is Truth

Le fichier `*.holon.py` est la seule source de vérité pour :
- Les **nodes** (fonctions `@node` + déclarations `spec(...)`).
- Les **liens** (appels dans `@workflow` + déclarations `link(...)`).
- La **configuration** (arguments de `spec(...)`, et code des fonctions `@node`).

### JSON = metadata UI uniquement

Le JSON ne doit jamais décrire la topologie. Il est réservé à de la metadata UI.
- Positions : `.holon/positions.json` (par fichier, par `nodeId`)
- Annotations : `.holon/annotations.json` (par fichier, par `nodeId`) avec `{ summary, badges[] }`

### Patching chirurgical (lossless)

Toutes les réécritures se font via LibCST (lossless) :
- préserver commentaires, espaces, style
- patcher uniquement le minimum nécessaire

Invariants :
- Un patch ne doit jamais modifier une autre node par accident.
- Le code reste "humain" : pas de reformat global, pas de churn inutile.
- Les identifiants `node:*` et `spec:*` sont stables et servent de clé pour la metadata UI.

## 4) Structure du monorepo

- `core/` — backend Python (Poetry). Doit rester indépendant de VS Code/React.
- `extension/` — extension VS Code (webview + RPC stdio JSONL + Copilot).
- `ui/` — UI React (Vite + React Flow), compilée et chargée par l'extension.

## 5) DSL & modèle de graphe (v1)

### Types de nodes

- `node:*` : une fonction Python décorée avec `@node`.
- `spec:*` : une node déterministe déclarée via `spec(...)` au niveau module.

### Primitives

- `@node` : décorateur universel pour définir une node. Détecte automatiquement le contexte :
  - Sur une **fonction** → node custom (code inline).
  - Sur une **classe avec `type=`** → node library (préfabriquée, basée sur attributs de classe).
- `@workflow` : marque une fonction dont le corps est analysé pour dériver des liens implicites (workflow→node).
- `@links` : **[Recommandé]** décorateur pour définir les connexions entre nodes via deux syntaxes :
  - **Pipeline Flow (`>>`)** : flux d'exécution chronologique avec payload de données
  - **Dependency Binding (`.uses()`)** : injection de ressources/capacités dans un node
- `@link` : **[Déprécié]** décorateur sur une classe pour définir un lien explicite. Remplacé par `>>` et `.uses()`.
- `spec(node_id, *, type: str, label?: str, props?: dict)` : forme bas-niveau pour déclarer une node préfabriquée (config pure). **Déprécié** au profit de `@node` sur classe.

### Le décorateur `@node` unifié (code-first, AI-friendly)

**Philosophie**: un seul décorateur pour toutes les nodes, la distinction se fait naturellement par le contexte (fonction vs classe).

**Syntaxe - Node custom (inline code)**:
```python
@node
def analyze(x: int) -> int:
    """Custom processing logic."""
    return x + 1
```

**Syntaxe - Node library (préfabriquée)**:
```python
@node(type="llm.model", id="spec:llm:my_gpt4")
class MyGPT4:
    """GPT-4o configuration."""
    model_name = "gpt-4o"
    temperature = 0.7
    provider = "openai"
```

**Règles**:
- **Fonction** : `@node` (sans paramètres) → node custom. Le nom de la fonction devient le node ID (`node:<function_name>`).
- **Classe** : `@node(type="...")` (avec `type` obligatoire) → node library. Les attributs de classe (non-privés, non-callables) sont collectés comme `props` au moment du parsing.
- Paramètres optionnels pour nodes library : `id` (par défaut `spec:<type>:<class_name_snake_case>`), `label` (par défaut dérivé du nom de classe).
- **Ports automatiques** : Le décorateur attache automatiquement les ports standards (`.input`, `.output`, etc.) en fonction du `type`.

**Pourquoi**:
- **Symétrie conceptuelle** : tout est `@node`, pas de confusion entre `@node` et `@spec_node`.
- **Code-first** : les agents IA reconnaissent immédiatement la structure (fonction = logique inline, classe = config).
- **Refactoring-friendly** : renommer/modifier des attributs est plus simple qu'éditer du JSON ou des kwargs.
- **Patchable via LibCST** : le parser extrait les attributs de classe et les convertit en `props` dict au moment de la génération du graphe.

### Le décorateur `@links` : séparation Pipeline Flow / Dependency Binding

**Philosophie**: Distinguer clairement deux types de connexions pour éviter toute ambiguïté sémantique.

**1. Pipeline Flow (`>>`)** : Flux d'exécution chronologique
```python
# Données transitant du trigger vers l'agent puis retour au trigger
TriggerChat.out >> LangchainAgent.input
LangchainAgent.output >> TriggerChat.response
```

**2. Dependency Binding (`.uses()`)** : Injection de ressources
```python
# L'agent est équipé d'un LLM avant son exécution
LangchainAgent.uses(llm=LlmModel.output)
```

**Exemple complet**:
```python
from holon import node, links

@node(type="trigger.chat", id="node:trigger:chat:main")
class TriggerChat:
    placeholder = "Posez votre question..."

@node(type="langchain.agent", id="node:langchain:agent:assistant")
class LangchainAgent:
    system_prompt = "You are a helpful assistant."

@node(type="llm.model", id="node:llm:model:gpt4o")
class LlmModel:
    provider = "openai"
    model_name = "gpt-4o"

@links
def define_routing():
    """Définition des connexions : Control Flow et Data Flow"""
    
    # 1. DEPENDENCY BINDING (Ressources / Sub-nodes)
    LangchainAgent.uses(llm=LlmModel.output)
    
    # 2. PIPELINE FLOW (Séquence d'exécution)
    TriggerChat.out >> LangchainAgent.input
    LangchainAgent.output >> TriggerChat.response
```

**Règles**:
- Le décorateur `@links` s'applique sur une fonction (nom recommandé : `define_routing`)
- **Pipeline Flow (`>>`)** : représente le flux chronologique de données (items passant de node en node)
- **Dependency Binding (`.uses()`)** : représente l'équipement d'un node avec des ressources avant exécution
- Ne **jamais confondre** les deux : un LLM n'est pas dans le pipeline, il est une dépendance de l'agent

**Pourquoi**:
- **Clarté sémantique** : distinction explicite entre flux de données et injection de dépendances
- **Idiomatique Python** : l'opérateur `>>` est familier (Airflow, LangChain, Haystack)
- **Lisible visuellement** : `>>` montre clairement la direction du flux
- **Type-safe** : les ports sont des objets Python avec autocomplétion IDE
- **AI-friendly** : la structure est immédiatement compréhensible par les agents IA

### Liens

- Implicites : dérivés des appels à des nodes dans `@workflow`.
- Explicites : déclarés via `>>` (pipeline flow) et `.uses()` (dependency binding) dans `@links`.

## 6) Modèle d'édition (AI-first)

### AI edit (patch chirurgical)

- Sur `node:*` : l'IA propose un remplacement de la fonction ciblée, et le core applique le patch via LibCST.
- Sur `spec:*` : l'IA propose un patch JSON (`type/label/props`), et le core met à jour le `spec(...)` correspondant via LibCST.

### Describe (lisibilité)

L'IA génère :
- `summary` (1 phrase courte)
- `badges[]` (strings libres, éventuellement avec icônes)

Ces annotations sont affichées dans l'UI et persistées dans `.holon/annotations.json`.

Principe UX : pas de formulaires d'édition "classiques" comme source primaire.
- L'utilisateur décrit l'intention.
- L'IA propose une modification ciblée.
- Le core applique un patch lossless.

### Hors VS Code (browser dev mode)

En dehors de VS Code, on ne peut pas appeler Copilot (`vscode.lm`). La stratégie prévue est :
- générer un **prompt prêt à copier-coller** (instruction utilisateur + contexte node)
- exécuter ce prompt dans l'agent IA de son choix
- appliquer manuellement le patch résultant dans le fichier

## 7) Standards (qualité, typing, contraintes)

- Type safety :
  - Python : viser `mypy --strict` à terme, modèles de données structurés.
  - TypeScript : `strict: true`, pas de `any`.
- Docstrings : chaque fonction publique/exportée documente `Args/Returns/Raises`.
- Formatters : Ruff (Python), Prettier (TS).
- Taille des fichiers : règle des ~200 lignes (extraction si ça grossit).

## 8) Ce qui est volontairement hors-scope (pour l'instant)

- Un moteur d'exécution complet (Phase 6).
- Un système de types/ports strict au runtime (aujourd'hui c'est un contrat UI).

## 9) Roadmap (phases) — séquentielle

- Phase 1 — Core parsing via LibCST ✅
- Phase 2 — Patching chirurgical via LibCST ✅
- Phase 3 — Extension VS Code + RPC stdio JSONL ✅
- Phase 4 — UI React Flow + positions persistées ✅
- Phase 5 — Spec + Links + AI-first + annotations ✅
- Phase 6 — Exécution (runner) 🔜