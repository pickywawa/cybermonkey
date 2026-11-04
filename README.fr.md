<div align="center">
  <img src="public/cybermonkey.svg" width="88" alt="Logo Cybermonkey">
  <h1>Cybermonkey</h1>
  <p><strong>Vos tests mobiles, preuves à l’appui.</strong></p>
  <p>Espace de travail open source pour créer, enregistrer et rejouer des scénarios Android &amp; iOS — avec l’IA.</p>
  <p><strong>Français</strong> · <a href="README.md">English</a></p>
  <p><a href="https://pickywawa.github.io/cybermonkey/">Site</a> · <a href="https://github.com/pickywawa/cybermonkey/releases/latest">Télécharger</a> · <a href="https://pickywawa.github.io/cybermonkey/fonctionnement.html">Fonctionnement</a> · <a href="https://pickywawa.github.io/cybermonkey/aide.html">Aide</a> · <a href="CHANGELOG.md">Nouveautés</a></p>
</div>

![Suivi de campagne Cybermonkey](site/assets/screenshots/progression.png)

_Captures avec données de démonstration (application fictive « Atlas Mobile »)._

Cybermonkey succède à Cyberfox, reconstruit sur une architecture plus claire (voir [docs/architecture.md](docs/architecture.md)).

## Ce que vous pouvez faire

- **Créer** : décrire un parcours (Claude Code, Codex ou GitHub Copilot explorent vos appareils, puis une **synthèse** est à valider avant toute écriture) ; **enregistrer en naviguant sur le téléphone** ; **construire à la main** en cliquant les composants du miroir ; **importer des cas de test** (Squash TM, TestRail, Azure Test Plans, Gherkin, CSV, JSON, Markdown) et les faire automatiser par l’IA.
- **Exécuter** : campagnes avec résultats par OS, captures à chaque étape, **réparation automatique des sélecteurs** (jamais sur les vérifications), **analyse structurée** des échecs, préparation de l’écran de départ. Travaillez sur **Android + iOS ou un seul OS à la fois** ; une étape propre à un OS est « non applicable » sur l’autre, un trou n’est jamais un échec.
- **Comprendre** : avancement par OS et par scénario, **cartographie** des écrans prévus et testés avec résultats Android/iOS, exports **texte, CSV, Markdown, Confluence, HTML, JUnit, JSON**.
- **Configurer sans douleur** : diagnostic détaillé de chaque appareil (cause + correctif + commande à copier), diagnostic par l’IA, erreurs expliquées.
- Fenêtres **Appareils** et **IA** détachables, détection automatique des appareils, détection de l’application à tester, mises à jour automatiques, 7 thèmes, français et anglais, variables de projet (créées à la volée par l’IA).

## Télécharger

**[Cybermonkey 1.0.0 pour macOS Apple Silicon](https://github.com/pickywawa/cybermonkey/releases/latest)** : ouvrez le DMG, glissez Cybermonkey dans Applications. Signature locale sans notarisation Apple : au premier lancement, **Réglages Système → Confidentialité et sécurité → Ouvrir quand même**. Windows, Linux et Intel : compilation depuis les sources. Les mises à jour sont proposées dans l’application.

<p align="center"><img src="site/assets/screenshots/synthese.png" width="49%" alt="Synthèse IA"> <img src="site/assets/screenshots/cartographie.png" width="49%" alt="Cartographie"></p>

## Développement

Node.js **22.12+**.

```sh
git clone https://github.com/pickywawa/cybermonkey.git
cd cybermonkey
npm ci
npm run dev        # Vite + tsc en veille + Electron
npm run dev:web    # aperçu navigateur avec données de démonstration
npm run typecheck && npm test
npm run build
```

## Migration depuis Cyberfox

**Fichier → Importer un projet Cyberfox…** : le dossier du projet est repris tel quel (scénarios, campagnes, captures). Les projets « Flutter » deviennent Android + iOS.

MIT · © 2026 pickywawa
