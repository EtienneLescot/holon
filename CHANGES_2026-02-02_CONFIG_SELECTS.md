# Amélioration du ConfigPanel - Sélecteurs Provider et Model

## Changements Implémentés

### 1. Service de récupération des modèles (`ui/src/services/models.service.ts`)

Nouveau service qui gère la récupération des modèles disponibles depuis les APIs des providers :

- **Fetch API OpenAI** : Appel à `https://api.openai.com/v1/models` pour récupérer les modèles disponibles
- **Cache localStorage** : Les modèles sont mis en cache pendant 24h pour éviter des appels API répétés
- **Modèles par défaut** : Si l'API n'est pas disponible, des modèles par défaut sont utilisés (gpt-4o, gpt-4-turbo, etc.)
- **Filtrage intelligent** : Seuls les modèles de chat (gpt, o1, o3) sont retournés

### 2. Store Zustand pour les modèles (`ui/src/store/models.store.ts`)

Store centralisé pour gérer l'état des modèles :

- **État** : Liste des modèles par provider, états de chargement, erreurs
- **Actions** :
  - `loadModels(provider, apiKey)` : Charge les modèles depuis l'API ou le cache
  - `getModels(provider)` : Retourne les modèles disponibles (avec fallback sur les défaults)
  - `clearCache(provider)` : Vide le cache pour un provider spécifique
- **Gestion d'erreurs** : Si l'API échoue, utilise les modèles par défaut et affiche un avertissement

### 3. Transformation du ConfigPanel (`ui/src/ConfigPanel.tsx`)

#### Champ Provider
- ✅ Transformé en **SELECT** au lieu d'un champ texte libre
- ✅ Actuellement avec une seule option : `openai`
- ✅ Bouton de configuration des credentials déplacé **à droite du select**
- ✅ Le bouton credentials n'est plus dans la section des badges

#### Champ Model_Name
- ✅ Transformé en **SELECT** au lieu d'un champ texte libre
- ✅ La liste des modèles dépend du provider sélectionné
- ✅ Chargement automatique des modèles quand le provider change
- ✅ Indicateur de chargement pendant la récupération
- ✅ Message d'information si l'API n'est pas disponible (utilise les modèles par défaut)

#### Autres améliorations
- Les autres propriétés restent des champs texte/textarea comme avant
- L'interface est cohérente avec le design existant
- Icône de shield pour le bouton credentials

## Architecture du Cache

### Niveau 1 : localStorage (24h)
Les modèles sont stockés dans le localStorage du navigateur avec la clé `holon_models_{provider}`. Le cache expire après 24 heures.

### Niveau 2 : Store Zustand (session)
Le store Zustand maintient les modèles en mémoire pendant la session. Si les données sont déjà dans le store, aucun appel API n'est fait.

### Niveau 3 : Modèles par défaut
Si l'API échoue (pas de credentials, API down, etc.), le système utilise une liste prédéfinie de modèles communs.

## Flux d'Utilisation

1. L'utilisateur sélectionne un nœud `llm.model` dans le graphe
2. Le ConfigPanel s'ouvre avec les propriétés du nœud
3. Le champ `provider` affiche un select avec "openai"
4. Un effet se déclenche pour charger les modèles du provider
5. Le store vérifie le cache localStorage
6. Si pas de cache ou expiré :
   - Récupère les credentials pour le provider
   - Appelle l'API du provider
   - Met en cache les résultats
7. Le champ `model_name` affiche un select avec les modèles disponibles
8. L'utilisateur peut changer le provider → les modèles se rechargent automatiquement

## Extensibilité

L'architecture est prête pour supporter d'autres providers :

```typescript
// Futur : Ajouter Anthropic
const availableProviders = ['openai', 'anthropic'];

// Dans models.service.ts
case 'anthropic':
  models = await fetchAnthropicModels(apiKey);
  break;
```

## Avantages

✅ **Performance** : Cache intelligent évite les appels API répétés  
✅ **UX** : Sélecteurs au lieu de champs libres = moins d'erreurs  
✅ **Robustesse** : Fallback sur modèles par défaut si API indisponible  
✅ **Évolutif** : Architecture prête pour d'autres providers  
✅ **Coding Agents** : Les agents peuvent accéder à la liste des modèles sans appeler l'API  
✅ **Design cohérent** : Intégration parfaite avec le design existant  

## Tests Recommandés

1. Ouvrir un nœud `llm.model` et vérifier que provider est un select
2. Vérifier que le bouton credentials est à droite du provider
3. Changer le provider et vérifier que les modèles se rechargent
4. Tester avec des credentials valides → devrait charger les modèles réels
5. Tester sans credentials → devrait utiliser les modèles par défaut
6. Vérifier le cache : recharger la page et vérifier qu'il n'y a pas d'appel API
