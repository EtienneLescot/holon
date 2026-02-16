# Spec — UI Visual Linking & Port Dots (Holon)

**Date**: 2026-02-03  
**Status**: Draft — pour validation  
**Phase**: 6.2 (UX linking)

---

## 1) Contexte & motivation

Aujourd’hui, l’UI permet de créer des liens entre nodes mais :
- Les **ports ne sont pas clairement visibles** sur les nodes.
- Une fois un lien créé, il **n’est pas supprimable visuellement**.
- Une node peut avoir plusieurs entrées, sans **différenciation visuelle** de leurs types.

**Objectifs** :
1. Ajouter un **point de port** (dot) visible pour chaque port, directement sur la node.
2. Ajouter une **poubelle au milieu d’un lien** pour supprimer un lien facilement.
3. Introduire un **concept clair de “port de cheminement de donnée”** (flow) distinct des ports de configuration (LLM, mémoire, tools, etc.).
4. Respecter la philosophie **Code is Truth** : l’UI reflète uniquement ce qui est dans le code.

---

## 2) Décisions de design

### 2.0) Philosophie : Code-First + UI-Assistée

**Principes directeurs** :
- **Code is Truth** : les ports et liens proviennent du `*.holon.py`.
- **UI-Assisted** : l’UI permet d’ajouter/supprimer des liens en générant ou supprimant du code.
- **Pas de state “fantôme”** : l’UI n’invente pas de ports ni de liens non présents dans le code.

---

### 2.1) Points de ports (Port Dots)

Chaque port déclaré dans le code est rendu sur la node sous forme d’un **point cliquable**.

**Distinction majeure :**
- Le **port de cheminement de donnée** (flow/data) est **visuellement séparé** des autres ports.
- Il représente le **cheminement principal du workflow**, donc il doit ressortir immédiatement.

**Placement proposé :**
- **Flow (data)** : dot unique à **gauche** de la node (au centre vertical).
- **Autres ports** (LLM, memory, tools, parser, control) : dots **regroupés en dessous** (zone “config”).
- **Exception — nodes provider** (`llm.model`, `memory.*`, `tool.*`) : dot d’attache **au-dessus** de la node.

Autres règles :
- **Multi-input** (port multi) : dot avec anneau (outline) ou badge visuel.

**Règles** :
- Un port = un dot (affiché même si non connecté).
- Le dot porte un **label au survol** (tooltip) : `port.id` + `port.label` si disponible.
- Le dot est **cliquable** pour initier ou compléter un lien.

---

### 2.2) Couleurs par type de port

Les dots sont colorés selon `PortSpec.kind`.

**Palette proposée** (accessible & contrastée) :

| `kind`    | Rôle visuel     | Couleur (exemple) |
|-----------|------------------|-------------------|
| `data`    | Cheminement data | #4F46E5 (indigo)   |
| `llm`     | Modèle           | #0EA5E9 (sky)      |
| `memory`  | Mémoire          | #F97316 (orange)   |
| `tool`    | Outil            | #10B981 (emerald)  |
| `parser`  | Parseur          | #E11D48 (rose)     |
| `control` | Contrôle         | #94A3B8 (slate)    |
| `null`    | Inconnu          | #A1A1AA (zinc)     |

**Note** : les couleurs sont définies en CSS tokens (thème clair/sombre).

---

### 2.3) Concept de “port de cheminement de donnée” (Flow Port)

Le workflow possède un **cheminement principal de donnée**.
Chaque node peut avoir **1 input “flow” principal**, distinct des ports de configuration.
Ce lien **n’est pas un lien comme les autres** : il incarne la continuité du workflow.

**Interprétation par défaut** :
- `direction = "input"` et `kind = "data"` ⇒ **flow port**.
- Les autres `kind` (`llm`, `memory`, `tool`, `parser`, `control`) ⇒ **ports de configuration**.

**Option d’extension (si nécessaire)** :
- Ajouter un champ optionnel `role` dans `PortSpec` :
  - `role: "flow" | "config"`
- Cela permet d’être explicite tout en restant **code-first**.

### 2.4) Rôle de connexion des types de node (`connectionRole`)

Pour distinguer explicitement les nodes de **cheminement** des nodes **provider**,
le catalogue de types expose un champ optionnel :

```ts
connectionRole: "flow" | "provider"
```

Règles UI associées :
- `flow` (défaut): ports config affichés en bas.
- `provider`: ports d’attache affichés en haut (dot au-dessus de la node).

Ce champ est porté au niveau **type de node** (pas au niveau edge), ce qui permet
d’appliquer la convention visuelle de manière stable et cohérente.

**Affichage UI** :
- Le port **flow** est **isolé à gauche** de la node.
- Les ports **config** sont **regroupés en dessous** (zone “Config”).

---

### 2.5) Suppression d’un lien via une poubelle (Trash on Edge)

Chaque lien dessiné dans l’UI doit afficher une **poubelle au centre**.

**Comportement** :
- Survol du lien → apparition de la poubelle.
- Clic sur la poubelle → demande de confirmation → suppression du lien.
- La suppression **génère une modification de code** (`@link` ou `@port_map`).

**Règle** :
- Un lien UI est **la projection d’un lien “code”**.
- Supprimer un lien UI = supprimer la déclaration dans le code.

---

## 3) Intégration UI (ReactFlow)

### 3.1) Rendering des dots

- Utiliser les `ports` des `CoreNode` comme source.
- Mapper chaque port en `Handle` ReactFlow + un dot stylé.
- Tooltip sur hover avec `label` + `id` + `kind`.

### 3.2) Interaction de liaison

**Flow de base** :
1. Clic sur un dot “output”.
2. Clic sur un dot “input”.
3. L’UI envoie `ui.edgeCreated` à l’extension.
4. L’extension génère `@link` (ou `@port_map` si mapping).

---

### 3.3) Suppression de lien

**Nouveau message RPC suggéré** :

```ts
{
  type: "ui.edgeDeleted",
  edge: { source, target, sourcePort, targetPort }
}
```

**Action côté extension** :
- Supprimer la déclaration `@link` correspondante.
- Si le lien est un mapping (`@port_map`), supprimer la classe `@port_map`.

---

## 4) Source de vérité (Code is Truth)

**Règles incontournables** :
- L’UI **ne stocke pas** les liens comme vérité.
- L’UI reflète uniquement ce qui est **parsé depuis le code**.
- Toute action UI (création/suppression) doit **modifier le code**.

---

## 5) Cas d’usage

### 5.1) Node Agent

- `in.data` (flow principal) → dot violet (data)
- `in.llm` → dot sky
- `in.memory` → dot orange
- `in.tools` → dot emerald

L’utilisateur voit immédiatement :
- Le cheminement principal (data).
- Les dépendances de configuration.

### 5.2) Suppression d’un lien bloquant

- Un lien existe entre `Chat.out.message` et `Agent.in.prompt`.
- L’utilisateur clique la poubelle au centre du lien.
- Le `@link` est supprimé du `*.holon.py`.
- L’UI refresh et le lien disparaît.

---

## 6) Non-goals

- Pas de stockage local des liens côté UI.
- Pas d’édition directe des liens sans passer par le code.
- Pas de re-design complet du système de mapping (déjà couvert dans [spec-data-transport.md](spec-data-transport.md)).

---

## 7) Checklist d’implémentation

- [ ] Rendu des **dots** pour chaque port.
- [ ] Couleurs par `kind` + tokens CSS.
- [ ] Groupement visuel **flow vs config**.
- [ ] Tooltip port (id + label + kind).
- [ ] Poubelle au centre de chaque lien.
- [ ] Nouveau RPC `ui.edgeDeleted` + suppression `@link`/`@port_map`.
- [ ] Conformité Code is Truth.
