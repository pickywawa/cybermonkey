<div align="center">
  <img src="public/cybermonkey.svg" width="88" alt="Logo Cybermonkey">
  <h1>Cybermonkey</h1>
  <p><strong>Vos tests mobiles, preuves à l’appui.</strong></p>
  <p>Espace de travail open source pour créer, enregistrer et rejouer des scénarios Android &amp; iOS — avec l’IA.</p>
  <p><strong>Français</strong> · <a href="README.md">English</a></p>
  <p><a href="https://pickywawa.github.io/cybermonkey/">Site</a> · <a href="https://github.com/pickywawa/cybermonkey/releases/latest">Télécharger</a> · <a href="https://pickywawa.github.io/cybermonkey/fonctionnement.html">Fonctionnement</a> · <a href="https://pickywawa.github.io/cybermonkey/fonctionnalites.html">Fonctionnalités</a> · <a href="https://pickywawa.github.io/cybermonkey/aide.html">Aide</a> · <a href="CHANGELOG.md">Nouveautés</a></p>
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

## Conçu pour durer

Un test mobile échoue pour mille raisons qui ne sont pas des bugs. Cybermonkey est fait pour qu'**un échec veuille dire quelque chose**.

- **Pas riches** : appui, **appui long**, **double appui**, glisser, **défiler jusqu'à ce qu'un composant soit visible**, lancer / relancer / fermer / mettre en arrière-plan l'app, **liens profonds**, **réponse aux dialogues système**, orientation, clavier, **capture d'un texte dans une variable**. Vérifications : visible, absent, texte, contenant, actif, sélectionné, **expression régulière**, **nombre de composants**.
- **Logique de scénario** : **conditions** (« si la bannière cookies est visible, la fermer » ; ignoré, pas échoué, sinon), **appel de sous-scénario** (« Se connecter » écrit une fois), **jeux de données** (un passage par ligne, colonnes = variables), **capture de valeur** réutilisée plus loin.
- **Environnements** : recette, préprod… chacun avec ses variables qui remplacent les variables communes ; un sélecteur change la création, l'exécution et MCP.
- **Imprévus** : popups, toasts, message « session expirée », écran de connexion après une déconnexion, permissions, plantages. Quand un pas échoue : l'app disparue est relancée, les dialogues système sont répondus (jamais un bouton qui supprime, déconnecte ou paie), vos **gestionnaires d'imprévus** (scénarios ordinaires déclenchés par ce qui est à l'écran, enchaînables, capables de se reconnecter puis de **revenir là où le test en était**) s'exécutent, et en dernier recours l'IA ferme une popup inattendue. Tout est tracé dans le rapport.
- **Fiabilité** : **relance ciblée** (un pas réussi seulement au 2e essai est **instable**, pas masqué), protection contre l'appui perdu après un relancement, **historique de stabilité** (« passé 8 fois sur 10 » : régression ou test fragile ?), **audit de durabilité des sélecteurs** avec l'identifiant à demander aux développeurs, **réparations IA** appliquées aux scénarios en un clic.
- **Diagnostic** : **vidéo** des seuls scénarios en échec, **journal de l'appareil** autour de l'échec, **détection de problèmes réseau** (hors ligne, délai, TLS, 5xx, 401/403), **comparaison visuelle** avec la dernière réussite (zones modifiées entourées).
- **Vitesse** : Android et iOS pilotés **en parallèle**, attentes sur condition, **raccourci par lien profond** vers un écran de départ, **profil de durée** par pas (agir vs. relever des preuves).

Détails : [Fonctionnalités](https://pickywawa.github.io/cybermonkey/fonctionnalites.html).

## Serveur MCP

Cybermonkey embarque un **serveur MCP** de **45 outils** (activé par défaut, local, protégé par un jeton, désactivable en entier dans *Réglages → MCP* ; chaque outil se coche/décoche dans son groupe). Une IA appelante peut lister les scénarios, trouver le chemin pour atteindre une étape, déplacer l’application sur un écran, rejouer n’importe quel élément dans n’importe quel ordre, lire des résultats structurés (étape en échec, capture, analyse), explorer et cliquer sur les appareils, et créer puis vérifier de nouveaux scénarios, sur les deux OS à la fois. Voir [docs/mcp.md](docs/mcp.md).

```sh
claude mcp add --transport http cybermonkey http://127.0.0.1:4750/mcp --header "Authorization: Bearer <jeton>"
```

## Télécharger

**[Cybermonkey 1.1.0 pour macOS Apple Silicon](https://github.com/pickywawa/cybermonkey/releases/latest)** : ouvrez le DMG, glissez Cybermonkey dans Applications. Signature locale sans notarisation Apple : au premier lancement, **Réglages Système → Confidentialité et sécurité → Ouvrir quand même**. Windows, Linux et Intel : compilation depuis les sources. Les mises à jour sont proposées dans l’application.

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
