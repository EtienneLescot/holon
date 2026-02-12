# Architecture d'Exécution des Triggers ✅

## Concept

**Un trigger déclenche l'exécution du workflow**

Quand un utilisateur envoie un message au chat (`trigger.chat`), cela déclenche automatiquement :
1. ✅ L'exécution complète du workflow
2. ✅ L'injection du message utilisateur comme donnée de départ
3. ✅ L'exécution de tous les nodes connectés (ex: Agent)
4. ✅ La récupération de la réponse sur le port `response`
5. ✅ L'affichage de la réponse dans le chat
6. ✅ L'historique de conversation est passé au workflow

## Flow Actuel (✅ IMPLÉMENTÉ)

```
User → ChatNode → sendMessage()
  ↓
  DataEnvelope créé + historique récupéré
  ↓
  ui.chat.sendMessage → Extension chatHandler
  ↓
  POST /api/trigger {nodeId, envelope, conversationHistory}
  ↓
  DevServer:
    1. ✅ Valide le graphe (exactement 1 trigger)
    2. ✅ Injecte l'historique dans envelope.metadata
    3. ✅ Crée trigger_data = {nodeId: envelope}
    4. ✅ Execute le workflow avec trigger_data
    5. ✅ Récupère response_data du port "response"
  ↓
  Réponse → chatHandler → UI
  ↓
  chat.store.receiveEnvelope() → Affichage
```

## Implémentation Complète ✅

### 1. Backend: Endpoint `/api/trigger`

**Fichier**: `core/holon/devserver.py`

✅ **Implémenté** :
- Reçoit `{nodeId, envelope, conversationHistory}`
- Valide le graphe (1 trigger)
- Injecte conversationHistory dans envelope.metadata
- Exécute le workflow avec `trigger_data={nodeId: envelope}`
- Récupère `response_data[nodeId]` du port response
- Retourne la réponse au chat UI

### 2. Execution Engine: Injection et Capture de Données

**Fichiers**: 
- `core/holon/execution/engine.py`
- `core/holon/runner.py`

✅ **Implémenté** :
- `ExecutionContext` a `trigger_data` et `response_data`
- `execute_graph()` injecte trigger_data avant l'exécution
- `execute_graph()` capture response_data après l'exécution
- `ExecutionResult` inclut `response_data`
- Toute la chaîne passe `trigger_data` correctement

### 3. Extension: chatHandler

**Fichier**: `extension/src/chatHandler.ts`

✅ **Implémenté** :
- `handleSendMessage()` accepte `conversationHistory`
- Appelle `POST /api/trigger` avec envelope + history
- Transfère la réponse du workflow au chat UI
- Gère les erreurs proprement

### 4. UI: Chat Store

**Fichier**: `ui/src/store/chat.store.ts`

✅ **Implémenté** :
- `sendMessage()` récupère l'historique complet
- Passe `conversationHistory` avec chaque message
- Format: `[{role, content, timestamp}, ...]`

### 5. UI: Port Response Visuel ⭐ NOUVEAU

**Fichier**: `ui/src/App.tsx`

✅ **Implémenté - Rendu Visuel Distinctif** :
- Port response positionné en **bottom-left** (hors du node)
- **Icône de boucle (↺)** au-dessus du port
- **Port agrandi** avec bordure et ombre purple
- **Label avec ↩** et background coloré
- **Tooltip explicatif** : "Loop re-entry point - Receives workflow output to continue conversation"
- Style clairement différent des inputs normaux pour montrer qu'**il n'y a rien avant le trigger**

**Concept Visuel** :
```
  ┌─────────────────────────┐
  │  ▶ TRIGGER: Chat       │
  │  ├─────────────────── ● │ out → démarre workflow
  │  │                      │
  │  │                      │
  │  └─────────────────────│
  ↺                          │ ← Icône boucle
  ●  ↩ Response             │ ← Port ré-entrée (BOTTOM-LEFT)
  └─────────────────────────┘
```

Le port response est visuellement **détaché** et **en bas à gauche** pour :
1. Montrer qu'il n'y a **rien avant** le trigger
2. Identifier clairement le **point de ré-entrée** de la boucle
3. Distinguer visuellement des inputs normaux (qui recevraient des données d'un node précédent)

### 6. Exemple: demo.holon.py

**Fichier**: `core/examples/demo.holon.py`

✅ **Mis à jour** :
- Ajout du nœud `@node(type="trigger.chat")`
- Définit le ChatTrigger comme point de départ
- Workflow complet: Chat → Agent (LLM requis) → Chat response

## Comportement Réel

### Exemple: Chat Loop avec Historique

```python
@node(type="trigger.chat", id="node:trigger:chat:main")
class ChatTrigger:
    title = "AI Assistant"
    
@node(type="langchain.agent", id="node:langchain_agent:assistant")
class LangchainAgent:
    system_prompt = "You are a helpful AI assistant."

@link
# Chat.out → Agent.input
# LLM.output → Agent.llm (required)
# Agent.output → Chat.response (loop!)
```

**Flow d'exécution** :
1. User: "Hello" → `trigger.chat` reçoit le message
2. → `/api/trigger` avec envelope + historique
3. → Engine injecte envelope sur `chat.out`
4. → Agent.input reçoit le message + historique dans metadata
5. → Agent traite avec le LLM → génère "Hi there!"
6. → Agent.output émet "Hi there!"
7. → Engine capture sur `chat.response`
8. → Réponse retournée à `/api/trigger`
9. → chatHandler → UI
10. → User voit "Hi there!"
11. User: "How are you?" → l'historique contient ["Hello", "Hi there!", "How are you?"]

## Données Passées

### Envelope Structure
```json
{
  "type": "message",
  "content": "Hello",
  "contentType": "text/plain",
  "metadata": {
    "role": "user",
    "conversationId": "conv_123",
    "conversation_history": [
      {"role": "user", "content": "Previous message", "timestamp": "..."},
      {"role": "assistant", "content": "Previous response", "timestamp": "..."}
    ]
  },
  "origin": {"nodeId": "node:trigger:chat:main", "port": "out"},
  "timestamp": "2026-02-11T..."
}
```

### Trigger Data Injection
```python
# Dans ExecutionEngine.execute_graph()
if ctx.trigger_data:
    for node_id, data in ctx.trigger_data.items():
        ctx.port_registry.set_output(node_id, "out", data)
```

### Response Data Capture
```python
# Dans ExecutionEngine.execute_graph()
for node_id in ctx.trigger_data.keys():
    response_value = ctx.port_registry.get_input(node_id, "response")
    if response_value:
        ctx.response_data[node_id] = response_value
```

## Statut: COMPLET ✅

Toutes les fonctionnalités ont été implémentées :

- ✅ Endpoint `/api/trigger` avec trigger_data
- ✅ Injection d'envelope dans l'engine
- ✅ Capture de response_data du port response
- ✅ Passage de l'historique de conversation
- ✅ Mise à jour de demo.holon.py
- ✅ Documentation complète

## Tests à Effectuer

1. Démarrer le dev server : `npm run dev:demo`
2. Ouvrir le chat dans l'UI
3. Envoyer "Hello" → vérifier que le workflow s'exécute
4. Vérifier que la réponse de l'agent apparaît
5. Envoyer un second message → vérifier que l'historique est passé
6. Vérifier les logs du devserver pour voir l'injection et la capture

## Logs Attendus

```
[API] Triggering workflow from node 'node:trigger:chat:main' with envelope
[API] Including 3 messages in history
[ENGINE] Injecting trigger data: ['node:trigger:chat:main']
[ENGINE] Injected data for trigger node:trigger:chat:main.out
[ENGINE] Execution order: [...]
[ENGINE] Captured response data from node:trigger:chat:main.response
[API] Found response data from port node:trigger:chat:main.response
```
