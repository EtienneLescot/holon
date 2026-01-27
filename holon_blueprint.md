Holon - Project Blueprint & Master Context

⚠️ CONTEXTE CRITIQUE POUR L'AGENT IA :
Ce document est la SOURCE DE VÉRITÉ (Single Source of Truth) pour le projet Holon.
Tu ne dois jamais improviser l'architecture. Réfère-toi à ce plan pour chaque fichier généré.
Ta mission : Construire un éditeur de workflow "AI-Native" où le code est roi.

1. Identité & Philosophie

Nom du Projet : Holon.

Structure : MONOREPO. Tout le projet réside dans un seul dépôt Git.

Nom du Package Python : holon

Concept Clé : La "Dualité Récursive".

Chaque nœud est un mini-agent (Code).

Le graphe est un méta-agent (Visuel).

L'utilisateur interagit avec le visuel pour prompter des modifications sur le code.

Mantra : "Code is Truth. Visual is Interface. AI is the Worker."

2. Standards de Code & Architecture (MANDATORY)

Pour garantir que le projet reste maintenable malgré la complexité, tu dois respecter ces règles :

A. Code Style & Qualité

Type Safety (Non-négociable) :

Python : Mypy en mode strict. Utilisation intensive de Pydantic pour tous les modèles de données (AST nodes, Graph schemas).

TypeScript : Strict: true. Interdiction absolue du type any. Utilise des Generics ou unknown avec validation Zod si nécessaire.

Docstrings : Chaque fonction exportée doit avoir une docstring Google-style expliquant Args, Returns et Raises.

Formatting : Ruff (Python) et Prettier (TS).

B. Architecture Modulaire (Structure du Monorepo)

Le projet est un Monorepo composé de 3 dossiers racines distincts :

1. core/ (Python Backend) : Le cerveau.

Contient le package holon.

Gestionnaire : Poetry.

AUCUNE dépendance à VS Code ou React. Utilisable en CLI.

2. extension/ (VS Code Adapteur) : Le pont.

L'extension VS Code pure.

Lance le processus Python et affiche la Webview.

Gestionnaire : npm/yarn.

3. ui/ (React Frontend) : Le visage.

Une application React (Vite) qui compile en fichiers statiques (JS/CSS).

Ces fichiers sont ensuite chargés par extension/.

Gestionnaire : npm/yarn.

C. Code Splitting & Fichiers

Règle des 200 lignes : Si un fichier dépasse 200 lignes, demande-toi s'il ne faut pas extraire une sous-logique.

Atomicité : Un fichier = Une responsabilité claire (ex: parser.py lit, writer.py écrit, transformer.py modifie).

3. Spécifications Techniques

Le DSL Python (Domain Specific Language)

C'est le format de fichier que l'utilisateur manipule.

from holon import node, workflow, Context
from pydantic import BaseModel

class AnalysisResult(BaseModel):
    score: float
    reason: str

@node
async def analyze_sentiment(ctx: Context, text: str) -> AnalysisResult:
    """
    Ce nœud est un agent. L'IA peut modifier ce corps de fonction
    sans casser le reste du graphe.
    """
    # ... logic ...
    return AnalysisResult(score=0.9, reason="Positive")

@workflow
async def main_pipeline():
    # Le parser lit cette fonction pour dessiner les liens
    result = await analyze_sentiment(text="Hello world")
    if result.score > 0.5:
        await notify_slack(result)


Le Moteur de Parsing (Core)

Technologie : LibCST (Concrete Syntax Tree).

Pourquoi ? Contrairement au module ast standard, LibCST préserve les commentaires, les espaces et le style du code original. C'est vital pour un outil qui réécrit le code de l'utilisateur.

4. Roadmap du POC (Plan d'Action Séquentiel)

Ne tente pas de tout faire d'un coup. Suis ces phases.

Phase 1 : Le "Core Parser" (Fondations)

Objectif : Prouver la capacité à lire/écrire du Python sans perte via LibCST.

Livrables :

core/holon/domain/models.py : Les Pydantic models du Graphe (Node, Edge, Position).

core/holon/services/parser.py : Extraction des nœuds depuis un fichier source.

core/tests/test_parser.py : Tests unitaires robustes.

Phase 2 : La "Loop de Modification" (Le Cœur IA)

Objectif : Simuler une modification chirurgicale.

Livrables :

core/holon/services/patcher.py : Une fonction qui prend le nom d'un nœud et un nouveau code (str), et qui met à jour le fichier source proprement.

Script de démo : core/examples/demo_rename_node.py qui renomme un nœud dans le code et vérifie que les appels dans @workflow sont mis à jour (Refactoring via AST).

Phase 3 : L'Extension VS Code (Squelette)

Objectif : Afficher une webview.

Livrables :

extension/package.json : Extension basique activée sur *.holon.py.

Communication RPC basique (Hello World du Python vers le TS).

Phase 4 : L'Intégration React Flow

Objectif : Rendu visuel.

Livrables :

ui/ : App React Flow qui consomme le JSON du Parser.

Binding bidirectionnel (Drag & Drop visuel -> Update coordonnées).