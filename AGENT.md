# AGENT.md — Guide pour les Agents de Codage IA

> **CRITICAL**: Ce document doit être lu **EN PREMIER** avant toute modification du codebase Holon.

---

## 📋 Table des Matières

1. [Philosophie & Principes Fondamentaux](#philosophie--principes-fondamentaux)
2. [Architecture du Projet](#architecture-du-projet)
3. [Règles de Gestion de Code](#règles-de-gestion-de-code)
4. [DSL & Décorateurs](#dsl--décorateurs)
5. [Structure UI (React + Zustand)](#structure-ui-react--zustand)
6. [Patching Chirurgical (LibCST)](#patching-chirurgical-libcst)
7. [Workflow de Développement](#workflow-de-développement)
8. [Checklist avant Commit](#checklist-avant-commit)

---

## Philosophie & Principes Fondamentaux

### Mantra Principal

**"Code is Truth. Visual is Interface. AI is the Worker."**

Ce mantra définit trois rôles clairs :
- **Code** (Python `*.holon.py`) = source unique de vérité pour la topologie, configuration, et logique
- **Visual** (React UI) = interface pour naviguer, comprendre, et déclencher des actions
- **AI** (Copilot/Agents) = exécute les modifications de code de manière chirurgicale

### Principe "Code First"

**TOUJOURS** :
- ✅ Les nodes, links, et configurations sont déclarés dans le code Python
- ✅ Le code peut être édité manuellement ou via LibCST (lossless)
- ✅ L'UI génère du code Python, ne stocke jamais la topologie en JSON
- ✅ Les mappings de ports sont déclarés avec `@port_map` dans le code

**JAMAIS** :
- ❌ Stocker la topologie du workflow dans du JSON
- ❌ Avoir deux sources de vérité (code + base de données)
- ❌ Permettre à l'UI de diverger du code Python

### JSON = Metadata UI Uniquement

Le JSON est **exclusivement** pour la metadata UI :
- `.holon/positions.json` — Positions X/Y des nodes dans le canvas
- `.holon/annotations.json` — Summaries, badges générés par l'IA

**Règle d'or** : Si ça affecte la logique ou la topologie → **dans le code Python**, pas dans le JSON.

---

## Architecture du Projet

### Structure Monorepo

```
holon/
├── core/                    # Backend Python (Poetry)
│   ├── holon/              # Package principal
│   │   ├── domain/         # Models Pydantic (Graph, Node, Edge, DataEnvelope, PortMapping)
│   │   ├── execution/      # Engine, PortRegistry, PortMapper, Resolver
│   │   ├── services/       # GraphParser, Patcher
│   │   ├── library/        # Nodes préfabriquées (LangChain, LLM)
│   │   ├── dsl.py          # Décorateurs (@node, @workflow, @link, @port_map)
│   │   └── api.py          # Server RPC JSONL
│   ├── examples/           # Workflows de démonstration
│   ├── tests/              # Tests unitaires (pytest)
│   └── pyproject.toml      # Poetry config
│
├── extension/              # Extension VS Code
│   ├── src/
│   │   ├── extension.ts    # Point d'entrée
│   │   ├── rpcClient.ts    # Communication avec Python
│   │   └── webview.ts      # Host pour UI React
│   └── package.json
│
├── ui/                     # UI React (Vite)
│   ├── src/
│   │   ├── App.tsx         # Composant principal
│   │   ├── store/          # Zustand stores (voir section dédiée)
│   │   ├── components/     # Composants React
│   │   ├── protocol.ts     # Types partagés avec Python
│   │   ├── vscodeBridge.ts # Communication avec extension
│   │   └── ports.ts        # Logique des ports
│   ├── index.html
│   └── package.json
│
├── holon_blueprint.md      # 🔴 SOURCE DE VÉRITÉ — LIRE EN PREMIER
├── AGENT.md                # Ce document (guide pour agents IA)
├── SPEC_*.md               # Spécifications techniques détaillées
└── package.json            # Scripts npm racine
```

### Technologies & Stack

- **Backend** : Python 3.11+ avec Poetry (gestion de dépendances)
- **Parsing** : LibCST (lossless AST transformations)
- **Models** : Pydantic 2.x pour validation et sérialisation
- **Frontend** : React 18 + TypeScript + Vite
- **State** : Zustand (stores immer + devtools)
- **Graph** : React Flow pour le canvas visuel
- **RPC** : JSONL sur stdio entre extension et Python

---

## Règles de Gestion de Code

### 0. Pas de Legacy, Pas de Fallback

⚠️ **CRITIQUE** : Ce projet est en phase de développement actif. Nous n'avons pas de contraintes de production.

**Quand on change de méthode** :
- ✅ On change partout, immédiatement
- ✅ On supprime l'ancienne approche complètement
- ✅ On nettoie les exemples et tests
- ✅ On met à jour la documentation

**Ce qu'on ne fait PAS** :
- ❌ Pas de support pour les anciennes syntaxes "deprecated"
- ❌ Pas de fallback pour compatibilité
- ❌ Pas de migration progressive
- ❌ Pas de code mort qui traîne

**Exemple concret** : Quand `@node` remplace `spec()`, on supprime `spec()` du DSL ET on nettoie tous les exemples. Pas de période de transition.

### 1. Browser = Miroir de VS Code

⚠️ **UI UNIFIÉE** : Le mode dev navigateur (`npm run dev`) et l'extension VS Code utilisent **exactement le même code UI**.

**Architecture** :
```
ui/                         # UI React (source unique)
├── src/
│   ├── App.tsx            # Composant principal
│   ├── store/             # Zustand stores
│   ├── components/        # Composants réutilisables
│   └── vscodeBridge.ts    # Abstraction communication

extension/
└── src/
    └── webview.ts         # Host qui charge UI compilée
```

**Règles absolues** :
- ❌ **JAMAIS** de duplication de logique UI entre navigateur et extension
- ❌ **JAMAIS** de code spécifique "VS Code only" dans les composants
- ✅ Tout passe par `vscodeBridge.ts` qui abstrait la communication
- ✅ On dev et debug dans le navigateur (refresh rapide)
- ✅ L'extension VS Code charge le même `dist/` compilé

**Workflow de dev** :
1. Développer dans le navigateur (`http://localhost:5173`)
2. Tester avec hot reload
3. Builder avec `npm run build`
4. L'extension VS Code utilise automatiquement le même bundle

**Avantage** : Vitesse de développement maximale, aucune divergence possible.

### 2. Blueprint = Source de Vérité

**`holon_blueprint.md`** est LE document d'architecture :
### 2. Blueprint = Source de Vérité

**`holon_blueprint.md`** est LE document d'architecture :
- Toute décision majeure doit y être documentée
- En cas de conflit entre documents → `holon_blueprint.md` gagne
- **TOUJOURS** mettre à jour le blueprint après changements architecturaux

**Avant toute modification** :
```bash
# 1. Lire le blueprint
cat holon_blueprint.md

# 2. Lire la spec pertinente (si existe)
cat SPEC_DATA_TRANSPORT.md  # Exemple

# 3. Coder
# 4. Mettre à jour blueprint si nécessaire
```

### 3. Poetry pour Python

**Installation des dépendances** :
```bash
cd core
poetry install
```

**Lancer les tests** :
```bash
cd core
poetry run pytest tests/ -v
```

**Ajouter une dépendance** :
```bash
poetry add nom-du-package
```

**NON Poetry** :
- ❌ Ne pas utiliser `pip install`
- ❌ Ne pas créer de `requirements.txt` manuel
- ❌ Ne pas modifier `pyproject.toml` à la main (passer par `poetry add`)

### 4. Patching Lossless avec LibCST

Toutes les modifications de code Python utilisent **LibCST** pour :
- Préserver les commentaires
- Préserver le formatage
- Préserver les espaces blancs
- Modifications chirurgicales (pas de reformat global)

**Fichiers clés** :
- `core/holon/services/patcher.py` — Moteur de patching
- `core/holon/services/parser.py` — Parsing DSL

**Règle** : Ne jamais utiliser `ast.parse()` + `ast.unparse()` pour modifier du code (destructif). Toujours LibCST.

---

## DSL & Décorateurs

### Décorateurs Principaux

#### `@node` — Décorateur Universel

**Sur une fonction** (node custom avec logique inline) :
```python
@node
def analyze(x: int) -> int:
    """Custom processing logic."""
    return x + 1
```

**Sur une classe** (node library préfabriquée) :
```python
@node(type="llm.model", id="spec:llm:my_gpt4")
class MyGPT4:
    """GPT-4o configuration."""
    model_name = "gpt-4o"
    temperature = 0.7
    provider = "openai"
```

**Règles** :
- Fonction → ID auto : `node:<function_name>`
- Classe → Paramètre `type=` **obligatoire**, ID par défaut : `spec:<type>:<class_name_snake_case>`
- Les attributs de classe (non-privés, non-callables) deviennent les `props`

#### `@workflow` — Orchestration

```python
@workflow
async def main() -> str:
    """Entry point for workflow execution."""
    result = await analyze(42)
    return result
```

- Les appels de fonctions dans le corps créent des edges implicites
- ID : `workflow:<function_name>`

#### `@link` — Liens Explicites

**Syntaxe recommandée** (code-first) :
```python
@workflow
async def main() -> str:
    @link
    class _:  # Classe anonyme
        source = (NodeA, "output")
        target = (NodeB, "input")
```

**Pourquoi** :
- Références directes (pas de strings)
- Refactoring-safe
- Autocomplete IDE
- AI-friendly

#### `@port_map` — Mappings de Ports (Phase 6.1)

```python
@workflow
async def chat_agent() -> str:
    # Mapping avec transformation
    @port_map
    class _:
        source = (ChatNode, "out.message")
        target = (AgentNode, "in.prompt")
        transform = "$.content"           # JSONPath
        target_field = "user"             # Injection dans sous-champ
        on_error = "stop"                 # "stop" | "skip" | "pass"
```

**Transformations supportées** :
- **JSONPath** : `"$.content"`, `"$.metadata.role"`
- **Templates** : `"{{metadata.role}}: {{content}}"`
- **Lambda Python** (sandboxed) : `"lambda env: env.content.upper()"`

### Imports Standards

```python
from holon import node, workflow, link, port_map
from holon.domain.models import DataEnvelope, PortMapping
```

---

## Structure UI (React + Zustand)

### Architecture des Stores

**Pattern obligatoire** (voir `ui/src/store/template.ts`) :

```typescript
interface MyStore {
  // 1. State (readonly)
  readonly items: Item[];
  readonly selectedId: string | null;
  
  // 2. Actions (grouped, verb-based)
  actions: {
    add: (item: Item) => void;
    update: (id: string, updates: Partial<Item>) => void;
    remove: (id: string) => void;
  }
  
  // 3. Selectors (computed, prefixed with get)
  selectors: {
    getById: (id: string) => Item | undefined;
    getSelected: () => Item | undefined;
  }
}

// Middleware: devtools + immer
export const useMyStore = create<MyStore>()(
  devtools(
    immer((set, get) => ({
      // State initial
      items: [],
      selectedId: null,
      
      // Actions
      actions: {
        add: (item) => set((state) => {
          state.items.push(item);
        }, false, 'items/add'),  // DevTools action name
      },
      
      // Selectors
      selectors: {
        getById: (id) => get().items.find(i => i.id === id),
      },
    })),
    { name: 'My Store' }
  )
);
```

### Stores Existants

- **`graph.store.ts`** — Nodes et edges du workflow
- **`ui.store.ts`** — État UI (modals, sélections, panels)
- **`execution.store.ts`** — Résultats d'exécution
- **`credentials.store.ts`** — API keys (OpenAI, etc.)
- **`nodeTypes.store.ts`** — Catalogue de types de nodes
- **`mapping.store.ts`** — Port mappings (Phase 6.1)

### Règles des Stores

1. **One domain = One store** — Pas de mélange de responsabilités
2. **Selectors for derived data** — Jamais de calculs dans les composants
3. **Actions for mutations** — Jamais de mutation directe dans les composants
4. **DevTools actions nommées** — Format : `'domain/action'`
5. **Type everything** — Coverage TypeScript à 100%

### Usage dans Composants

```typescript
// ✅ BON : Subscription sélective
const nodes = useGraphStore(s => s.nodes);
const { add } = useGraphStore(s => s.actions);

// ❌ MAUVAIS : Re-render sur tout changement
const store = useGraphStore();
const nodes = store.nodes;
```

### Exports Centralisés

**Toujours** exporter depuis `store/index.ts` :
```typescript
export { useMyStore, type MyStore } from './my.store';
```

---

## Patching Chirurgical (LibCST)

### Principes

- **Lossless** : Préserve commentaires, espaces, style
- **Ciblé** : Modifie uniquement le nécessaire
- **Stable** : IDs de nodes stables (`node:*`, `spec:*`)

### Exemples de Patches

#### Modifier une node `spec(...)`

```python
# Avant
spec("spec:llm:1", type="llm.model", props={"temperature": 0.5})

# Patch : changer temperature à 0.7
# → GraphPatcher trouve le call, modifie l'arg props["temperature"]

# Après
spec("spec:llm:1", type="llm.model", props={"temperature": 0.7})
```

#### Ajouter un attribut à une classe `@node`

```python
# Avant
@node(type="llm.model")
class GPT4:
    temperature = 0.5

# Patch : ajouter max_tokens
# → LibCST ajoute un nouveau SimpleStatementLine dans ClassDef.body

# Après
@node(type="llm.model")
class GPT4:
    temperature = 0.5
    max_tokens = 2000
```

### Tests de Patching

Toujours ajouter des tests dans `core/tests/test_patcher.py` :
```python
def test_patch_node_attribute():
    source = '''
@node(type="llm.model")
class GPT4:
    temperature = 0.5
    '''
    
    patcher = GraphPatcher(source)
    result = patcher.patch_node_attribute("spec:llm:gpt4", "max_tokens", 2000)
    
    assert "max_tokens = 2000" in result
```

---

## Workflow de Développement

### 1. Setup Initial

```bash
# Clone repo
git clone <repo-url>
cd holon

# Install Python deps
cd core
poetry install
cd ..

# Install Node deps (ui + extension)
npm install
cd extension && npm install && cd ..
cd ui && npm install && cd ..

# Build UI
cd ui && npm run build && cd ..
```

### 2. Mode Développement

**Option A** : Tout en un (recommandé)
```bash
npm run dev
```
→ Lance API Python (auto-restart) + UI Vite (HMR)

**Option B** : Séparé
```bash
# Terminal 1 : API Python
npm run dev:api-watch

# Terminal 2 : UI
cd ui && npm run dev
```

### 3. Tests

```bash
# Python tests
cd core
poetry run pytest tests/ -v

# Specific test
poetry run pytest tests/test_port_mapper.py -v
```

### 4. Extension VS Code

```bash
# Compile extension
cd extension
npm run compile

# Run (dans VS Code)
# Ouvrir extension/ dans VS Code
# Appuyer sur F5 → Extension Development Host
# Ouvrir un fichier *.holon.py
# Cmd+Shift+P → "Holon: Open"
```

---

## Checklist avant Commit

### Pour l'Agent IA

Avant de considérer une tâche comme "terminée" :

- [ ] **Blueprint mis à jour** si changements architecturaux
- [ ] **Specs mises à jour** si nouveaux features
- [ ] **Tests écrits** pour nouveau code (coverage)
- [ ] **Tests passent** : `poetry run pytest` ✅
- [ ] **Types corrects** : pas de `any` en TypeScript
- [ ] **Stores suivent template** si nouveau store créé
- [ ] **Exports ajoutés** dans `store/index.ts` si nouveau store
- [ ] **Code suit pattern** LibCST pour modifications Python
- [ ] **Pas de JSON pour topologie** — seulement pour metadata UI
- [ ] **Imports propres** — pas de circular dependencies
- [ ] **Console.log supprimés** — utiliser devtools actions
- [ ] **Documentation inline** — JSDoc pour fonctions complexes

### Vérifications Code Python

- [ ] Type hints complets (`mypy` strict mode)
- [ ] Docstrings pour fonctions publiques
- [ ] Utilisation de Pydantic pour models
- [ ] LibCST pour modifications de code (jamais `ast.unparse`)
- [ ] Tests pytest avec fixtures appropriées

### Vérifications Code TypeScript/React

- [ ] Composants fonctionnels (pas de classes)
- [ ] Hooks au bon endroit (pas dans conditions)
- [ ] Stores Zustand avec pattern template
- [ ] Subscriptions sélectives (pas tout le store)
- [ ] Types explicites (pas d'inférence excessive)

---

## Commandes Rapides (Cheatsheet)

```bash
# Tests Python
cd core && poetry run pytest tests/ -v

# Test spécifique
cd core && poetry run pytest tests/test_port_mapper.py::TestPortMapper::test_jsonpath_content -v

# Dev mode (tout en un)
npm run dev

# Dev UI seule
cd ui && npm run dev

# Build UI pour extension
cd ui && npm run build

# Compile extension
cd extension && npm run compile

# Ajouter dépendance Python
cd core && poetry add nom-package

# Ajouter dépendance npm (UI)
cd ui && npm install nom-package

# Check types Python
cd core && poetry run mypy holon/

# Format Python
cd core && poetry run ruff check holon/
```

---

## Ressources Critiques

### Documents à Lire (par ordre de priorité)

1. **`AGENT.md`** (ce fichier) — Vue d'ensemble
2. **`holon_blueprint.md`** — Architecture et décisions
3. **`SPEC_DATA_TRANSPORT.md`** — Port mappings (Phase 6.1)
4. **`ui/src/store/README.md`** — Pattern des stores
5. **`ui/src/store/template.ts`** — Template pour nouveaux stores

### Fichiers Clés du Codebase

**Python Core** :
- `core/holon/dsl.py` — Décorateurs DSL
- `core/holon/domain/models.py` — Models Pydantic
- `core/holon/services/graph_parser.py` — Parsing DSL
- `core/holon/services/patcher.py` — Patching LibCST
- `core/holon/execution/engine.py` — Engine d'exécution
- `core/holon/execution/mapper.py` — Transformations de ports

**UI React** :
- `ui/src/App.tsx` — Composant principal
- `ui/src/store/*.store.ts` — Stores Zustand
- `ui/src/protocol.ts` — Types partagés
- `ui/src/vscodeBridge.ts` — Communication extension

**Extension** :
- `extension/src/extension.ts` — Entry point
- `extension/src/rpcClient.ts` — Client RPC Python

---

## Questions Fréquentes (FAQ)

### Q : Dois-je stocker les mappings de ports dans le JSON ?
**R** : NON. Les `@port_map` sont déclarés dans le code Python. Le JSON ne stocke que les positions et annotations UI.

### Q : Comment ajouter un nouveau type de node ?
**R** : 
1. Créer une classe avec `@node(type="...")` dans `core/holon/library/`
2. Implémenter la résolution dans `core/holon/execution/resolver.py`
3. Ajouter le type dans `core/holon/registry.py`
4. Mettre à jour `holon_blueprint.md`

### Q : Comment créer un nouveau store Zustand ?
**R** :
1. Copier `ui/src/store/template.ts`
2. Renommer et implémenter state/actions/selectors
3. Exporter depuis `ui/src/store/index.ts`
4. Suivre le pattern (devtools + immer)

### Q : Puis-je utiliser `pip` au lieu de Poetry ?
**R** : NON. Le projet utilise **exclusivement** Poetry pour la gestion des dépendances Python.

### Q : Comment débugger l'extension VS Code ?
**R** :
1. Ouvrir `extension/` dans VS Code
2. F5 → Extension Development Host
3. Utiliser les DevTools du webview (Cmd+Shift+P → "Developer: Open Webview Developer Tools")

### Q : L'UI peut-elle modifier directement le code Python ?
**R** : L'UI peut **demander** des modifications via :
- Prompts à Copilot (AI-assisted)
- Génération de code (insertion via RPC + LibCST patch)
Mais l'UI ne modifie JAMAIS le code directement — elle passe toujours par le backend Python.

---

## Philosophie Récapitulative

### Ce qui rend Holon Unique

1. **Code-First** : Le code Python est la seule source de vérité
2. **AI-Native** : Syntaxe DSL conçue pour être lue/écrite par l'IA
3. **Lossless Editing** : LibCST préserve tout (commentaires, style)
4. **Visual Interface** : L'UI sert à comprendre et déclencher, pas à définir
5. **Dualité Récursive** : Chaque node = mini-agent, graphe = méta-agent

### Mindset pour l'Agent IA

**Penser en termes de** :
- "Quel code Python générer ?" (pas "Quelle donnée stocker ?")
- "Comment patcher proprement ?" (pas "Comment réécrire ?")
- "Code ou UI metadata ?" (topologie = code, positions = JSON)

**Éviter** :
- Créer des sources de vérité alternatives
- Réinventer les patterns existants (stores, patching)
- Ignorer le blueprint lors de changements majeurs

---

## Contact & Support

Pour questions ou clarifications :
1. Lire `holon_blueprint.md` en premier
2. Consulter les specs (`SPEC_*.md`)
3. Vérifier les tests existants pour exemples
4. Demander confirmation avant changements architecturaux majeurs

---

**Dernière mise à jour** : 2026-02-03  
**Version Blueprint** : Phase 6.1 (Data Transport & Port Mapping)
