# Architecture de Cybermonkey

Cybermonkey est une application Electron (processus principal Node + interface React) qui pilote des appareils Android et iOS via Appium.
Le code est organisé en **trois zones qui ne se mélangent pas** et un contrat unique entre elles.

```
src/
  shared/        Domaine pur (zod + fonctions) : aucun import Electron/React. Utilisé par les trois zones.
    domain/      scénarios, projet, réglages, appareils, rapports, avancement, cartographie, exports, enregistrement, cas externes
    ai/          protocole IA (décisions, schémas JSON, extraction/validation tolérantes)
    importers/   lecteurs Squash TM / TestRail / Azure / Gherkin / CSV / JSON / Markdown
    ipc.ts       LE contrat : canal → [entrée, sortie], événements live, interface du pont
  main/          Processus principal
    container.ts racine de composition : construit tous les services une fois et les injecte
    app/         fenêtres (principale + Appareils + IA détachables), mises à jour, état des fenêtres
    ipc/         registre typé + un fichier de handlers (un handler par canal du contrat)
    infra/       accès au monde extérieur
      storage/   workspace.json, projets, campagnes, captures (écritures atomiques, file d’attente)
      devices/   détection (adb / simctl / devicectl), moniteur, diagnostics
      appium/    serveur, sessions + baux d’appareil, opérations (tap, saisie, glisser…), ios-config
      ai/        fournisseurs Claude Code / Codex / Copilot derrière une même interface + relances
      updater/   mises à jour GitHub (SHA-256 vérifié)
    engine/      cas d’usage
      creation/  agent d’exploration IA, réparation/validation des propositions, rejeu, préparation
      execution/ exécution des campagnes par appareil, réparation de sélecteurs, analyse d’échecs
      recorder/  enregistrement sur le téléphone (inférence d’actions)
  preload/       pont générique unique (call / onEvent), typé par le contrat
  renderer/      Interface React (Vite)
    app/         shell, store (contexte), splitters, contexte UI
    features/    devices, scenarios, creation, execution, projects, settings : une feature = un dossier
    shared/      kit UI, i18n (fr/en), mock du pont pour l’aperçu navigateur
```

## Ajouter une fonctionnalité
1. Déclarer le canal dans `src/shared/ipc.ts` (`'ma.feature': [Entrée, Sortie]`).
2. Écrire la logique dans `main/engine/…` (pure et testable) ou `main/infra/…` (I/O).
3. Brancher le handler dans `main/ipc/handlers.ts`.
4. Appeler `call('ma.feature', …)` depuis une feature du renderer. Les textes passent par `shared/i18n` (fr + en, parité vérifiée par le typage).

## Modèle de scénario
`Scénario → (action | navigation | test)*`. Chaque étape porte **l’intention** (nom, description) et une **variante par OS** (`variants.android` / `variants.ios`) :
sélecteur, sélecteurs de secours, description du composant (`hint`), opération, valeur, assertion.
`platforms` restreint une étape à un OS : sur l’autre OS elle est *non applicable* (jamais en échec). Une variante absente est un *trou à compléter* (étape ignorée, signalée).
Les navigations décrivent leur **écran de destination** par des repères (communs aux deux OS via un même identifiant) : c’est ce qui alimente la cartographie.

## Création par IA (résilience)
- Protocole en commandes hôte (`inspect`, `perform`, `prepare`, `ready`, `question`, `create_variable`, `finish`) ; schéma plat côté fournisseur, validation par outil côté hôte.
- Réponses invalides tolérées (JSON extrait du texte, nulls normalisés), relance automatique des erreurs transitoires, écran courant joint aux erreurs d’outil, écrans inchangés résumés, budget annoncé à l’IA.
- La proposition est **réparée** déterministiquement (ids frais, variantes non observées retirées avec avertissement, écrans de destination dérivés de la trace) avant d’être validée, puis corrigée par l’IA au besoin (3 tours max).
- Dernier recours : un **brouillon reconstruit depuis les actions réellement exécutées** (jamais rien d’inventé).
- Le rejeu sur appareil et la synthèse (qualité, couverture par OS, avertissements, sélection étape par étape) précèdent toute écriture.

## Exécution par IA
- **Réparation de sélecteur** : si le composant d’une action/navigation a disparu, l’IA propose l’équivalent sur l’écran courant ; jamais sur une vérification. Chaque réparation est tracée et applicable au scénario en un clic.
- **Analyse structurée** des échecs (régression / environnement / sélecteur obsolète) avec preuves et correctif suggéré.
- **Préparation de l’écran de départ** : parcours existants, puis IA en dernier recours.

## Données
Tout est local : `workspace.json` (réglages + index), `<projet>/cybermonkey.project.json`, `<projet>/campaigns/<id>/{campaign.json,reports,captures}`, `<projet>/explorations/*.jsonl` (traces masquant les secrets).
Les variables sont stockées en clair dans le projet : ce n’est pas un coffre-fort.
