# Cybermonkey (à venir)

**Vue Exécution refaite de zéro** : on voit où en sont les tests, pas l'historique des exécutions.

- **Un élément, un résultat** : l'avancement et la liste comptent les **éléments des scénarios** selon leur **dernier résultat**. Relancer un test remplace son résultat ; un élément n'est jamais compté deux fois. Les exécutions précédentes restent sur disque (stabilité, régressions, comparaison visuelle) mais ne sont plus listées.
- **Barre d'avancement au-dessus des onglets** : % de réussite, réussis / en échec / à tester, et le taux de réussite de **chaque OS du projet** (plus de celui coché dans la barre du haut).
- **Onglets Résultats et Cartographie** (l'onglet Progression, la frise des étapes et le sélecteur d'exécution disparaissent). Les filtres sont des cases à cocher dans une liste déroulante.
- **Résultats** : une ligne par élément, des séparateurs par scénario et de légers séparateurs à chaque changement d'écran ; chaque ligne se déplie avec tout le détail par OS (message, vidéo, journal, comparaison visuelle, analyse IA, réparation de sélecteur, stabilité, durées).
- **Arbre des scénarios relié aux résultats, dans les deux sens** : cliquer un élément affiche son résultat (défilement automatique, surbrillance), cliquer un résultat le sélectionne dans l'arbre ; replier un scénario d'un côté le replie de l'autre. Bouton pour replier d'un coup les scénarios réussis. Les icônes d'OS sont blanches, seul un point de couleur dit si le test a réussi.
- **Cartographie** : la liste des **écrans** avec leur nom, leur statut d'après les tests liés (validé, en échec, partiel, à tester, sans test) et leurs dernières captures, groupés par **module**. Le module est un nouveau champ des scénarios, renseigné par l'IA à la création (et modifiable dans l'éditeur) ; l'IA reçoit les modules existants pour les réutiliser.
- **Campagnes** : barre plus basse (même hauteur que celle des appareils), « Nouvelle campagne » dans le menu, bouton Exporter à droite du titre.
- **Supprimé** : l'import de projets Cyberfox, et la conversion des anciens formats de projet (seul le format actuel est lu). Le profil des pas les plus lents n'est plus un écran : la durée de chaque résultat est dans son détail, et l'outil MCP `slowest_steps` reste.

# Cybermonkey 1.3.0

**Cybermonkey se branche sur votre chaîne de livraison et sur vos outils** : ligne de commande pour la CI/CD, intégrations (Git, messagerie, outils de test, tickets) et appareils distants (réseau, clouds).

**Intégration CI/CD** : lancer des campagnes sans fenêtre, depuis Jenkins, GitHub Actions ou GitLab CI.

- **Ligne de commande** `cybermonkey run` : installe le build (APK, `.app` simulateur, `.ipa` iPhone, avec `--fresh` pour repartir sans données), joue la campagne sur les appareils associés au projet et écrit les rapports (`junit.xml`, `html.html`, `json.json`, ou tout format d'export ; `--artifacts` ajoute captures et vidéos). Options : projet, environnement (`--env`, sans modifier le choix de l'application), OS, appareil, scénario, libellé de campagne, délai. Commandes `devices` et `projects` pour retrouver les identifiants.
- **Codes de sortie pour pipelines** : `0` réussi, `1` test en échec, `2` erreur d'usage ou d'infrastructure (appareil absent, build refusé, erreur du moteur, rien n'a pu s'exécuter : jamais « vert »), `3` délai dépassé ou interruption.
- **Deux façons de la lancer** : avec l'application installée (`Cybermonkey --cli run …`, aucune fenêtre) ou depuis les sources (`npm run cli -- run …`).
- Documentation : [docs/cli.md](docs/cli.md) (principe « la CI déclenche, un poste dédié exécute », exemples Jenkins / GitHub Actions / GitLab, limites), README, pages Fonctionnalités et Aide du site.

**Intégrations** (Réglages → Intégrations) : Git, notifications, outils de test, tickets. Tout est facultatif et désactivé par défaut.

- **Git** : détecte si le dossier des projets est un dépôt, propose de récupérer (au démarrage, périodiquement) et de valider + pousser (après création, modification ou exécution), **toujours avec une fenêtre de confirmation**. Avance rapide uniquement, jamais de fusion ni d'envoi forcé : en cas de conflit, rien n'est touché.
- **Notifications Slack, Teams, e-mail (SMTP)** : régression (un message par exécution), échec de test (désactivé par défaut, plafonné), avancement par paliers (5/10/20/25/50 %, chacun une fois), fin d'exécution ; analyse IA, capture et vidéo en option (captures et vidéos par e-mail seulement).
- **TestRail et Azure Test Plans** : renvoi des résultats pour les scénarios liés à un cas par import (jamais / avec confirmation / automatique). Non éprouvé sur une instance réelle. Squash TM n'est pas pris en charge.
- **Tickets Jira et GitHub** sur régression : un ticket par exécution ou par étape, jamais de doublon tant que le ticket est ouvert, champs Jira supplémentaires en JSON, et rédaction par l'IA à partir de vos instructions (champs personnalisés décrits en texte libre, exemple `curl`) ; Cybermonkey valide la réponse et envoie lui-même la requête.
- **Secrets** stockés à part, chiffrés par le système quand c'est possible (le trousseau n'est sollicité qu'à l'enregistrement ou à la lecture d'un secret, jamais au lancement ni en ligne de commande), et lisibles depuis l'environnement en CI (`CYBERMONKEY_JIRA_TOKEN`…) ; les valeurs des variables de projet sensibles sont masquées dans tous les messages.
- Utilisable en ligne de commande : notifications, résultats et tickets partent à la fin de `cybermonkey run`, qui les attend avant de quitter.
- Documentation : [docs/integrations.md](docs/integrations.md).

**Appareils distants et fermes de devices** (Réglages → Appareils) : tester sans brancher le téléphone à la machine.

- **ADB sur le réseau** : hôtes `hôte:port` reconnectés en arrière-plan (sans ralentir la détection, un essai toutes les 20 s), appairage Android 11+, état par hôte (connecté, injoignable, à autoriser).
- **Clouds d'appareils** : **BrowserStack**, **Sauce Labs** (appareils réels, 3 régions) et **AWS Device Farm** (session d'accès distant + endpoint Appium, appels signés SigV4 sans SDK), et **votre propre serveur Appium** (authentification aucune / basic / bearer). Chaque profil d'appareil devient un appareil du panneau Appareils.
- **Facturation maîtrisée** : la session cloud ne démarre que pendant une exécution, une exploration ou un enregistrement, se termine avec eux, et une session ouverte à la main se ferme après N minutes d'inactivité ; tout est rendu au fournisseur à la fermeture de l'application.
- **Application envoyée au fournisseur** depuis les réglages (références `bs://`, `storage:`, ARN).
- **Ligne de commande** : `--android-device remote:<id>`, `--android-app` envoie le build au fournisseur, `--android-app-ref`, `--adb-host`, et `remote status | test | upload | adb-connect | adb-pair`. Une session cloud qui ne s'ouvre pas est une erreur d'infrastructure (code 2). Clés par variables d'environnement, y compris celles que les fournisseurs utilisent déjà (`BROWSERSTACK_ACCESS_KEY`, `SAUCE_ACCESS_KEY`, `AWS_SECRET_ACCESS_KEY`).
- Non éprouvé sur un compte réel (serveurs simulés ; signature AWS comparée à l'exemple publié par AWS). Pas de tunnel BrowserStack Local / Sauce Connect, pas de catalogue d'appareils.
- Documentation : [docs/remote-devices.md](docs/remote-devices.md).

# Cybermonkey 1.2.0

**Cybermonkey arrive sous Windows** (Windows 10/11, x64) avec un installateur NSIS.

- **Installateur Windows** `Cybermonkey-1.2.0-win-x64.exe` (par utilisateur, dossier modifiable, raccourcis). Non signé : SmartScreen demande « Informations complémentaires → Exécuter quand même ». Construit sur un vrai runner Windows, avec typecheck, 84 tests, test de fumée du paquet (binaires natifs Appium, Claude Code, Codex, Copilot, sharp présents et chargés) et démarrage de l'app vérifié.
- **Android sous Windows** : SDK détecté automatiquement (`%LOCALAPPDATA%\Android\Sdk`, `ANDROID_HOME`), JDK d'Android Studio ou installé (Temurin, Microsoft, Zulu…) détecté, `adb` retrouvé même hors du PATH. Création IA, enregistrement, import, campagnes, imprévus, environnements, MCP, vidéo, journal (logcat) et comparaison visuelle fonctionnent.
- **iOS n'est pas pris en charge sous Windows** : simulateurs, compilation de WebDriverAgent et détection des iPhone exigent macOS et Xcode. Un mode avancé (WDA externe, iOS 18+, tunnel RemoteXPC) reste dans les réglages, ni testé ni garanti.
- Fenêtre : cadre natif Windows (boutons réduire/agrandir/fermer), barre de menus masquée (Alt pour l'afficher). Mises à jour intégrées : ouvrent l'installateur Windows.
- CI sur macOS **et** Windows ; le workflow _Windows installer_ attache l'installateur à chaque release publiée.
- Corrigé : le fichier de verrouillage ne contenait que les binaires natifs de macOS (`npm ci` échouait sous Windows) ; les binaires `win32-x64` sont maintenant déclarés.
- Documentation : README, page Aide (installation et Android sous Windows), page Fonctionnalités (tableau des limites macOS / Windows).

# Cybermonkey 1.1.0

Cette version rend les tests plus **tenaces** (imprévus, relances, historique), plus **expressifs** (nouveaux pas, logique, environnements) et plus **faciles à diagnostiquer** (vidéo, journal, comparaison visuelle).

- **Imprévus** : popups, toasts, message « session expirée », écran de connexion inattendu, dialogue de permission, plantage de l'app. Quand un pas échoue, Cybermonkey regarde d'abord si quelque chose s'est mis en travers : app disparue (relancée), dialogue système (permissions accordées, suivi refusé, jamais un bouton qui supprime/déconnecte/paie), **gestionnaires d'imprévus** (scénarios déclenchés par l'écran affiché, enchaînables, avec reprise « rejouer le pas » ou « revenir à l'écran d'origine » par les navigations connues), puis l'IA en dernier recours (ferme une popup sans effet métier). Tout est tracé dans le rapport et dans MCP (`interruptions_handled`) ; réglage _Imprévus_ ; en création, dialogues système répondus pour l'agent et rejeu qui applique vos gestionnaires.
- **Environnements** (recette, préprod…) : variables propres à chaque environnement qui remplacent les variables communes, sélecteur global dans la barre latérale (création, exécution, essais, MCP `select_environment`), nom de l'environnement dans chaque rapport.
- **Fiabilité** : _relance ciblée_ d'un pas dont le composant est introuvable ou la vérification en échec (2e essai court ; jamais après une saisie, un défilement ou une erreur d'appareil ; réglable) — réussi au 2e essai, il est marqué **instable** au lieu d'être masqué ; _appui perdu_ sur une navigation (app encore en train de démarrer) : le tap n'est répété que si l'écran est inactif et que le composant touché est toujours là, et l'app est attendue stable après un relancement (corrige les échecs « Écran destination non confirmé » de `run_navigation` au premier essai) ; _historique de stabilité_ par pas (passé 8 fois sur 10, régression, instable) dans Progression et via l'outil MCP `flaky_steps`, repris dans chaque échec (`history`) ; _audit des sélecteurs_ (durables / liés au texte / fragiles / par position) : avertissement dans l'éditeur et à la création IA, outil `audit_selectors` avec l'identifiant à demander aux développeurs et comment l'ajouter ; _réparations IA_ : bandeau « N sélecteurs réparés, tout appliquer » et outil `apply_healed_selectors`. Un échec « enfants » n'est plus présenté comme un problème d'appareil.
- **Diagnostic** : _vidéo_ de chaque scénario, gardée seulement s'il échoue (lecture dans Résultats, positionnée avant le pas ; réglage dédié ; indisponible sur un iPhone réel sans ffmpeg, sans effet sur le résultat) ; _journal de l'appareil_ joint au pas échoué (syslog iOS filtré sur le processus de l'app, logcat Android) avec détection de **problèmes réseau** (hors ligne, délai, refus, TLS, 5xx, 401/403), transmis à l'analyse IA et à MCP (`device_log`, `network_hints`) ; _comparaison visuelle_ avec la dernière réussite du même pas (zones modifiées entourées, % de l'écran, bouton dans Résultats et `since_last_pass` dans MCP).
- **Vitesse** : _profil de durée_ (Exécution → Progression : pas les plus lents, part du temps passée en preuves ; chaque pas mesure désormais « action » et « preuves » séparément) et outil MCP `slowest_steps` avec suggestions ; _raccourci par lien profond_ : un écran de départ peut porter un lien (par OS) essayé avant de relancer l'app et de rejouer un parcours, avec repli sûr si le lien n'atterrit pas au bon endroit ; la saisie dans une web view attend le clavier au lieu d'un délai fixe de 350 ms.
- **Logique dans les scénarios** : _conditions_ (« exécuter seulement si… » : non remplie, le pas et ses enfants sont ignorés sans échec), _appel de sous-scénario_ (réutiliser « Se connecter » sans le copier ; un scénario appelé ne peut être supprimé tant qu'il est utilisé, les boucles d'appels sont refusées), _jeux de données_ (un scénario joué une fois par ligne, colonnes = variables, app relancée entre deux lignes) et _capture de valeur_ (lire un texte à l'écran dans `${NOM}`, avec expression régulière facultative, réutilisable dans les pas suivants). Éditeur, arbre (pastilles), création IA (réparation des propositions) et MCP (`add_nodes`, `update_node`, aperçus) les connaissent ; les rapports indiquent la ligne de données ; un pas joué sur plusieurs lignes compte pour son pire résultat.
- **MCP : 45 outils** (13 en exploration, dont 8 nouveaux) : `long_press`, `double_tap`, `scroll_to`, `check`, `open_link`, `answer_alert`, `app_control`, `rotate`.
- **Pas plus riches** (Android + iOS) : appui long, double appui, _défiler jusqu’à ce qu’un composant soit visible_ ; lancer / relancer / fermer / mettre en arrière-plan l’application ; **ouvrir un lien profond** ; répondre à une alerte ou permission système (accepter, refuser, ou libellé du bouton, avec attente) ; orientation ; masquer le clavier. Nouvelles vérifications : sélectionné, expression régulière, nombre de composants (`3`, `>=2`, `<5`). Disponibles dans l’éditeur, dans la création IA et via `update_node` / `add_nodes` du MCP.
- **Serveur MCP intégré** (Réglages → MCP) : activé par défaut, local (127.0.0.1), jeton d’accès, désactivable ; chaque outil activable par groupe. 32 outils : lecture, observation (capture, composants, rapport, chemin), exécution (scénario, campagne, dossier, élément, navigation, annulation), création (création IA, rejeu, insertion, édition), utilitaire et exploration (clic, saisie, retour). Résultats structurés par OS avec explications et pistes de correction. Voir `docs/mcp.md`.

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
