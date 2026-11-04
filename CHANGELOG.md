# Cybermonkey 1.0.0

Nouvelle base de code issue de Cyberfox.

- Architecture en couches (domaine partagé, processus principal, interface), contrat IPC unique et typé.
- Fournisseur **Claude Code** ajouté (Agent SDK) aux côtés de Codex et GitHub Copilot.
- Création par IA plus résiliente : réponses tolérantes, relances, réparation déterministe des propositions, brouillon depuis la trace, synthèse avec sélection étape par étape.
- Exécution : réparation de sélecteurs par IA (actions/navigations), analyse structurée des échecs, sélecteurs de secours, glisser/attendre.
- Cartographie et avancement par OS et par scénario (écrans prévus vs testés).
- Un OS à la fois ou les deux ; étapes propres à un OS ; plateforme Flutter retirée (Android + iOS).
- Création manuelle depuis le miroir, enregistrement sur le téléphone, import Squash TM / TestRail / Azure / Gherkin / CSV / JSON / Markdown.
- Diagnostic d’appareil enrichi (commandes, documentation, diagnostic IA), erreurs expliquées.
- Exports HTML, JUnit XML et JSON en plus de texte, CSV, Markdown et Confluence.
