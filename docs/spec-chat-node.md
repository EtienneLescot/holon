# Spec — Chat Node (UI Interactive)

**Date**: 2026-02-03  
**Status**: Draft — pour validation  
**Phase**: 6.2 (interactive nodes)  
**Dépendances**: [`spec-data-transport.md`](spec-data-transport.md) (DataEnvelope, @port_map)

---

## 1) Vue d'ensemble

### Objectif
Créer un **nœud de chat interactif** permettant à l'utilisateur d'envoyer et recevoir des messages directement depuis l'UI, créant ainsi une boucle conversationnelle avec d'autres nodes (agents, LLMs, etc.).

### Caractéristiques clés
- **Input form** dans l'UI pour saisir un message.
- **Message history** affichée dans le nœud.
- **Output** : émet le message utilisateur sur un port `out.message`.
- **Input** : reçoit des réponses (agent, système) sur un port `in.message`.
- **Boucle** : utilisateur → agent → chat → utilisateur → ...

### Conformité Holon
- **Code is Truth** : le node est déclaré via `@node(type="ui.chat")` dans le `*.holon.py`.
- **Visuel = Interface** : l'UI affiche un composant React custom pour ce type de node.
- **AI = Worker** : l'IA peut modifier la configuration du node (placeholder, max_history, etc.).
- **AI-Friendly** : syntaxe déclarative simple (classe avec attributs) facile à lire/écrire/modifier pour l'IA.

---

## 2) Spécification du node type

### 2.1) Déclaration DSL (Python)

**Type identifier** : `"ui.chat"`

**Exemple de déclaration**:

```python
from holon import node

@node(type="ui.chat", id="spec:chat:main")
class ChatNode:
    """Interactive chat node for user input/output."""
    
    # Configuration
    placeholder: str = "Tapez votre message..."
    max_history: int = 50
    auto_scroll: bool = True
    show_timestamps: bool = True
    allow_markdown: bool = True
    
    # Styling (optionnel)
    theme: str = "default"  # "default" | "minimal" | "compact"
```

**Props par défaut**:

```python
{
    "placeholder": "Tapez votre message...",
    "max_history": 50,
    "auto_scroll": True,
    "show_timestamps": True,
    "allow_markdown": True,
    "theme": "default"
}
```

---

### 2.2) Ports (inputs/outputs)

**Structure** (conforme à `PortSpec` dans `domain/models.py`):

```python
{
    "inputs": [
        {
            "id": "in.message",
            "kind": "data",
            "label": "Incoming message",
            "multi": True  # Peut recevoir de multiples sources
        },
        {
            "id": "in.control",
            "kind": "control",
            "label": "Control commands",
            "multi": False
        }
    ],
    "outputs": [
        {
            "id": "out.message",
            "kind": "data",
            "label": "User message",
            "multi": False
        },
        {
            "id": "out.event",
            "kind": "control",
            "label": "Events (send/receive/error)",
            "multi": False
        }
    ]
}
```

**Comportement des ports**:

| Port          | Direction | Type           | Description                                                    |
|---------------|-----------|----------------|----------------------------------------------------------------|
| `in.message`  | Input     | `DataEnvelope` | Reçoit messages (agent, système) à afficher dans l'historique  |
| `in.control`  | Input     | `DataEnvelope` | Reçoit commandes (clear_history, set_config)                   |
| `out.message` | Output    | `DataEnvelope` | Émet le message utilisateur (type="message", role="user")      |
| `out.event`   | Output    | `DataEnvelope` | Émet événements (message_sent, message_received, error)        |

---

### 2.3) Format des messages (DataEnvelope)

**Message utilisateur** (émis sur `out.message`):

```python
DataEnvelope(
    type="message",
    content="Bonjour, peux-tu m'aider ?",
    contentType="text/plain",
    metadata={
        "role": "user",
        "conversationId": "c123",
        "timestamp": "2026-02-03T14:32:00Z"
    },
    origin={
        "nodeId": "spec:chat:main",
        "port": "out.message"
    }
)
```

**Message assistant** (reçu sur `in.message`):

```python
DataEnvelope(
    type="message",
    content="Bonjour ! Je suis là pour vous aider.",
    contentType="text/plain",
    metadata={
        "role": "assistant",
        "model": "gpt-4o",
        "conversationId": "c123"
    },
    origin={
        "nodeId": "spec:agent:1",
        "port": "out.response"
    }
)
```

**Event** (émis sur `out.event`):

```python
DataEnvelope(
    type="event",
    content={
        "action": "message_sent",
        "messageId": "msg_123"
    },
    contentType="application/json",
    origin={"nodeId": "spec:chat:main", "port": "out.event"}
)
```

**Control command** (reçu sur `in.control`):

```python
DataEnvelope(
    type="control",
    content={"action": "clear_history"},
    contentType="application/json"
)
```

---

## 3) Comportement runtime

### 3.1) État du node

Le node maintient un **état local** (non persisté dans le code) :

```typescript
interface ChatNodeState {
  messages: Message[];          // Historique des messages
  conversationId: string;       // ID de conversation
  isWaitingResponse: boolean;   // Indicateur d'attente
  errorMessage: string | null;  // Dernier message d'erreur
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}
```

**Stockage** : dans le store Zustand de l'UI (`ui/src/store/chat.store.ts`).

---

### 3.2) Cycle de vie : envoi de message

1. **Utilisateur saisit un message** dans l'input form de l'UI.
2. **UI crée un `DataEnvelope`** avec `type="message"`, `role="user"`.
3. **UI envoie le message au backend** via RPC :
   ```typescript
   bridge.sendMessage({
     type: "ui.chat.sendMessage",
     nodeId: "spec:chat:main",
     message: {
       content: "Bonjour",
       metadata: { conversationId: "c123" }
     }
   })
   ```
4. **Backend** (extension) reçoit et émet sur `out.message` dans le `PortRegistry`.
5. **ExecutionEngine** propage le message vers les nodes connectées (via `@port_map`).
6. **UI affiche le message** dans l'historique (rôle "user").

---

### 3.3) Cycle de vie : réception de message

1. **Agent node émet une réponse** sur son `out.response`.
2. **ExecutionEngine** propage vers `ChatNode.in.message` (via mapping).
3. **Backend notifie l'UI** via RPC :
   ```typescript
   {
     type: "chat.messageReceived",
     nodeId: "spec:chat:main",
     envelope: {
       content: "Bonjour ! Je suis là pour vous aider.",
       metadata: { role: "assistant", model: "gpt-4o" }
     }
   }
   ```
4. **UI ajoute le message à l'historique** et affiche (rôle "assistant").
5. **UI scroll automatiquement** si `auto_scroll=true`.

---

### 3.4) Commandes de contrôle

Le node peut recevoir des commandes sur `in.control` :

| Action            | Payload                              | Comportement                               |
|-------------------|--------------------------------------|--------------------------------------------|
| `clear_history`   | `{ action: "clear_history" }`        | Vide l'historique (UI + state)             |
| `set_config`      | `{ action: "set_config", props: {} }`| Met à jour la config (placeholder, etc.)   |
| `pause`           | `{ action: "pause" }`                | Désactive l'input (mode readonly)          |
| `resume`          | `{ action: "resume" }`               | Réactive l'input                           |

**Exemple d'usage** :

```python
from holon import links

@links
def define_routing():
    # Commande de contrôle via mapping
    @port_map
    class _:
        source = (ControlNode, "out.command")
        target = (ChatNode, "in.control")
```

---

## 4) Composant UI (React)

### 4.1) Structure du composant

**Fichier** : `ui/src/components/ChatNode.tsx`

```tsx
import { memo, useState, useRef, useEffect } from 'react';
import { useChatStore } from '../store/chat.store';
import type { DataEnvelope } from '../protocol';

interface ChatNodeProps {
  nodeId: string;
  props: {
    placeholder?: string;
    max_history?: number;
    auto_scroll?: boolean;
    show_timestamps?: boolean;
    allow_markdown?: boolean;
    theme?: string;
  };
}

export const ChatNode = memo(({ nodeId, props }: ChatNodeProps) => {
  const messages = useChatStore((s) => s.getMessages(nodeId));
  const sendMessage = useChatStore((s) => s.sendMessage);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    if (props.auto_scroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, props.auto_scroll]);

  const handleSend = () => {
    if (!input.trim()) return;
    sendMessage(nodeId, input);
    setInput('');
  };

  return (
    <div className="chat-node" data-theme={props.theme}>
      {/* Message history */}
      <div className="chat-messages">
        {messages.slice(-props.max_history!).map((msg) => (
          <div key={msg.id} className={`message message-${msg.role}`}>
            {props.show_timestamps && (
              <span className="timestamp">{formatTime(msg.timestamp)}</span>
            )}
            <div className="message-content">
              {props.allow_markdown ? (
                <Markdown>{msg.content}</Markdown>
              ) : (
                <span>{msg.content}</span>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input form */}
      <div className="chat-input">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSend()}
          placeholder={props.placeholder}
        />
        <button onClick={handleSend}>Envoyer</button>
      </div>
    </div>
  );
});
```

---

### 4.2) Store Zustand (`chat.store.ts`)

```typescript
import { create } from 'zustand';
import type { DataEnvelope } from '../protocol';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

interface ChatState {
  // State par node
  nodeMessages: Map<string, Message[]>;
  conversationIds: Map<string, string>;
  
  // Actions
  getMessages: (nodeId: string) => Message[];
  addMessage: (nodeId: string, message: Message) => void;
  sendMessage: (nodeId: string, content: string) => void;
  clearHistory: (nodeId: string) => void;
  receiveEnvelope: (nodeId: string, envelope: DataEnvelope) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  nodeMessages: new Map(),
  conversationIds: new Map(),
  
  getMessages: (nodeId) => {
    return get().nodeMessages.get(nodeId) || [];
  },
  
  addMessage: (nodeId, message) => {
    set((state) => {
      const messages = state.nodeMessages.get(nodeId) || [];
      const updated = new Map(state.nodeMessages);
      updated.set(nodeId, [...messages, message]);
      return { nodeMessages: updated };
    });
  },
  
  sendMessage: (nodeId, content) => {
    const message: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date(),
    };
    
    // Add to local state
    get().addMessage(nodeId, message);
    
    // Send to backend via RPC
    window.bridge?.sendMessage({
      type: 'ui.chat.sendMessage',
      nodeId,
      envelope: {
        type: 'message',
        content,
        contentType: 'text/plain',
        metadata: {
          role: 'user',
          conversationId: get().conversationIds.get(nodeId) || 'default',
        },
        origin: { nodeId, port: 'out.message' },
        timestamp: new Date().toISOString(),
      },
    });
  },
  
  receiveEnvelope: (nodeId, envelope) => {
    if (envelope.type === 'message') {
      const message: Message = {
        id: `msg_${Date.now()}`,
        role: envelope.metadata?.role || 'assistant',
        content: envelope.content,
        timestamp: new Date(envelope.timestamp || Date.now()),
        metadata: envelope.metadata,
      };
      get().addMessage(nodeId, message);
    }
  },
  
  clearHistory: (nodeId) => {
    set((state) => {
      const updated = new Map(state.nodeMessages);
      updated.set(nodeId, []);
      return { nodeMessages: updated };
    });
  },
}));
```

---

### 4.3) Intégration dans React Flow

**Modification de `App.tsx`** :

```tsx
import { ChatNode } from './components/ChatNode';

const nodeTypes = {
  default: CustomNode,
  workflow: WorkflowNode,
  chat: ChatNode,  // ← Nouveau type
};

// Dans le render
<ReactFlow
  nodes={nodes}
  edges={edges}
  nodeTypes={nodeTypes}
  // ...
/>
```

**Détection du type** : basé sur `node.nodeType === "ui.chat"`.

---

## 5) RPC Protocol (extension ↔ UI)

### 5.0) Philosophie : UI manuelle + AI-assisted

**Principes** :
- L'utilisateur peut **interagir manuellement** avec le chat node (saisir messages, voir réponses).
- L'IA peut **suggérer des améliorations** (configs, prompts, connexions).
- L'UI fournit des **outils visuels** pour faciliter la configuration.

### 5.1) Messages UI → Backend

**Envoi de message** :

```typescript
{
  type: "ui.chat.sendMessage",
  nodeId: string,
  envelope: DataEnvelope
}
```

**Commande de contrôle** :

```typescript
{
  type: "ui.chat.control",
  nodeId: string,
  action: "clear_history" | "pause" | "resume"
}
```

---

### 5.2) Messages Backend → UI

**Message reçu** :

```typescript
{
  type: "chat.messageReceived",
  nodeId: string,
  envelope: DataEnvelope
}
```

**Event** :

```typescript
{
  type: "chat.event",
  nodeId: string,
  event: {
    action: "message_sent" | "message_received" | "error",
    details?: any
  }
}
```

---

### 5.3) Implémentation backend (extension)

**Fichier** : `extension/src/chatHandler.ts`

```typescript
export class ChatHandler {
  constructor(
    private rpcClient: RpcClient,
    private webview: Webview
  ) {}

  async handleSendMessage(nodeId: string, envelope: DataEnvelope) {
    // 1. Émettre sur le port out.message dans le PortRegistry
    await this.rpcClient.call('chat.emit', {
      nodeId,
      port: 'out.message',
      envelope,
    });

    // 2. Notifier l'UI que le message a été envoyé
    this.webview.postMessage({
      type: 'chat.event',
      nodeId,
      event: { action: 'message_sent' },
    });
  }

  async handleIncomingMessage(nodeId: string, envelope: DataEnvelope) {
    // Recevoir message d'un agent → envoyer à l'UI
    this.webview.postMessage({
      type: 'chat.messageReceived',
      nodeId,
      envelope,
    });
  }

  async handleControlCommand(nodeId: string, action: string) {
    if (action === 'clear_history') {
      this.webview.postMessage({
        type: 'chat.event',
        nodeId,
        event: { action: 'clear_history' },
      });
    }
  }
}
```

---

## 6) Exemple complet : Chat ↔ Agent

**Fichier** : `examples/chat_agent.holon.py`

```python
from holon import node, workflow, port_map

# Chat node
@node(type="ui.chat", id="spec:chat:main")
class ChatNode:
    """Interactive chat interface."""
    placeholder = "Posez votre question..."
    max_history = 50

# Agent node
@node(type="langchain.agent", id="spec:agent:assistant")
class AgentNode:
    """LangChain conversational agent."""
    system_prompt = "Tu es un assistant utile et bienveillant."
    model = "gpt-4o"
    temperature = 0.7

# Workflow avec boucle
from holon import node, links

@node(type="trigger.chat", id="node:chat:main")
class ChatNode:
    placeholder = "Type your message..."

@node(type="langchain.agent", id="node:agent:assistant")
class AgentNode:
    system_prompt = "You are a helpful assistant."

@node(type="llm.model", id="node:llm:gpt4o")
class LlmModel:
    provider = "openai"
    model_name = "gpt-4o"

@links
def define_routing():
    """Conversational loop: User → Agent → User."""
    
    # 1. Dependency binding
    AgentNode.uses(llm=LlmModel.output)
    
    # 2. Pipeline flow avec transformation
    # Chat → Agent (user message avec extraction de contenu)
    @port_map
    class _:
        source = (ChatNode, "out.message")
        target = (AgentNode, "in.prompt")
        transform = "$.content"
        target_field = "user"
    
    # Agent → Chat (assistant response, mapping simple)
    @port_map
    class _:
        source = (AgentNode, "out.response")
        target = (ChatNode, "in.message")
        # Identity mapping (pas de transform)
```

**Alternative pour cas simple** (sans transformation) :

```python
@links
def define_routing():
    # Si pas de transformation nécessaire, utiliser >>
    AgentNode.uses(llm=LlmModel.output)
    ChatNode.out >> AgentNode.input
    AgentNode.output >> ChatNode.response
```

**Flux de données** :

```
User input → ChatNode.out.message
          ↓ (port_map: extract content)
          AgentNode.in.prompt.user
          ↓ (agent processing)
          AgentNode.out.response
          ↓ (port_map: identity)
          ChatNode.in.message → UI display
```

---

## 7) Interface utilisateur détaillée

### 7.1) Vue d'ensemble UI

**Composants principaux** :

1. **ChatNode UI** (dans le canvas React Flow) :
   - Historique de messages (scrollable)
   - Input form + bouton envoyer
   - Indicateur de status (en attente, erreur)
   - Boutons d'action (clear, export, config)

2. **Chat Inspector Panel** (sidebar) :
   - Configuration du node (props éditables)
   - Historique complet avec filtres
   - Statistiques (nb messages, tokens utilisés)
   - Actions (clear, export JSON/MD, import)

3. **Connection Assistant** (modal) :
   - Guide l'utilisateur pour connecter le chat à un agent
   - Suggère des mappings automatiques
   - Permet la configuration manuelle

---

### 7.2) ChatNode Canvas UI (composant principal)

**Visuel** (wireframe) :

```
┌─────────────────────────────────────┐
│ 💬 Chat                         [⚙️] │  ← Header (label + config)
├─────────────────────────────────────┤
│ 📥 in.message   📤 out.message      │  ← Ports visibles
│ 🎛️ in.control   ⚡ out.event        │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ 👤 User (14:32)                 │ │  ← Message user
│ │ Bonjour, peux-tu m'aider ?      │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ 🤖 Assistant (14:32)            │ │  ← Message assistant
│ │ Bien sûr ! Que puis-je faire   │ │
│ │ pour vous ?                      │ │
│ └─────────────────────────────────┘ │
│ ⋮ (scroll for more)                 │
├─────────────────────────────────────┤
│ [Tapez votre message...        ] 📤 │  ← Input + send button
├─────────────────────────────────────┤
│ 💬 2 messages | ⏱️ Waiting...       │  ← Status bar
│ [Clear] [Export] [Inspector]        │  ← Actions
└─────────────────────────────────────┘
```

**États** :
- **Idle** : en attente d'input utilisateur.
- **Sending** : message envoyé, en attente de réponse (spinner).
- **Receiving** : réponse en cours (si streaming activé).
- **Error** : erreur d'envoi ou de réception (bordure rouge).

**Interactions** :
- **Click sur header** → focus/unfocus (agrandir le node).
- **Click sur ⚙️** → ouvre config panel.
- **Click sur message** → affiche metadata (hover tooltip).
- **Right-click sur message** → menu contextuel (copy, delete, regenerate).

---

### 7.3) Chat Inspector Panel (sidebar détaillé)

**Objectif** : vue détaillée et contrôle avancé du chat node.

**Visuel** :

```
┌─────────────────────────────────────┐
│ 🔍 Chat Inspector                   │
│ Node: spec:chat:main                │
├─────────────────────────────────────┤
│ 📋 Configuration                    │
│ ┌─────────────────────────────────┐ │
│ │ Placeholder:                    │ │
│ │ [Tapez votre message...    ]    │ │
│ │ Max History: [50        ] msgs  │ │
│ │ ☑️ Auto-scroll                   │ │
│ │ ☑️ Show timestamps               │ │
│ │ ☑️ Allow Markdown                │ │
│ │ Theme: [default         ▾]      │ │
│ └─────────────────────────────────┘ │
│ [Apply changes]  [Ask AI to edit]  │
├─────────────────────────────────────┤
│ 💬 Message History (24 msgs)       │
│ [Search...] [Filter: All ▾]        │
│ ┌─────────────────────────────────┐ │
│ │ 👤 User (14:30)                 │ │
│ │ Bonjour                         │ │
│ │ [Copy] [Delete] [Info]          │ │
│ ├─────────────────────────────────┤ │
│ │ 🤖 Assistant (14:30)            │ │
│ │ Bonjour ! Comment puis-je...    │ │
│ │ [Copy] [Regenerate] [Info]      │ │
│ └─────────────────────────────────┘ │
│ [Clear all] [Export...]            │
├─────────────────────────────────────┤
│ 📊 Statistics                       │
│ Total messages: 24                  │
│ User: 12 | Assistant: 12           │
│ Tokens used: ~3,450                 │
│ Avg response time: 2.3s             │
├─────────────────────────────────────┤
│ 🔗 Connections                      │
│ Inputs:                             │
│ ← spec:agent:1.out.response         │
│ Outputs:                            │
│ → spec:agent:1.in.prompt            │
│   (mapped via $.content → user)     │
│ [Edit mappings]                     │
└─────────────────────────────────────┘
```

**Fonctionnalités** :

1. **Configuration éditable** :
   - Formulaire pour modifier les props du node.
   - Bouton "Ask AI to edit" → envoie prompt à Copilot pour modifier le code.
   - Bouton "Apply changes" → génère patch et met à jour le code.

2. **Historique détaillé** :
   - Recherche full-text dans les messages.
   - Filtres (user/assistant/system, date).
   - Actions par message (copier, supprimer, info metadata).

3. **Statistiques** :
   - Compte messages, tokens (si disponible depuis metadata).
   - Temps de réponse moyen.

4. **Connections viewer** :
   - Affiche les edges connectés au node.
   - Montre les mappings appliqués.
   - Bouton "Edit mappings" → ouvre Mapping Editor (voir [spec-data-transport.md](spec-data-transport.md)).

---

### 7.4) Connection Assistant (modal)

**Objectif** : guider l'utilisateur pour connecter le chat à un agent/LLM.

**Déclencheur** : drag edge depuis ChatNode vers un autre node.

**Visuel** :

```
┌──────────────────────────────────────────┐
│ 🔗 Connect Chat to Agent                 │
├──────────────────────────────────────────┤
│ You're connecting:                       │
│ ChatNode (spec:chat:main)                │
│    ↓                                     │
│ AgentNode (spec:agent:assistant)         │
├──────────────────────────────────────────┤
│ 🤖 AI Suggestion:                        │
│ "Connect chat output to agent input with │
│  content extraction and user field       │
│  mapping."                               │
│                                          │
│ Generated mapping:                       │
│ ┌──────────────────────────────────────┐ │
│ │ @port_map                            │ │
│ │ class _:                             │ │
│ │     source = (ChatNode, "out.msg")   │ │
│ │     target = (AgentNode, "in.prompt")│ │
│ │     transform = "$.content"          │ │
│ │     target_field = "user"            │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ ☑️ Also connect agent response back to   │
│    chat (bidirectional loop)            │
│                                          │
│ [Let AI apply]  [Customize]  [Cancel]   │
└──────────────────────────────────────────┘
```

**Comportements** :

1. **Let AI apply** :
   - Envoie prompt à Copilot avec contexte complet.
   - IA génère `@port_map` (et éventuellement le mapping inverse).
   - Patch appliqué au code, UI refresh.

2. **Customize** :
   - Ouvre Mapping Editor (voir [spec-data-transport.md](spec-data-transport.md) section 5.3).
   - Utilisateur configure manuellement.

3. **Bidirectional option** :
   - Si coché, génère 2 mappings (Chat → Agent ET Agent → Chat).

---

### 7.5) Interaction flows (user stories)

#### User Story 1 : Créer et tester un chat node

1. User : "Create a chat node"
2. AI : Génère code `@node(type="ui.chat")` dans le workflow.
3. UI : Parse et affiche le ChatNode dans le canvas.
4. User : Click sur le node → saisit "Hello" dans l'input.
5. UI : Message affiché dans l'historique, émis sur `out.message`.
6. (Pas encore connecté) → message en attente.

#### User Story 2 : Connecter chat à agent via AI

1. User : Drag edge de ChatNode vers AgentNode.
2. UI : Détecte incompatibilité de types → ouvre Connection Assistant.
3. AI : Propose mapping automatique (analyse schémas des ports).
4. UI : Affiche preview du code `@port_map`.
5. User : Click "Let AI apply".
6. AI : Insère le code via patch chirurgical.
7. UI : Re-parse, affiche edge avec icône 🔄 (mapping actif).

#### User Story 3 : Connecter manuellement (drag & drop fields)

1. User : Drag edge ChatNode → AgentNode.
2. UI : Ouvre Connection Assistant → click "Customize".
3. UI : Affiche Mapping Editor avec schémas source/target.
4. User : Drag field `content` (source) → drop sur `user` (target).
5. UI : Génère `transform = "$.content"` + `target_field = "user"`.
6. User : Click "Insert Code".
7. Extension : Applique patch LibCST, insère `@port_map`.
8. UI : Re-parse, edge actif.

#### User Story 4 : Modifier un mapping existant

1. User : Click sur edge ChatNode → AgentNode.
2. UI : Affiche tooltip avec mapping (transform, target_field).
3. User : Click "Edit".
4. UI : Ouvre Mapping Editor pré-rempli.
5. User : Change `transform` de `"$.content"` à `"$.metadata.text"`.
6. User : Click "Apply via AI".
7. AI : Modifie le `@port_map` existant (via LibCST patch).
8. UI : Re-parse, edge mis à jour.

---

### 7.6) Composants React additionnels

**Fichiers à créer** :

```
ui/src/components/
├─ ChatNode.tsx              (déjà spécifié section 4.1)
├─ ChatInspectorPanel.tsx    (sidebar détaillé)
├─ ConnectionAssistant.tsx   (modal de connexion)
├─ MessageList.tsx           (historique de messages)
├─ MessageItem.tsx           (un message individuel)
├─ ChatConfigForm.tsx        (formulaire de config)
└─ ChatStatusBar.tsx         (barre de status en bas du node)
```

**Exemple** : `ChatInspectorPanel.tsx`

```tsx
interface ChatInspectorProps {
  nodeId: string;
  onConfigChange: (props: Partial<ChatNodeProps>) => void;
  onAskAI: (instruction: string) => void;
}

export const ChatInspectorPanel = ({ nodeId, onConfigChange, onAskAI }: ChatInspectorProps) => {
  const messages = useChatStore((s) => s.getMessages(nodeId));
  const connections = useGraphStore((s) => s.getNodeConnections(nodeId));
  const [config, setConfig] = useState<Partial<ChatNodeProps>>({});

  return (
    <div className="chat-inspector">
      <header>
        <h2>💬 Chat Inspector</h2>
        <span>{nodeId}</span>
      </header>

      {/* Configuration */}
      <section>
        <h3>📋 Configuration</h3>
        <ChatConfigForm config={config} onChange={setConfig} />
        <button onClick={() => onConfigChange(config)}>Apply changes</button>
        <button onClick={() => onAskAI("Edit chat configuration")}>
          Ask AI to edit
        </button>
      </section>

      {/* Message history */}
      <section>
        <h3>💬 Message History ({messages.length} msgs)</h3>
        <MessageList messages={messages} />
      </section>

      {/* Statistics */}
      <section>
        <h3>📊 Statistics</h3>
        <ChatStatistics messages={messages} />
      </section>

      {/* Connections */}
      <section>
        <h3>🔗 Connections</h3>
        <ConnectionsList connections={connections} />
      </section>
    </div>
  );
};
```

---

## 8) Registry & résolution

### 7.1) Enregistrement du type

**Fichier** : `core/holon/library/ui_nodes.py` (nouveau)

```python
from holon.registry import SpecTypeRegistry
from holon.domain.models import NodeSpec, PortSpec

registry = SpecTypeRegistry()

@registry.register_resolver("ui.chat")
def resolve_chat_node(props: dict) -> NodeSpec:
    """Resolve a chat node spec."""
    return NodeSpec(
        id=props.get("id", "spec:chat:default"),
        type="ui.chat",
        label=props.get("label", "Chat"),
        inputs=[
            PortSpec(id="in.message", kind="data", label="Incoming", multi=True),
            PortSpec(id="in.control", kind="control", label="Control", multi=False),
        ],
        outputs=[
            PortSpec(id="out.message", kind="data", label="User message", multi=False),
            PortSpec(id="out.event", kind="control", label="Events", multi=False),
        ],
        props=props,
    )
```

**Import dans `__init__.py`** :

```python
from holon.library import ui_nodes  # Auto-register
```

---

### 7.2) Metadata pour l'UI

**Fichier** : `core/holon/library/ui_nodes_meta.json`

```json
{
  "ui.chat": {
    "label": "Chat",
    "category": "UI",
    "description": "Interactive chat node for user input/output",
    "icon": "💬",
    "defaultProps": {
      "placeholder": "Tapez votre message...",
      "max_history": 50,
      "auto_scroll": true,
      "show_timestamps": true,
      "allow_markdown": true,
      "theme": "default"
    },
    "configSchema": {
      "placeholder": { "type": "string", "label": "Placeholder" },
      "max_history": { "type": "number", "label": "Max history", "min": 1, "max": 500 },
      "auto_scroll": { "type": "boolean", "label": "Auto-scroll" },
      "show_timestamps": { "type": "boolean", "label": "Show timestamps" },
      "allow_markdown": { "type": "boolean", "label": "Allow Markdown" },
      "theme": { "type": "select", "label": "Theme", "options": ["default", "minimal", "compact"] }
    }
  }
}
```

---

## 8) Tests

### 8.1) Unit tests (Python)

**Fichier** : `tests/test_chat_node.py`

```python
from holon.library.ui_nodes import resolve_chat_node
from holon.domain.models import DataEnvelope

def test_chat_node_resolution():
    props = {"id": "spec:chat:test", "placeholder": "Hello"}
    node = resolve_chat_node(props)
    
    assert node.type == "ui.chat"
    assert len(node.inputs) == 2
    assert len(node.outputs) == 2
    assert node.props["placeholder"] == "Hello"

def test_chat_message_envelope():
    envelope = DataEnvelope(
        type="message",
        content="Hello",
        metadata={"role": "user"}
    )
    assert envelope.type == "message"
    assert envelope.content == "Hello"
```

---

### 8.2) Integration tests (UI)

**Fichier** : `ui/src/components/ChatNode.test.tsx`

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatNode } from './ChatNode';

test('renders chat input and sends message', () => {
  const sendMessageMock = jest.fn();
  useChatStore.setState({ sendMessage: sendMessageMock });

  render(<ChatNode nodeId="test" props={{ placeholder: "Type..." }} />);

  const input = screen.getByPlaceholderText('Type...');
  fireEvent.change(input, { target: { value: 'Hello' } });
  fireEvent.keyPress(input, { key: 'Enter' });

  expect(sendMessageMock).toHaveBeenCalledWith('test', 'Hello');
});
```

---

### 8.3) E2E test (Chat → Agent)

**Fichier** : `tests/e2e/test_chat_agent_flow.py`

```python
async def test_chat_agent_loop():
    # Load workflow
    graph = parse_file("examples/chat_agent.holon.py")
    ctx = ExecutionContext(graph=graph)
    
    # Simulate user message
    chat_envelope = DataEnvelope(
        type="message",
        content="Hello agent",
        metadata={"role": "user"}
    )
    ctx.port_registry.set_value("spec:chat:main", "out.message", chat_envelope)
    
    # Execute
    engine = ExecutionEngine()
    await engine.execute_graph(ctx)
    
    # Verify agent received mapped input
    agent_inputs = ctx.port_registry.get_inputs_for_node("spec:agent:assistant")
    assert agent_inputs["in.prompt"]["user"] == "Hello agent"
    
    # Verify chat received agent response
    chat_inputs = ctx.port_registry.get_inputs_for_node("spec:chat:main")
    assert "in.message" in chat_inputs
    assert chat_inputs["in.message"].metadata["role"] == "assistant"
```

---

## 9) Limitations & prochaines étapes

### Limitations Phase 6.2
- **Pas de persistance** : l'historique est perdu au reload de l'extension.
- **Pas de streaming** : les réponses arrivent en bloc (pas de tokens progressifs).
- **Mono-conversation** : un seul thread par node (pas de branches).
- **Pas d'attachments** : texte seulement (pas d'images, fichiers).

### Phase 6.3 (futures extensions)
- [ ] Persistance de l'historique (SQLite ou JSON).
- [ ] Streaming (SSE ou WebSocket).
- [ ] Multi-threads (conversations parallèles).
- [ ] Attachments (upload images/files).
- [ ] Voice input (speech-to-text).
- [ ] Export de l'historique (JSON, Markdown).

---

## 10) Décisions à valider

1. **Nom du type** : `"ui.chat"` vs `"interactive.chat"` vs `"chat"` ?
2. **State persisté** : dans l'UI uniquement ou synced avec backend ?
3. **Streaming** : prioritaire ou phase 6.3 ?
4. **Markdown** : parser dans l'UI (react-markdown) ou backend (Python-Markdown) ?
5. **Inspector panel** : sidebar dédié ou intégré au Properties panel existant ?
6. **Connection Assistant** : modal ou workflow inline (dans le canvas) ?

---

**Prochaines étapes** :
1. Valider cette spec avec l'équipe.
2. Implémenter [`spec-data-transport.md`](spec-data-transport.md) (prérequis).
3. Implémenter le chat node (backend + UI core).
4. Implémenter UI avancée (Inspector, Connection Assistant).
5. Tests E2E avec exemple `chat_agent.holon.py`.

---

**Dépendances** :
- [`spec-data-transport.md`](spec-data-transport.md) (DataEnvelope, @port_map)
- Phase 6.1 (ExecutionEngine opérationnel)
- React Flow custom nodes (déjà en place)
- UI components library (Inspector Panel, Mapping Editor)

---

## Annexe : Syntaxe agentic-friendly (rappel)

Le chat node utilise la même philosophie que `@port_map` :

```python
@node(type="ui.chat", id="spec:chat:main")
class ChatNode:
    """Interactive chat - AI can easily understand and modify this."""
    placeholder: str = "Type message..."
    max_history: int = 50
```

**AI-friendly** car :
- Déclaratif (attributs = configuration)
- Type hints explicites
- Pas de logique cachée
- Modifiable par remplacement simple
- Pattern reconnaissable (`@node` + classe)
