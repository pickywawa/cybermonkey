// Generates the static site in /site (FR/EN in one page). Run: node scripts/build-site.mjs
import { writeFileSync, readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const V = pkg.version;
const BASE = 'https://pickywawa.github.io/cybermonkey/';
const REPO = 'https://github.com/pickywawa/cybermonkey';
const DMG = `${REPO}/releases/download/v${V}/Cybermonkey-${V}-mac-arm64.dmg`;
const EXE = `${REPO}/releases/download/v${V}/Cybermonkey-${V}-win-x64.exe`;
const t = (fr, en) => `<span class="fr">${fr}</span><span class="en">${en}</span>`;
const b = t; // inline bilingual HTML
const P = (fr, en) => `<p>${t(fr, en)}</p>`; // standalone paragraph
const shot = (name, alt) =>
  `<figure class="shot"><img src="assets/screenshots/${name}.png" alt="${alt}" loading="lazy" width="2250" height="1410"></figure>`;

const NAV = [
  ['index.html', t('Accueil', 'Home')],
  ['fonctionnement.html', t('Fonctionnement', 'How it works')],
  ['fonctionnalites.html', t('Fonctionnalités', 'Features')],
  ['aide.html', t('Aide', 'Help')],
];
function page({ file, title, desc, body }) {
  const nav =
    NAV.map(
      ([href, label]) =>
        `<a href="${href}"${href === file ? ' aria-current="page"' : ''}>${label}</a>`,
    ).join('') + `<a href="${REPO}" rel="noopener">GitHub ↗</a>`;
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title data-fr="${title.fr}" data-en="${title.en}">${title.fr}</title>
<meta name="description" content="${desc.fr}">
<meta name="theme-color" content="#12131a">
<meta property="og:type" content="website"><meta property="og:title" content="${title.fr}"><meta property="og:description" content="${desc.fr}">
<meta property="og:url" content="${BASE}${file === 'index.html' ? '' : file}"><meta property="og:image" content="${BASE}assets/screenshots/progression.png"><meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${BASE}${file === 'index.html' ? '' : file}">
<link rel="icon" type="image/svg+xml" href="assets/icon.svg"><link rel="stylesheet" href="style.css"><script src="app.js" defer></script>
</head>
<body>
<a class="skip" href="#main">${t('Aller au contenu', 'Skip to content')}</a>
<header class="top"><div class="wrap bar">
<a class="brand" href="index.html"><img src="assets/icon.svg" alt=""><span>cyber<b>monkey</b></span><span class="ver">${V}</span></a>
<nav class="main" aria-label="Navigation">${nav}</nav>
<div class="actions"><button id="lang" class="btn sm" type="button">EN</button><a class="btn primary sm" href="index.html#telecharger">${t('Télécharger', 'Download')}</a><button id="menu" class="btn sm" type="button" aria-label="Menu">☰</button></div>
</div></header>
<main id="main">${body}</main>
<footer><div class="wrap cols">
<div><b>cybermonkey</b> ${V} · MIT · © 2026 pickywawa<br>${t('Successeur de Cyberfox, de la même famille que', 'Successor of Cyberfox, same family as')} <a href="https://pickywawa.github.io/cyberdog/">Cyberdog</a>.</div>
<div><a href="${REPO}">GitHub</a> · <a href="${REPO}/releases">Releases</a> · <a href="${REPO}/issues">${t('Signaler un problème', 'Report an issue')}</a> · <a href="${REPO}/blob/main/CHANGELOG.md">Changelog</a></div>
</div></footer>
</body></html>`;
}

/* ============================== HOME ============================== */
const tabs = [
  [
    'creation',
    t('Créer', 'Create'),
    b(
      'Un scénario partagé : l’intention (nom, description) et une variante par OS. Créez à la main, avec l’IA, en enregistrant ou en important.',
      'One shared scenario: the intent (name, description) and one variant per OS. Create by hand, with AI, by recording or by importing.',
    ),
  ],
  [
    'synthese',
    t('Valider', 'Review'),
    b(
      'L’IA propose, vous décidez : synthèse, couverture par OS, résultat du rejeu et corrections automatiques. Rien n’est enregistré avant votre validation.',
      'The AI proposes, you decide: synthesis, per-OS coverage, replay result and automatic fixes. Nothing is saved before you accept.',
    ),
  ],
  [
    'progression',
    t('Suivre', 'Track'),
    b(
      'Avancement par OS et par scénario, résultats de la dernière tentative, chronologie rejouable avec les captures.',
      'Progress per OS and per scenario, latest-attempt results, a scrubbable timeline with captures.',
    ),
  ],
  [
    'cartographie',
    t('Comprendre', 'Understand'),
    b(
      'Les écrans testés, leurs captures et les résultats Android/iOS, reliés par les transitions observées.',
      'Tested screens, their captures and Android/iOS results, linked by the transitions observed.',
    ),
  ],
  [
    'diagnostic',
    t('Configurer', 'Set up'),
    b(
      'Chaque appareil dit précisément ce qui manque et comment le corriger, avec la commande à copier et un diagnostic par l’IA.',
      'Each device says exactly what is missing and how to fix it, with a command to copy and an AI diagnosis.',
    ),
  ],
];
const home = `
<div class="wrap hero">
<div>
<p class="eyebrow"><i></i>${t('Atelier QA mobile · open source', 'Mobile QA workspace · open source')}</p>
<h1>${t('Vos tests mobiles.<br><em>Les preuves en plus.</em>', 'Your mobile tests.<br><em>With proof built in.</em>')}</h1>
<p class="lead">${t('Créez, enregistrez et rejouez vos scénarios Android et iOS. L’IA explore vos appareils, répare les sélecteurs cassés et analyse les échecs ; chaque étape garde sa capture.', 'Create, record and replay your Android and iOS scenarios. The AI explores your devices, repairs broken selectors and analyses failures; every step keeps its screenshot.')}</p>
<div class="cta"><a class="btn primary big" href="#telecharger">${t('Télécharger pour macOS ou Windows', 'Download for macOS or Windows')}</a><a class="btn big" href="fonctionnement.html">${t('Voir le fonctionnement', 'See how it works')}</a></div>
<div class="badges"><span>Android</span><span>iOS</span><span>Claude Code</span><span>Codex</span><span>Copilot</span><span>Appium</span><span>MIT</span></div>
</div>
${shot('progression', 'Cybermonkey — suivi d’une campagne')}
</div>

<section class="alt"><div class="wrap">
<div class="sec-head"><h2>${t('Un parcours. Deux plateformes. Une preuve à chaque étape.', 'One journey. Two platforms. Evidence at every step.')}</h2><p>${t('Cybermonkey réunit l’arbre de scénarios, les appareils et les résultats dans un seul espace de travail redimensionnable.', 'Cybermonkey brings the scenario tree, devices and results into one resizable workspace.')}</p></div>
<div class="grid g3">
<div class="card"><div class="ico">✦</div><h3>${t('Créer avec l’IA', 'Create with AI')}</h3><p>${t('Décrivez un parcours : l’IA explore vos appareils réels (Claude Code, Codex ou Copilot), puis propose un scénario validé par rejeu. Mode interactif ou automatique, variables créées à la volée.', 'Describe a journey: the AI explores your real devices (Claude Code, Codex or Copilot), then proposes a scenario checked by replay. Interactive or auto mode, variables created on the fly.')}</p></div>
<div class="card"><div class="ico">●</div><h3>${t('Enregistrer sur le téléphone', 'Record on the phone')}</h3><p>${t('Naviguez dans l’application comme un utilisateur : chaque écran stabilisé devient une étape, les appuis ambigus sont tranchés par l’IA.', 'Use the app like a user: every settled screen becomes a step, ambiguous taps are settled by the AI.')}</p></div>
<div class="card"><div class="ico">⇪</div><h3>${t('Importer vos cas de test', 'Import your test cases')}</h3><p>${t('Squash TM, TestRail, Azure Test Plans, Gherkin, CSV, JSON, Markdown : l’IA automatise les cas importés, ou vous les importez en squelettes à relier.', 'Squash TM, TestRail, Azure Test Plans, Gherkin, CSV, JSON, Markdown: the AI automates imported cases, or import them as skeletons to bind.')}</p></div>
<div class="card"><div class="ico">⚡</div><h3>${t('Plus rapide qu’un humain', 'Faster than a human')}</h3><p>${t('Changement d’écran détecté par de petites requêtes, pas d’attente fixe, preuves paramétrables : une vérification se joue en 0,2 s.', 'Screen changes detected with tiny queries, no fixed waits, configurable evidence: a check runs in 0.2 s.')}</p></div>
<div class="card"><div class="ico">⟲</div><h3>${t('Résilient aux changements', 'Resilient to change')}</h3><p>${t('Sélecteurs de secours, réparation par l’IA des actions dont le composant a disparu (jamais des vérifications), analyse structurée des échecs.', 'Fallback selectors, AI repair of actions whose component vanished (never of checks), structured failure analysis.')}</p></div>
<div class="card"><div class="ico">⚡</div><h3>${t('Résiste aux imprévus', 'Survives the unexpected')}</h3><p>${t('Popup, session expirée, plantage, permission système : l’app est relancée, les dialogues répondus, vos gestionnaires reconnaissent l’écran, se reconnectent et reviennent là où le test en était.', 'Popup, expired session, crash, system permission: the app is relaunched, dialogs answered, your handlers recognise the screen, log in again and go back to where the test was.')}</p></div>
<div class="card"><div class="ico">⌘</div><h3>${t('Distingue un bug d’un test fragile', 'Tells a bug from a fragile test')}</h3><p>${t('Relance ciblée, pas « instable », historique « passé 8 fois sur 10 », audit des sélecteurs avec l’identifiant à demander aux développeurs.', 'Targeted retry, “unstable” steps, “passed 8 times out of 10” history, selector audit with the identifier to ask developers for.')}</p></div>
<div class="card"><div class="ico">▶</div><h3>${t('Comprend l’échec', 'Understands the failure')}</h3><p>${t('Vidéo de l’échec, journal de l’appareil, signes de problème réseau et comparaison visuelle avec la dernière réussite.', 'Failure video, device log, network-trouble signs and visual comparison with the last pass.')}</p></div>
<div class="card"><div class="ico">❖</div><h3>${t('Environnements', 'Environments')}</h3><p>${t('Recette, préprod… chaque environnement a ses variables ; un sélecteur change tout le projet : création, exécution et MCP.', 'Staging, pre-prod… each environment has its own variables; one selector switches the whole project: creation, runs and MCP.')}</p></div>
<div class="card"><div class="ico">◐</div><h3>${t('Un OS à la fois, ou les deux', 'One OS at a time, or both')}</h3><p>${t('Un sélecteur Android + iOS / Android / iOS dans la barre du haut. Une étape propre à un OS est « non applicable » ailleurs, jamais en échec.', 'An Android + iOS / Android / iOS switch in the top bar. A step specific to one OS is “not applicable” elsewhere, never failed.')}</p></div>
</div></div></section>

<section id="images"><div class="wrap" data-gallery>
<div class="sec-head"><h2>${t('En images', 'In pictures')}</h2><p>${t('Captures de l’application avec des données de démonstration (application fictive Atlas Mobile).', 'Screenshots of the app with demonstration data (fictional app Atlas Mobile).')}</p></div>
<div class="tabs" role="tablist">${tabs.map(([id, label], i) => `<button role="tab" data-id="${id}" data-src="assets/screenshots/${id}.png" aria-selected="${i === 0}">${label}</button>`).join('')}</div>
${shot('creation', '')}
${tabs.map(([id, , cap], i) => `<p class="caption" data-caption="${id}"${i ? ' hidden' : ''}>${cap}</p>`).join('')}
</div></section>

<section class="alt"><div class="wrap">
<div class="sec-head"><h2>${t('Du premier test au rapport', 'From first test to report')}</h2></div>
<div class="steps">
<div class="step"><div><h3>${t('Branchez, c’est détecté', 'Plug in, it is detected')}</h3><p>${t('Les appareils USB, émulateurs et simulateurs sont détectés et associés automatiquement. L’application à tester se lit sur l’appareil ou se choisit dans la liste des apps installées.', 'USB devices, emulators and simulators are detected and paired automatically. The app under test is read from the device or picked from the installed apps.')}</p></div></div>
<div class="step"><div><h3>${t('Créez un scénario', 'Create a scenario')}</h3><p>${t('Avec l’IA, en enregistrant sur le téléphone, en important des cas, ou à la main en cliquant les composants du miroir.', 'With the AI, by recording on the phone, by importing cases, or by hand by clicking components on the mirror.')}</p></div></div>
<div class="step"><div><h3>${t('Validez la synthèse', 'Review the synthesis')}</h3><p>${t('Cochez les étapes à garder, renommez, lisez les corrections automatiques et le résultat du rejeu sur chaque OS.', 'Tick the steps to keep, rename, read the automatic fixes and the replay result on each OS.')}</p></div></div>
<div class="step"><div><h3>${t('Lancez une campagne', 'Run a campaign')}</h3><p>${t('Android, iOS ou les deux en parallèle. Captures, durée et message de chaque étape ; réparation de sélecteurs et analyse des échecs par l’IA.', 'Android, iOS or both in parallel. Captures, duration and message for each step; AI selector repair and failure analysis.')}</p></div></div>
<div class="step"><div><h3>${t('Partagez le résultat', 'Share the result')}</h3><p>${t('Texte, CSV, Markdown, Confluence, HTML, JUnit XML pour la CI, ou JSON.', 'Text, CSV, Markdown, Confluence, HTML, JUnit XML for CI, or JSON.')}</p></div></div>
</div></div></section>

<section id="telecharger"><div class="wrap"><div class="dl">
<div><h2>${t('Télécharger Cybermonkey', 'Download Cybermonkey')} ${V}</h2><p class="lead">${t('<b>macOS</b> (Apple Silicon) : ouvrez le DMG et glissez Cybermonkey dans Applications. <b>Windows</b> (x64) : lancez l’installateur. Les mises à jour suivantes sont proposées dans l’application.', '<b>macOS</b> (Apple Silicon): open the DMG and drag Cybermonkey into Applications. <b>Windows</b> (x64): run the installer. Later updates are offered inside the app.')}</p>
<p class="caption">${t('<b>macOS</b> : signature locale (ad hoc), sans notarisation Apple : au premier lancement, autorisez l’app dans Réglages Système → Confidentialité et sécurité → « Ouvrir quand même ». <b>Windows</b> : l’installateur n’est pas signé : SmartScreen affiche « Windows a protégé votre ordinateur » → <i>Informations complémentaires</i> → <i>Exécuter quand même</i>.', '<b>macOS</b>: locally signed (ad hoc), not notarized by Apple: on first launch, allow the app in System Settings → Privacy &amp; Security → “Open Anyway”. <b>Windows</b>: the installer is not code-signed: SmartScreen shows “Windows protected your PC” → <i>More info</i> → <i>Run anyway</i>.')}</p>
<p class="caption">${t('<b>Sous Windows, seul Android est piloté</b> : les simulateurs iOS et la compilation de WebDriverAgent exigent un Mac avec Xcode.', '<b>On Windows only Android is driven</b>: iOS simulators and building WebDriverAgent require a Mac with Xcode.')}</p></div>
<div style="display:grid;gap:12px"><a class="btn primary big" href="${DMG}">⬇ Cybermonkey-${V}-mac-arm64.dmg</a><a class="btn primary big" href="${EXE}">⬇ Cybermonkey-${V}-win-x64.exe</a><a class="btn" href="${REPO}/releases/latest">${t('Notes de version et empreintes', 'Release notes and checksums')}</a><a class="btn" href="${REPO}#development">${t('Compiler depuis les sources (Linux, Intel)', 'Build from source (Linux, Intel)')}</a></div>
</div></div></section>

<section class="alt"><div class="narrow">
<div class="sec-head"><h2>FAQ</h2></div>
<details><summary>${t('Faut-il un compte Cybermonkey ?', 'Do I need a Cybermonkey account?')}</summary><p>${t('Non. L’IA utilise votre propre abonnement Claude Code, Codex ou GitHub Copilot, connecté depuis Paramètres → IA.', 'No. The AI uses your own Claude Code, Codex or GitHub Copilot subscription, signed in from Settings → AI.')}</p></details>
<details><summary>${t('Où sont mes données ?', 'Where is my data?')}</summary><p>${t('Sur votre machine : projets, variables, captures et rapports. Seul le contexte utile (écrans, demande) est envoyé au fournisseur d’IA choisi. Les variables ne sont pas un coffre-fort chiffré.', 'On your machine: projects, variables, captures and reports. Only the useful context (screens, request) is sent to the chosen AI provider. Variables are not an encrypted vault.')}</p></details>
<details><summary>${t('Puis-je migrer depuis Cyberfox ?', 'Can I migrate from Cyberfox?')}</summary><p>${t('Oui : Fichier → Importer un projet Cyberfox. Scénarios, campagnes et captures sont repris ; les projets Flutter deviennent Android + iOS.', 'Yes: File → Import a Cyberfox project. Scenarios, campaigns and captures are kept; Flutter projects become Android + iOS.')}</p></details>
<details><summary>${t('Que faire si la page à tester est une vue web ?', 'What if the screen under test is a web view?')}</summary><p>${t('Quand son contenu n’est pas lisible par l’accessibilité, l’IA reçoit la capture avec une grille et désigne les champs par cellule ; la position est stockée en pourcentage de l’écran. Voir « Fonctionnement ».', 'When its content is not readable by accessibility, the AI gets the screenshot with a grid and designates fields by cell; the position is stored as a percentage of the screen. See “How it works”.')}</p></details>
<p style="margin-top:22px"><a class="btn" href="aide.html">${t('Toute l’aide →', 'Full help →')}</a></p>
</div></section>`;

/* ============================== HOW IT WORKS ============================== */
const toc = (items) =>
  `<nav class="toc" aria-label="Sommaire">${items.map(([id, l]) => `<a href="#${id}">${l}</a>`).join('')}</nav>`;
const howToc = [
  ['vue', t('Vue d’ensemble', 'Overview')],
  ['projets', t('Projets et appareils', 'Projects and devices')],
  ['creer', t('Créer un scénario', 'Create a scenario')],
  ['modele', t('Le modèle de scénario', 'The scenario model')],
  ['ia', t('L’IA de création', 'AI creation')],
  ['web', t('Vues web', 'Web views')],
  ['executer', t('Exécuter une campagne', 'Run a campaign')],
  ['comprendre', t('Suivi et cartographie', 'Tracking and map')],
  ['donnees', t('Données et architecture', 'Data and architecture')],
];
const how = `<div class="wrap doc">${toc(howToc)}<article class="prose">
<p class="eyebrow"><i></i>${t('Fonctionnement détaillé', 'How it works in detail')}</p>
<h1>${t('Comment Cybermonkey travaille', 'How Cybermonkey works')}</h1>
<h2 id="vue">${t('Vue d’ensemble', 'Overview')}</h2>
<div class="flow"><span>${t('Projet', 'Project')}</span><i>→</i><span>${t('Création', 'Creation')}</span><i>→</i><span>${t('Synthèse', 'Review')}</span><i>→</i><span>${t('Campagne', 'Campaign')}</span><i>→</i><span>${t('Rapport', 'Report')}</span></div>
${P('Cybermonkey est une application Electron. Le processus principal pilote vos appareils via <b>Appium</b> (UiAutomator2 pour Android, XCUITest et WebDriverAgent pour iOS), l’IA via le SDK du fournisseur choisi, et stocke tout en local. L’interface est organisée en deux onglets : <b>Création</b> (arbre de scénarios, éditeur, panneau IA) et <b>Exécution</b> (campagnes, progression, résultats, cartographie), avec à droite les <b>miroirs des appareils</b>.', 'Cybermonkey is an Electron app. The main process drives your devices through <b>Appium</b> (UiAutomator2 for Android, XCUITest and WebDriverAgent for iOS), the AI through the chosen provider’s SDK, and stores everything locally. The UI has two tabs: <b>Creation</b> (scenario tree, editor, AI panel) and <b>Execution</b> (campaigns, progress, results, map), with <b>device mirrors</b> on the right.')}
${shot('creation', 'Onglet Création')}
<h2 id="projets">${t('Projets et appareils', 'Projects and devices')}</h2>
<ul>
<li>${b('<b>Détection automatique</b> : adb (USB, réseau, émulateurs), simulateurs iOS (simctl) et iPhone physiques (devicectl) sont scrutés en continu ; un appareil USB prêt est associé tout seul.', '<b>Automatic detection</b>: adb (USB, network, emulators), iOS simulators (simctl) and physical iPhones (devicectl) are polled continuously; a ready USB device is paired automatically.')}</li>
<li>${b('<b>Application à tester</b> : « Détecter » lit l’app au premier plan de l’appareil ; « Choisir… » liste les apps installées (nom, identifiant, icône Android). L’app est relancée sans effacer ses données avant exploration et exécution.', '<b>App under test</b>: “Detect” reads the foreground app; “Choose…” lists installed apps (name, id, Android icon). The app is relaunched without clearing its data before exploration and runs.')}</li>
<li>${b('<b>Un OS à la fois</b> : le sélecteur de la barre du haut limite appareils, exécutions et suivi à l’OS choisi ; vous alternez sans rien reconfigurer.', '<b>One OS at a time</b>: the top-bar switch limits devices, runs and tracking to the chosen OS; switch freely without reconfiguring.')}</li>
<li>${b('<b>Fenêtres détachables</b> : Appareils et IA s’ouvrent dans leur propre fenêtre (mémorisée) pour travailler sur plusieurs écrans.', '<b>Detachable windows</b>: Devices and AI open in their own remembered window for multi-screen work.')}</li>
</ul>
${shot('diagnostic', 'Diagnostic d’un appareil')}
<h2 id="creer">${t('Créer un scénario', 'Create a scenario')}</h2>
<div class="grid g2">
<div class="card"><h3>${t('Avec l’IA', 'With AI')}</h3><p>${t('Décrivez le parcours ; l’IA explore, vous validez la synthèse.', 'Describe the journey; the AI explores, you review the synthesis.')}</p></div>
<div class="card"><h3>${t('Enregistrer sur le téléphone', 'Record on the phone')}</h3><p>${t('Le miroir est observé ; chaque changement stabilisé (~1,3 s) devient une étape : saisie dans un champ, appui sur le composant disparu, retour. Les appuis ambigus sont proposés en liste ou tranchés par l’IA (avant/après). Vous relisez avant d’ajouter.', 'The mirror is watched; each settled change (~1.3 s) becomes a step: typing into a field, tapping the component that vanished, going back. Ambiguous taps are offered as a list or settled by the AI (before/after). You review before adding.')}</p></div>
<div class="card"><h3>${t('À la main depuis le miroir', 'By hand from the mirror')}</h3><p>${t('« Explorer les composants » superpose les composants réels ; un clic propose Appuyer, Saisir, Vérifier visible / texte / absent, exécuté sur l’appareil si vous le souhaitez. Le même composant cliqué sur l’autre OS complète la variante.', '“Explore components” overlays the real components; a click offers Tap, Type, Check visible / text / absent, executed on the device if you wish. Clicking the same component on the other OS completes the variant.')}</p></div>
<div class="card"><h3>${t('Importer des cas de test', 'Import test cases')}</h3><p>${t('Fichiers exportés de Squash TM, TestRail, Azure Test Plans, Gherkin, CSV, JSON, Markdown. L’IA transforme chaque cas en scénario (une assertion par résultat attendu) et garde la référence du cas d’origine.', 'Files exported from Squash TM, TestRail, Azure Test Plans, Gherkin, CSV, JSON, Markdown. The AI turns each case into a scenario (one assertion per expected result) and keeps the source case reference.')}</p></div>
</div>
${shot('import', 'Import de cas de test')}
<h2 id="modele">${t('Le modèle de scénario', 'The scenario model')}</h2>
${P('<code>Scénario → (action | navigation | test)*</code>. Chaque étape porte l’<b>intention</b> (nom, description) et une <b>variante par OS</b> : sélecteur principal, sélecteurs de secours, description du composant, opération (appuyer, saisir, effacer, retour, glisser, attendre, vérifier), valeur, assertion (visible, absent, texte exact, texte contenant, actif) et délai.', '<code>Scenario → (action | navigation | test)*</code>. Each step carries the <b>intent</b> (name, description) and a <b>variant per OS</b>: main selector, fallback selectors, component description, operation (tap, type, clear, back, swipe, wait, check), value, assertion (visible, absent, exact text, text containing, enabled) and timeout.')}
<table><tr><th>${t('Notion', 'Concept')}</th><th>${t('Rôle', 'Role')}</th></tr>
<tr><td>${t('Navigation', 'Navigation')}</td><td>${t('Une action qui change d’écran ; elle décrit l’écran de destination par des repères (2-3 composants distinctifs). À l’exécution, on avance dès que les repères sont là.', 'An action that changes screen; it describes the destination with markers (2-3 distinctive components). At run time we move on the instant they appear.')}</td></tr>
<tr><td>${t('Écran de départ', 'Start screen')}</td><td>${t('Facultatif sur un scénario : permet de retrouver l’écran voulu (parcours existants, puis IA en dernier recours).', 'Optional on a scenario: lets the runner get back to the right screen (existing routes, then AI as a last resort).')}</td></tr>
<tr><td>${t('Précondition', 'Precondition')}</td><td>${t('Le test juste au-dessus est revérifié avant l’élément ; s’il échoue, l’élément est ignoré (et ses enfants, selon l’option).', 'The test right above is rechecked before the item; if it fails the item is skipped (and its children, depending on the option).')}</td></tr>
<tr><td>${t('Bloquant', 'Blocking')}</td><td>${t('Un échec bloquant arrête la suite du scénario ; sinon l’exécution continue.', 'A blocking failure stops the rest of the scenario; otherwise the run continues.')}</td></tr>
<tr><td>${t('S’applique à', 'Applies to')}</td><td>${t('Restreint une étape à un OS : « non applicable » ailleurs, jamais en échec. Une variante absente est un trou à compléter, signalé (ignoré), pas un échec.', 'Restricts a step to one OS: “not applicable” elsewhere, never failed. A missing variant is a gap to complete, reported (skipped), not a failure.')}</td></tr>
<tr><td>${t('Variables', 'Variables')}</td><td>${t('<code>${NOM}</code> dans les valeurs et sélecteurs ; le scénario ne stocke que le nom. L’IA peut créer une variable à partir d’un identifiant que vous lui donnez (avec votre accord en mode interactif).', '<code>${NAME}</code> in values and selectors; the scenario only stores the name. The AI can create a variable from a credential you give it (with your approval in interactive mode).')}</td></tr></table>
<h2 id="ia">${t('L’IA de création', 'AI creation')}</h2>
${P('L’IA parle à l’application par de petites <b>commandes hôte</b> : <code>inspect</code>, <code>perform</code>, <code>sequence</code> (plusieurs actions sur un écran en un échange), <code>prepare</code>/<code>ready</code>, <code>question</code>, <code>create_variable</code>, <code>finish</code>. Elle ne voit que les composants réellement observés et ne peut agir que par leur identifiant.', 'The AI talks to the app through small <b>host commands</b>: <code>inspect</code>, <code>perform</code>, <code>sequence</code> (several actions on one screen in one exchange), <code>prepare</code>/<code>ready</code>, <code>question</code>, <code>create_variable</code>, <code>finish</code>. It only sees components actually observed and can only act through their ids.')}
<div class="grid g2">
<div class="card"><h3>${t('Résilience', 'Resilience')}</h3><p>${t('Réponses mal formées tolérées, relances sur erreurs transitoires, erreurs d’outil renvoyées avec l’écran courant, écrans inchangés résumés, budget annoncé. Si l’IA échoue, un brouillon est reconstruit depuis les actions réellement exécutées.', 'Malformed answers tolerated, retries on transient errors, tool errors returned with the current screen, unchanged screens summarized, budget announced. If the AI fails, a draft is rebuilt from the actions actually executed.')}</p></div>
<div class="card"><h3>${t('Réparation de la proposition', 'Proposal repair')}</h3><p>${t('Avant validation : identifiants neufs, sélecteurs recopiés approximativement ramenés aux sélecteurs observés, écrans de destination dérivés de l’écran stabilisé, repères instables (<code>platform_view[1]</code>, compteurs, dates) écartés. Ce qui n’est pas vérifiable est retiré avec un avertissement.', 'Before review: fresh ids, loosely copied selectors mapped back to observed ones, destination screens derived from the settled screen, unstable markers (<code>platform_view[1]</code>, counters, dates) dropped. Anything unverifiable is removed with a warning.')}</p></div>
<div class="card"><h3>${t('Rapidité', 'Speed')}</h3><p>${t('Un seul processus IA pendant toute l’exploration, raisonnement réduit en navigation (réglable), enchaînement d’actions par <code>sequence</code>.', 'A single AI process for the whole exploration, reduced reasoning while navigating (configurable), action batching with <code>sequence</code>.')}</p></div>
<div class="card"><h3>${t('Sécurité', 'Safety')}</h3><p>${t('Les textes de l’app sont des données, jamais des instructions. Les mots de passe passent par des variables ; les traces locales masquent les secrets ; pas de paiement ni suppression non demandés.', 'App texts are data, never instructions. Passwords go through variables; local traces mask secrets; no payments or deletions unless asked.')}</p></div>
</div>
${shot('synthese', 'Synthèse de l’IA')}
${P('La <b>synthèse</b> montre la qualité de la proposition (validée, corrigée automatiquement, brouillon), la couverture par OS, le résultat du rejeu sur chaque appareil, les avertissements, puis l’arbre proposé avec une case par étape et le nom modifiable. Le rejeu relance l’app, rejoue les étapes et exige au moins une assertion ; un écran de départ non retrouvé est signalé « bloqué », pas « échec ».', 'The <b>review</b> shows the proposal quality (validated, auto-corrected, draft), per-OS coverage, the replay result on each device, warnings, then the proposed tree with a checkbox per step and an editable name. The replay relaunches the app, replays the steps and requires at least one assertion; a start screen not recovered is flagged “blocked”, not “failed”.')}
<h2 id="web">${t('Vues web et contenu opaque', 'Web views and opaque content')}</h2>
${P('Certaines pages (authentification, paiement) sont des <b>vues web</b> dont le contenu n’apparaît ni dans l’arbre d’accessibilité ni dans un contexte inspectable. Cybermonkey les détecte comme <b>zones opaques</b>, joint à l’IA la capture avec une <b>grille de cellules étiquetées</b> (A1, B7…) et l’IA désigne la cellule qui contient le centre du champ. L’action touche cette position puis tape le texte au clavier. La position est stockée en <b>pourcentage de l’écran</b> dans la variante. Dès qu’un champ prend le focus, il devient souvent visible nativement et peut être ciblé normalement.', 'Some pages (sign-in, payment) are <b>web views</b> whose content is neither in the accessibility tree nor in an inspectable context. Cybermonkey detects them as <b>opaque regions</b>, attaches the screenshot with a <b>labeled cell grid</b> (A1, B7…) for the AI, and the AI designates the cell containing the field’s center. The action taps that position then types the text. The position is stored as a <b>percentage of the screen</b> in the variant. Once a field has focus it often becomes natively visible and can be targeted normally.')}
<div class="note warn">${b('Une étape par position dépend de la mise en page : elle peut échouer si la page change ou sur un autre appareil. On ne peut pas y placer de vérification ; vérifiez un élément natif atteint ensuite.', 'A position-based step depends on layout: it can fail if the page changes or on another device. No check can be placed inside; verify a native element reached afterwards.')}</div>
<h2 id="executer">${t('Exécuter une campagne', 'Run a campaign')}</h2>
${P('Une <b>campagne</b> regroupe des exécutions, leurs captures et leur rapport. Lancez tout, un scénario ou une seule étape (▶ dans l’arbre). Les appareils d’un OS exécutent en parallèle ; la campagne se termine et se rouvre.', 'A <b>campaign</b> groups runs, their captures and their report. Run everything, one scenario or a single step (▶ in the tree). Devices of each OS run in parallel; the campaign can be finished and reopened.')}
<ul>
<li>${b('<b>Rapidité</b> : l’arrivée sur un écran est détectée par de petites requêtes sur ses repères (vérifiées dès l’action, puis toutes les ~80 ms), sans attente fixe ni téléchargement de la structure complète de l’écran. Mesuré : une vérification en 0,17 s avec preuves « échecs » ; un scénario de 5 étapes en ~8 s dont le redémarrage de l’app.', '<b>Speed</b>: arrival on a screen is detected with small queries on its markers (checked right after the action, then every ~80 ms), with no fixed wait and no full page-source download. Measured: a check in 0.17 s with “failures” evidence; a 5-step scenario in ~8 s including the app restart.')}</li>
<li>${b('<b>Preuves</b> (réglage) : toutes les étapes, écrans/vérifications/échecs (défaut) ou échecs seulement. Un échec garde toujours sa capture.', '<b>Evidence</b> (setting): every step, screens/checks/failures (default) or failures only. A failure always keeps its capture.')}</li>
<li>${b('<b>Réparation de sélecteur</b> : si le composant d’une action ou navigation a disparu, l’IA cherche son équivalent sur l’écran courant (même rôle et sens) et rejoue. Jamais pour une vérification : cela masquerait une régression. Chaque réparation est tracée et applicable au scénario en un clic.', '<b>Selector repair</b>: if an action’s or navigation’s component vanished, the AI looks for its equivalent on the current screen (same role and meaning) and retries. Never for a check: that would hide a regression. Every repair is traced and can be applied to the scenario in one click.')}</li>
<li>${b('<b>Analyse des échecs</b> : verdict (régression, environnement, sélecteur obsolète, indéterminé), preuves et correction suggérée.', '<b>Failure analysis</b>: verdict (regression, environment, obsolete selector, unknown), evidence and suggested fix.')}</li>
<li>${b('<b>Préparation</b> : avant un scénario, retrouve son écran de départ via les parcours connus, puis l’IA en dernier recours (désactivable).', '<b>Preparation</b>: before a scenario, gets back to its start screen through known routes, then the AI as a last resort (can be disabled).')}</li>
</ul>
<h2 id="comprendre">${t('Suivi et cartographie', 'Tracking and map')}</h2>
${shot('resultats', 'Résultats détaillés')}
${P('<b>Progression</b> : pour chaque OS et chaque scénario, le dernier résultat de chaque étape (une relance ne gonfle jamais l’avancement). <b>Résultats</b> : table filtrable (échecs, réparés par l’IA…), détail, capture dans le miroir. <b>Chronologie</b> : une frise cliquable ou lue automatiquement, pendant que les tests continuent. <b>Cartographie</b> : un graphe des écrans prévus (depuis vos navigations) et observés, avec miniature, résultats Android/iOS et statut (validé, en échec, partiel, à tester).', '<b>Progress</b>: for each OS and scenario, the latest result of each step (a retry never inflates progress). <b>Results</b>: filterable table (failures, AI-repaired…), detail, capture in the mirror. <b>Timeline</b>: a clickable strip, or autoplay, while tests keep running. <b>Map</b>: a graph of planned (from your navigations) and observed screens with thumbnail, Android/iOS results and status (validated, failing, partial, to test).')}
${shot('cartographie', 'Cartographie des écrans')}
<table><tr><th>${t('Format', 'Format')}</th><th>${t('Usage', 'Use')}</th></tr>
<tr><td>${t('Texte, Markdown, Confluence', 'Text, Markdown, Confluence')}</td><td>${t('Coller dans une page de rapport (sans images).', 'Paste in a report page (no images).')}</td></tr>
<tr><td>CSV, JSON</td><td>${t('Tableurs, scripts.', 'Spreadsheets, scripts.')}</td></tr><tr><td>HTML</td><td>${t('Rapport autonome à partager.', 'Self-contained report to share.')}</td></tr><tr><td>JUnit XML</td><td>${t('Intégration CI (une suite par OS).', 'CI integration (one suite per OS).')}</td></tr></table>
<h2 id="donnees">${t('Données et architecture', 'Data and architecture')}</h2>
${P('Tout est local : <code>workspace.json</code> (réglages et index), <code>&lt;projet&gt;/cybermonkey.project.json</code>, <code>&lt;projet&gt;/campaigns/&lt;id&gt;/{reports,captures}</code>, <code>&lt;projet&gt;/explorations/*.jsonl</code> (traces des explorations, secrets masqués) et un journal <code>logs/cybermonkey.log</code>. Le code est organisé en trois zones : <code>src/shared</code> (domaine pur et contrat IPC), <code>src/main</code> (infrastructure et moteurs) et <code>src/renderer</code> (une feature par dossier). Voir <a href="' + REPO + '/blob/main/docs/architecture.md">docs/architecture.md</a>.', 'Everything is local: <code>workspace.json</code> (settings and index), <code>&lt;project&gt;/cybermonkey.project.json</code>, <code>&lt;project&gt;/campaigns/&lt;id&gt;/{reports,captures}</code>, <code>&lt;project&gt;/explorations/*.jsonl</code> (exploration traces, secrets masked) and a <code>logs/cybermonkey.log</code> log. The code has three zones: <code>src/shared</code> (pure domain and IPC contract), <code>src/main</code> (infrastructure and engines) and <code>src/renderer</code> (one feature per folder). See <a href="' + REPO + '/blob/main/docs/architecture.md">docs/architecture.md</a>.')}
</article></div>`;

/* ============================== HELP ============================== */
const helpToc = [
  ['demarrer', t('Démarrage rapide', 'Quick start')],
  ['install', t('Installation', 'Installation')],
  ['android', 'Android'],
  ['ios', 'iOS'],
  ['ia', t('Configurer l’IA', 'Set up the AI')],
  ['reglages', t('Réglages utiles', 'Useful settings')],
  ['mcp', 'MCP'],
  ['depannage', t('Dépannage', 'Troubleshooting')],
  ['contact', t('Contact', 'Contact')],
];
const help = `<div class="wrap doc">${toc(helpToc)}<article class="prose">
<p class="eyebrow"><i></i>${t('Aide', 'Help')}</p><h1>${t('Aide et dépannage', 'Help and troubleshooting')}</h1>
<h2 id="demarrer">${t('Démarrage rapide', 'Quick start')}</h2>
<ol>
<li>${b('Installez l’application (ci-dessous) et lancez-la. Dans <b>Paramètres → IA</b>, connectez Claude Code, Codex ou Copilot.', 'Install the app (below) and launch it. In <b>Settings → AI</b>, sign in to Claude Code, Codex or Copilot.')}</li>
<li>${b('<b>Fichier → Nouveau projet</b> : nom, plateformes, puis « Détecter » l’application sur un appareil branché.', '<b>File → New project</b>: name, platforms, then “Detect” the app on a plugged-in device.')}</li>
<li>${b('Onglet <b>Création</b> : décrivez un parcours dans le panneau IA, ou cliquez « Enregistrer » et naviguez sur le téléphone.', '<b>Creation</b> tab: describe a journey in the AI panel, or click “Record” and use the phone.')}</li>
<li>${b('Validez la synthèse, puis onglet <b>Exécution</b> → « Nouvelle » campagne → « Tout exécuter ».', 'Accept the review, then <b>Execution</b> tab → “New” campaign → “Run all”.')}</li>
</ol>
<h2 id="install">${t('Installation', 'Installation')}</h2>
${P('<b>macOS (Apple Silicon)</b> : téléchargez le DMG depuis la <a href="' + REPO + '/releases/latest">dernière release</a>, glissez Cybermonkey dans Applications. L’app est signée localement sans notarisation : au premier lancement, ouvrez <i>Réglages Système → Confidentialité et sécurité</i> et choisissez « Ouvrir quand même ». <b>Windows (x64)</b> : téléchargez <code>Cybermonkey-&lt;version&gt;-win-x64.exe</code> depuis la même page et lancez-le (installation pour l’utilisateur courant, dossier modifiable). L’installateur n’est pas signé : SmartScreen demande <i>Informations complémentaires → Exécuter quand même</i>. <b>Autres systèmes</b> : compilez depuis les sources.', '<b>macOS (Apple Silicon)</b>: download the DMG from the <a href="' + REPO + '/releases/latest">latest release</a>, drag Cybermonkey into Applications. The app is locally signed without notarization: on first launch open <i>System Settings → Privacy &amp; Security</i> and choose “Open Anyway”. <b>Windows (x64)</b>: download <code>Cybermonkey-&lt;version&gt;-win-x64.exe</code> from the same page and run it (per-user install, changeable folder). The installer is not code-signed: SmartScreen asks for <i>More info → Run anyway</i>. <b>Windows (x64)</b>: download <code>Cybermonkey-&lt;version&gt;-win-x64.exe</code> from the same page and run it (per-user install, changeable folder). The installer is not code-signed: SmartScreen asks for <i>More info → Run anyway</i>. <b>Other systems</b>: build from source.')}
<pre><code>git clone ${REPO}.git
cd cybermonkey
npm ci
npm run dev        # ${t('développement', 'development')}
npm run dist -- --mac dmg --arm64   # ${t('installateur macOS', 'macOS installer')}</code></pre>
<p>${t('Node.js 22.12 ou plus est requis.', 'Node.js 22.12 or later is required.')}</p>
<h2 id="android">Android</h2>
<ul><li>${b('Installez les <b>Android Platform Tools</b> (<code>adb</code>) et un <b>JDK</b> : <code>brew install --cask android-platform-tools temurin</code> (macOS), <code>winget install Google.PlatformTools EclipseAdoptium.Temurin.21.JDK</code> (Windows). Android Studio convient aussi : son SDK (<code>%LOCALAPPDATA%\\Android\\Sdk</code>) et son JDK intégré sont détectés automatiquement.', 'Install <b>Android Platform Tools</b> (<code>adb</code>) and a <b>JDK</b>: <code>brew install --cask android-platform-tools temurin</code> (macOS), <code>winget install Google.PlatformTools EclipseAdoptium.Temurin.21.JDK</code> (Windows). Android Studio works too: its SDK (<code>%LOCALAPPDATA%\\Android\\Sdk</code>) and bundled JDK are detected automatically.')}</li>
<li>${b('Activez les <b>options pour les développeurs</b> et le <b>débogage USB</b> sur le téléphone, branchez-le et acceptez l’autorisation RSA.', 'Enable <b>Developer options</b> and <b>USB debugging</b> on the phone, plug it in and accept the RSA prompt.')}</li>
<li>${b('Les émulateurs démarrés sont détectés aussi. Vérifiez avec <code>adb devices</code>.', 'Running emulators are detected too. Check with <code>adb devices</code>.')}</li></ul>
<h2 id="ios">iOS</h2>
<ul><li>${b('<b>Simulateurs</b> : installez Xcode et ses runtimes, démarrez un simulateur ; aucune signature n’est nécessaire.', '<b>Simulators</b>: install Xcode and its runtimes, boot a simulator; no signing needed.')}</li>
<li>${b('<b>iPhone physique</b> : activez le <b>mode développeur</b>, faites confiance à l’ordinateur, laissez Xcode préparer l’appareil, puis renseignez dans <i>Paramètres → Appareils</i> le <b>Team ID</b> Apple et un <b>Bundle ID</b> WebDriverAgent couvert par votre profil Development (base + <code>.xctrunner</code>). Ajoutez votre compte Apple dans Xcode.', '<b>Physical iPhone</b>: enable <b>Developer Mode</b>, trust the computer, let Xcode prepare the device, then set in <i>Settings → Devices</i> the Apple <b>Team ID</b> and a WebDriverAgent <b>Bundle ID</b> covered by your Development profile (base + <code>.xctrunner</code>). Add your Apple account in Xcode.')}</li>
<li>${b('<b>Windows / Linux : iOS n’est pas pris en charge.</b> Les simulateurs et la compilation de WebDriverAgent exigent macOS et Xcode. Un mode avancé existe pour un iPhone (iOS 18+) avec un WDA préinstallé ou externe et un tunnel RemoteXPC (voir la documentation Appium XCUITest) ; il n’est <b>ni testé ni garanti</b> par Cybermonkey.', '<b>Windows / Linux: iOS is not supported.</b> Simulators and building WebDriverAgent require macOS and Xcode. An advanced mode exists for an iPhone (iOS 18+) with a preinstalled or external WDA and a RemoteXPC tunnel (see the Appium XCUITest docs); it is <b>neither tested nor guaranteed</b> by Cybermonkey.')}</li></ul>
${shot('parametres-execution', 'Paramètres')}
<h2 id="ia">${t('Configurer l’IA', 'Set up the AI')}</h2>
<table><tr><th>${t('Fournisseur', 'Provider')}</th><th>${t('Connexion', 'Sign-in')}</th></tr>
<tr><td>Claude Code</td><td>${t('Paramètres → IA → « Se connecter » (navigateur), ou variable <code>ANTHROPIC_API_KEY</code> avant le lancement. Le binaire est embarqué.', 'Settings → AI → “Sign in” (browser), or <code>ANTHROPIC_API_KEY</code> before launch. The binary is bundled.')}</td></tr>
<tr><td>Codex</td><td>${t('« Se connecter » : code appareil affiché dans l’app.', '“Sign in”: device code shown in the app.')}</td></tr>
<tr><td>GitHub Copilot</td><td>${t('« Se connecter » : saisissez le code sur github.com/login/device.', '“Sign in”: enter the code at github.com/login/device.')}</td></tr></table>
${shot('parametres-ia', 'Paramètres IA')}
<h2 id="reglages">${t('Réglages utiles', 'Useful settings')}</h2>
<table><tr><th>${t('Réglage', 'Setting')}</th><th>${t('Effet', 'Effect')}</th></tr>
<tr><td>${t('Mode d’exploration', 'Exploration mode')}</td><td>${t('Interactif : l’IA peut poser des questions. Auto : aucune question, la proposition reste à valider.', 'Interactive: the AI may ask questions. Auto: no questions, the proposal still needs review.')}</td></tr>
<tr><td>${t('Exploration rapide', 'Fast exploration')}</td><td>${t('Raisonnement réduit pendant la navigation. À désactiver si les propositions manquent de finesse.', 'Reduced reasoning while navigating. Turn off if proposals lack finesse.')}</td></tr>
<tr><td>${t('Preuves conservées par étape', 'Evidence per step')}</td><td>${t('Moins de captures = exécutions plus rapides.', 'Fewer captures = faster runs.')}</td></tr>
<tr><td>${t('Réparation automatique des sélecteurs', 'Automatic selector repair')}</td><td>${t('Actions et navigations uniquement.', 'Actions and navigations only.')}</td></tr>
<tr><td>${t('Préparation de l’écran de départ', 'Start-screen preparation')}</td><td>${t('Désactivée, parcours existants, ou IA en dernier recours.', 'Off, existing routes, or AI as a last resort.')}</td></tr>
<tr><td>${t('Imprévus', 'Interruptions')}</td><td>${t('Complet (gestionnaires, dialogues système, IA en dernier recours), gestionnaires et app disparue seulement, ou désactivé.', 'Full (handlers, system dialogs, AI as a last resort), handlers and vanished app only, or off.')}</td></tr>
<tr><td>${t('Rejouer un pas en échec', 'Retry a failed step')}</td><td>${t('Un second essai court quand le composant est introuvable ou la vérification échoue ; réussi au 2e essai = « instable ».', 'A short second attempt when the component is not found or the check fails; passed on the 2nd attempt = “unstable”.')}</td></tr>
<tr><td>${t('Vidéo des scénarios en échec', 'Video of failing scenarios')}</td><td>${t('Gardée seulement si le scénario échoue ; désactivable.', 'Kept only if the scenario fails; can be turned off.')}</td></tr>
<tr><td>${t('Environnement', 'Environment')}</td><td>${t('Sélecteur dans la barre latérale ; variables par environnement dans « Variables ».', 'Selector in the sidebar; per-environment variables in “Variables”.')}</td></tr></table>
<h2 id="mcp">MCP</h2>
${P('Cybermonkey embarque un serveur MCP, activé par défaut et local (127.0.0.1) : une IA externe (Claude Code, Cursor…) peut lire vos scénarios, trouver le chemin vers une étape, piloter les téléphones, rejouer des éléments, créer et vérifier des scénarios. Réglages → MCP : activation, port, jeton, et chaque outil à cocher/décocher par groupe.', 'Cybermonkey embeds an MCP server, on by default and local (127.0.0.1): an external AI (Claude Code, Cursor…) can read your scenarios, find the path to a step, drive the phones, replay items, and create and verify scenarios. Settings → MCP: on/off, port, token, and every tool toggleable within its group.')}
<pre><code>claude mcp add --transport http cybermonkey http://127.0.0.1:4750/mcp --header "Authorization: Bearer &lt;token&gt;"</code></pre>
<h2 id="depannage">${t('Dépannage', 'Troubleshooting')}</h2>
<details><summary>${t('Mon appareil n’apparaît pas', 'My device does not show up')}</summary><p>${b('Menu « ⋯ » de la carte de l’appareil → <b>Diagnostic</b> : chaque ligne rouge donne la cause et le correctif. Android : <code>adb devices</code> doit afficher « device » (pas « unauthorized »). iOS : mode développeur, confiance, Xcode ouvert une fois.', 'Device card “⋯” menu → <b>Diagnostics</b>: each red row gives the cause and the fix. Android: <code>adb devices</code> must show “device” (not “unauthorized”). iOS: Developer Mode, trust, Xcode opened once.')}</p></details>
<details><summary>${t('« Exploration en cours… » ne progresse pas', '“Exploring…” does not progress')}</summary><p>${b('Le message affiche l’étape en cours. Si la connexion à l’appareil dépasse 3 minutes, une erreur indique de rouvrir son diagnostic. Consultez <code>~/Library/Application Support/Cybermonkey/logs/cybermonkey.log</code>. Un reste d’agent iOS d’une session précédente est nettoyé automatiquement au lancement.', 'The message shows the current step. If connecting to the device exceeds 3 minutes an error asks you to open its diagnostics. Check <code>~/Library/Application Support/Cybermonkey/logs/cybermonkey.log</code>. A leftover iOS agent from a previous session is cleaned up on launch.')}</p></details>
<details><summary>${t('Le rejeu est « bloqué »', 'The replay is “blocked”')}</summary><p>${b('L’app redémarre sur un autre écran que celui où l’exploration a commencé. Explorez depuis l’écran de lancement, ou activez la préparation de l’écran de départ.', 'The app restarts on a different screen than where the exploration started. Explore from the launch screen, or enable start-screen preparation.')}</p></details>
<details><summary>${t('« Écran destination non confirmé »', '“Destination screen not confirmed”')}</summary><p>${b('Les repères de l’écran cible ne sont pas tous présents. Ouvrez la navigation → « Écran de destination » : gardez des repères stables (titre, composant propre à l’écran), retirez ceux qui changent (compteurs, dates, <code>platform_view[n]</code>).', 'Not all of the target screen’s markers are present. Open the navigation → “Destination screen”: keep stable markers (title, a component specific to the screen), remove those that change (counters, dates, <code>platform_view[n]</code>).')}</p></details>
<details><summary>${t('Une étape est « ignorée : à compléter »', 'A step is “skipped: to complete”')}</summary><p>${b('Elle n’a pas de variante pour cet OS. Cliquez « Compléter avec l’IA » dans l’éditeur, ou associez un composant du miroir. Si l’étape n’existe que sur un OS, décochez l’autre dans « S’applique à ».', 'It has no variant for this OS. Click “Complete with AI” in the editor, or bind a component from the mirror. If the step exists on one OS only, untick the other under “Applies to”.')}</p></details>
<details><summary>${t('iOS : « Connexion iOS impossible » / signature', 'iOS: “iOS connection impossible” / signing')}</summary><p>${b('Vérifiez Team ID, Bundle ID WDA et compte Apple dans Xcode (<i>Diagnostic → Signature WDA</i>). Pour un simulateur, aucune signature n’est requise.', 'Check Team ID, WDA Bundle ID and your Apple account in Xcode (<i>Diagnostics → WDA signing</i>). A simulator needs no signing.')}</p></details>
<details><summary>${t('Où se trouvent mes projets ?', 'Where are my projects?')}</summary><p>${b('Dans le dossier choisi dans Paramètres → Général (par défaut <code>~/Documents/Cybermonkey/Projects</code>). « Afficher le dossier » dans le menu du projet l’ouvre.', 'In the folder set in Settings → General (default <code>~/Documents/Cybermonkey/Projects</code>). “Show folder” in the project menu opens it.')}</p></details>
<details><summary>${t('Comment mettre à jour ?', 'How do I update?')}</summary><p>${b('L’application vérifie les releases stables au démarrage et toutes les 4 heures ; Paramètres → Mises à jour permet de vérifier, télécharger (empreinte SHA-256 contrôlée) et installer.', 'The app checks stable releases at startup and every 4 hours; Settings → Updates lets you check, download (SHA-256 verified) and install.')}</p></details>
<details><summary>${t('Une popup bloque mon test', 'A popup blocks my test')}</summary><p>${b('Créez un <b>gestionnaire d’imprévu</b> : un scénario dont vous cochez « Gestionnaire d’imprévu », avec les repères de la popup et les pas pour la fermer. Il se déclenche seul quand un pas échoue alors que la popup est affichée, puis le pas est rejoué. Voir <a href="fonctionnalites.html#imprevus">Fonctionnalités → Imprévus</a>.', 'Create an <b>interruption handler</b>: a scenario where you tick “Interruption handler”, with the popup’s markers and the steps to close it. It runs by itself when a step fails while the popup is showing, then the step is replayed. See <a href="fonctionnalites.html#imprevus">Features → Interruptions</a>.')}</p></details>
<details><summary>${t('Un pas est marqué « instable »', 'A step is marked “unstable”')}</summary><p>${b('Il n’a réussi qu’au deuxième essai : il fonctionne, mais pas de façon fiable (rendu lent, animation, texte qui change, sélecteur fragile). Le tableau Progression → Stabilité montre son historique ; l’outil MCP <code>audit_selectors</code> repère les sélecteurs fragiles.', 'It only passed on the second attempt: it works, but not reliably (slow render, animation, changing text, fragile selector). Progress → Stability shows its history; the MCP tool <code>audit_selectors</code> spots fragile selectors.')}</p></details>
<details><summary>${t('La vidéo d’un échec n’apparaît pas', 'The video of a failure does not show')}</summary><p>${b('Réglage Paramètres → Exécution → Vidéo. Sur un iPhone réel, l’enregistrement exige <code>ffmpeg</code> (<code>brew install ffmpeg</code>). Au-delà d’environ 30 Mo, la vidéo est abandonnée.', 'Setting Settings → Execution → Video. On a real iPhone, recording needs <code>ffmpeg</code> (<code>brew install ffmpeg</code>). Above about 30 MB the video is dropped.')}</p></details>
<details><summary>${t('Comment lancer sur la recette plutôt que la préprod ?', 'How do I run on staging rather than pre-prod?')}</summary><p>${b('Choisissez l’environnement dans le sélecteur de la barre latérale (ou avec l’outil MCP <code>select_environment</code>) : ses variables remplacent les variables communes pour la création, l’exécution et les essais.', 'Pick the environment in the sidebar selector (or with the MCP tool <code>select_environment</code>): its variables replace the common ones for creation, runs and tries.')}</p></details>
<h2 id="contact">${t('Contact et contribution', 'Contact and contributing')}</h2>
${P('Signalez un problème sur <a href="' + REPO + '/issues">GitHub</a> en précisant la version, l’OS hôte et cible, l’étape concernée et un extrait <b>sans identifiants</b> du journal ou de la trace d’exploration.', 'Report an issue on <a href="' + REPO + '/issues">GitHub</a> with the version, host and target OS, the step involved and an excerpt <b>without credentials</b> of the log or exploration trace.')}
</article></div>`;

/* ============================== FEATURES (robustness & logic) ============================== */
const featToc = [
  ['pas', t('Ce qu’un pas sait faire', 'What a step can do')],
  ['logique', t('Logique des scénarios', 'Scenario logic')],
  ['env', t('Environnements', 'Environments')],
  ['fiabilite', t('Fiabilité', 'Reliability')],
  ['imprevus', t('Imprévus', 'Interruptions')],
  ['diagnostic', t('Diagnostic', 'Diagnostics')],
  ['vitesse', t('Vitesse', 'Speed')],
  ['mcp', 'MCP'],
  ['limites', t('Limites connues', 'Known limits')],
];
const features = `<div class="wrap doc">${toc(featToc)}<article class="prose">
<p class="eyebrow"><i></i>${t('Fonctionnalités avancées', 'Advanced features')}</p>
<h1>${t('Des tests qui tiennent dans la durée', 'Tests that last')}</h1>
${P('Un test mobile échoue pour mille raisons qui ne sont pas des bugs : une popup, une session expirée, un écran qui s’affiche une seconde trop tard, un sélecteur qui bouge. Cette page décrit ce que Cybermonkey fait pour que <b>un échec veuille dire quelque chose</b>, et pour vous donner de quoi comprendre vite quand c’en est un.', 'A mobile test fails for a thousand reasons that are not bugs: a popup, an expired session, a screen that shows up a second late, a selector that moved. This page describes what Cybermonkey does so that <b>a failure means something</b>, and gives you what you need to understand it quickly when it does.')}

<h2 id="pas">${t('Ce qu’un pas sait faire', 'What a step can do')}</h2>
${P('Chaque pas porte une <b>variante par OS</b> (Android et iOS) : un sélecteur, une opération, une valeur. Les opérations dépassent le simple appui :', 'Each step carries a <b>variant per OS</b> (Android and iOS): a selector, an operation, a value. Operations go well beyond a tap:')}
<table><tr><th>${t('Famille', 'Family')}</th><th>${t('Opérations', 'Operations')}</th></tr>
<tr><td>${t('Gestes', 'Gestures')}</td><td>${b('appuyer, <b>appui long</b> (durée réglable), <b>double appui</b>, saisir, effacer, glisser, retour, attendre ; <b>défiler jusqu’à ce qu’un composant soit visible</b> (listes longues : plus besoin de compter les glissements).', 'tap, <b>long press</b> (adjustable duration), <b>double tap</b>, type, clear, swipe, back, wait; <b>scroll until a component is visible</b> (long lists: no more counting swipes).')}</td></tr>
<tr><td>${t('Application', 'Application')}</td><td>${b('<b>lancer, relancer, fermer, mettre en arrière-plan</b> l’application du projet (ou une autre, par son identifiant).', '<b>launch, relaunch, close, send to background</b> the project application (or another one, by id).')}</td></tr>
<tr><td>${t('Liens', 'Links')}</td><td>${b('<b>ouvrir un lien profond</b> (<code>monapp://commande/42</code>) : le chemin le plus court vers un écran.', '<b>open a deep link</b> (<code>myapp://order/42</code>): the shortest way to a screen.')}</td></tr>
<tr><td>${t('Système', 'System')}</td><td>${b('<b>répondre à une alerte ou une permission</b> (accepter, refuser, ou le libellé exact du bouton, avec attente), orientation portrait/paysage, masquer le clavier.', '<b>answer an alert or a permission</b> (accept, decline, or the exact button label, with waiting), portrait/landscape, hide the keyboard.')}</td></tr>
<tr><td>${t('Lecture', 'Reading')}</td><td>${b('<b>capturer le texte</b> d’un composant dans une variable (avec une expression régulière facultative) pour le réutiliser plus loin.', '<b>capture the text</b> of a component into a variable (with an optional regular expression) to reuse it later.')}</td></tr>
</table>
${P('<b>Vérifications</b> : visible, absent, texte exact, texte contenant, actif, sélectionné, <b>expression régulière</b>, <b>nombre de composants</b> (<code>3</code>, <code>&gt;=2</code>, <code>&lt;5</code>). Les pas fonctionnent aussi sur une <b>position d’écran</b> pour les vues web que l’accessibilité ne voit pas.', '<b>Checks</b>: visible, absent, exact text, text containing, enabled, selected, <b>regular expression</b>, <b>component count</b> (<code>3</code>, <code>&gt;=2</code>, <code>&lt;5</code>). Steps also work on a <b>screen position</b> for web views the accessibility tree cannot see.')}

<h2 id="logique">${t('Logique des scénarios', 'Scenario logic')}</h2>
<ul>
<li>${b('<b>Conditions</b> (« Exécuter seulement si… ») : une vérification par OS contrôlée juste avant le pas. Non remplie, le pas et ses enfants sont ignorés <i>sans échec</i> : « si la bannière cookies est visible, la fermer ». Un délai court évite d’attendre un élément absent.', '<b>Conditions</b> (“Run only if…”): a per-OS check made right before the step. Not met, the step and its children are skipped <i>without failing</i>: “if the cookie banner is visible, close it”. A short timeout avoids waiting for a missing element.')}</li>
<li>${b('<b>Appel de sous-scénario</b> : une action peut exécuter un autre scénario à sa place. « Se connecter » n’est écrit qu’une fois. Les boucles d’appels sont refusées et un scénario encore appelé ne peut pas être supprimé.', '<b>Sub-scenario call</b>: an action can run another scenario in its place. “Log in” is written once. Call loops are refused and a scenario still in use cannot be deleted.')}</li>
<li>${b('<b>Jeux de données</b> : un scénario joué une fois par ligne d’un tableau (50 lignes max), chaque colonne devenant une variable <code>&#36;{COLONNE}</code>. L’app est relancée entre deux lignes ; le rapport indique la ligne, et un pas en échec sur une seule ligne reste « échoué » dans la campagne.', '<b>Datasets</b>: a scenario played once per row of a table (50 rows max), each column becoming a <code>&#36;{COLUMN}</code> variable. The app is relaunched between rows; the report shows the row, and a step that fails on a single row stays “failed” in the campaign.')}</li>
<li>${b('<b>Capture de valeur</b> : lisez un numéro de commande ou un code à l’écran, gardez-le dans <code>&#36;{NOM}</code> et utilisez-le dans les pas suivants (valeur, attendu, sélecteur).', '<b>Value capture</b>: read an order number or a code on screen, keep it in <code>&#36;{NAME}</code> and use it in later steps (value, expectation, selector).')}</li>
</ul>

<h2 id="env">${t('Environnements', 'Environments')}</h2>
${P('Un projet peut porter plusieurs <b>environnements</b> (recette, préproduction, production…). Chacun a ses propres variables, qui <b>remplacent</b> les variables communes de même nom ; les autres restent héritées. Dans <b>Variables</b>, onglets « Communes » et un onglet par environnement ; dans la barre latérale, un sélecteur change l’environnement du projet.', 'A project can hold several <b>environments</b> (staging, pre-production, production…). Each has its own variables, which <b>override</b> the common variables of the same name; the others stay inherited. In <b>Variables</b>, a “Common” tab plus one tab per environment; in the sidebar, a selector changes the project’s environment.')}
${P('Le choix est <b>global au projet</b> : il s’applique à la création (l’IA voit les variables de l’environnement), à l’exécution, aux essais manuels et au serveur MCP (<code>select_environment</code>). Chaque rapport garde le nom de l’environnement utilisé. Les valeurs restent des variables du projet, <b>pas</b> un coffre-fort chiffré.', 'The choice is <b>project-wide</b>: it applies to creation (the AI sees the environment’s variables), runs, manual tries and the MCP server (<code>select_environment</code>). Each report keeps the name of the environment used. Values remain project variables, <b>not</b> an encrypted vault.')}

<h2 id="fiabilite">${t('Fiabilité : moins de faux échecs', 'Reliability: fewer false failures')}</h2>
<ul>
<li>${b('<b>Relance ciblée</b> : un pas dont le composant est introuvable ou dont la vérification échoue est rejoué <i>une fois</i> (2<sup>e</sup> essai court). S’il passe, il est marqué <b>instable</b> au lieu d’être masqué. Jamais après une saisie, un défilement ou une erreur d’appareil : on ne duplique pas un effet.', '<b>Targeted retry</b>: a step whose component is not found or whose check fails is replayed <i>once</i> (short 2<sup>nd</sup> attempt). If it passes it is marked <b>unstable</b> instead of being hidden. Never after typing, scrolling or a device error: an effect is never duplicated.')}</li>
<li>${b('<b>Appui perdu</b> : juste après un relancement l’app dessine encore son écran de lancement et un tap envoyé alors est perdu. Cybermonkey attend que l’app soit stable, et si une navigation ne se confirme pas alors que l’écran est resté inactif avec le composant toujours là, il répète l’appui une fois. Un spinner ou un bouton grisé = pas de second appui.', '<b>Lost tap</b>: right after a relaunch the app is still drawing its launch screen and a tap sent then is lost. Cybermonkey waits for the app to settle, and if a navigation is not confirmed while the screen stayed idle with the component still there, it repeats the tap once. A spinner or a disabled button = no second tap.')}</li>
<li>${b('<b>Historique de stabilité</b> : pour chaque pas et OS, « passé 8 fois sur 10 » et un verdict — stable, <b>instable</b>, <b>régression</b>, premier échec, toujours en échec. Visible dans Progression et joint à chaque échec renvoyé par MCP : il distingue un bug d’un test fragile.', '<b>Stability history</b>: for each step and OS, “passed 8 times out of 10” and a verdict — stable, <b>unstable</b>, <b>regression</b>, first failure, always failing. Shown in Progress and attached to every failure returned by MCP: it tells a bug from a fragile test.')}</li>
<li>${b('<b>Sélecteurs durables</b> : chaque sélecteur est classé — durable (identifiant technique), lié au texte affiché, fragile (XPath positionnel), par position. L’éditeur et la création IA avertissent ; l’outil MCP <code>audit_selectors</code> propose l’identifiant à demander aux développeurs et comment l’ajouter (<code>accessibilityIdentifier</code>, <code>testTag</code>, <code>Semantics</code>).', '<b>Durable selectors</b>: each selector is rated — durable (technical id), tied to displayed text, fragile (positional XPath), by position. The editor and AI creation warn; the MCP tool <code>audit_selectors</code> proposes the identifier to ask developers for and how to add it (<code>accessibilityIdentifier</code>, <code>testTag</code>, <code>Semantics</code>).')}</li>
<li>${b('<b>Réparations IA visibles</b> : un bandeau « N sélecteurs réparés, tout appliquer » écrit les réparations dans les scénarios (l’ancien sélecteur devient un secours) ; sinon chaque run les répare à nouveau, plus lentement, et le changement de l’app reste caché. Outil MCP : <code>apply_healed_selectors</code>.', '<b>Visible AI repairs</b>: a “N selectors repaired, apply all” banner writes the repairs into the scenarios (the old selector becomes a fallback); otherwise every run repairs them again, more slowly, and the app change stays hidden. MCP tool: <code>apply_healed_selectors</code>.')}</li>
</ul>

<h2 id="imprevus">${t('Imprévus : popups, session expirée, plantage', 'Interruptions: popups, expired session, crash')}</h2>
${P('Une popup, un toast, un message « session expirée » ou un plantage peuvent survenir <b>à n’importe quel moment</b>, en création comme en exécution. Quand un pas échoue, Cybermonkey regarde si quelque chose s’est mis en travers avant de conclure à un échec, dans cet ordre :', 'A popup, a toast, a “session expired” message or a crash can strike <b>at any moment</b>, in creation as in execution. When a step fails, Cybermonkey checks whether something got in the way before concluding it is a failure, in this order:')}
<ol>
<li>${b('<b>L’app n’est plus au premier plan</b> (plantage, fermeture) : elle est relancée, puis l’app revient à l’écran d’origine.', '<b>The app is no longer in the foreground</b> (crash, closed): it is relaunched, then brought back to the original screen.')}</li>
<li>${b('<b>Une boîte de dialogue bloque l’écran</b> (permission, alerte système ou de l’app) : les cas évidents sont traités par règle — permission accordée, suivi publicitaire refusé, bouton unique inoffensif — et l’IA tranche les cas flous. Un bouton qui supprime, déconnecte ou paie n’est <i>jamais</i> pressé.', '<b>A dialog blocks the screen</b> (permission, system or app alert): obvious cases are handled by rule — permission allowed, ad tracking declined, a single harmless button — and the AI settles the unclear ones. A button that deletes, logs out or pays is <i>never</i> pressed.')}</li>
<li>${b('<b>Un de vos gestionnaires reconnaît l’écran</b> : voir ci-dessous.', '<b>One of your handlers recognises the screen</b>: see below.')}</li>
<li>${b('<b>En dernier recours, l’IA</b> identifie l’intrus et ferme une popup inattendue avec le seul bouton sans effet métier (fermer, OK, plus tard). Si le seul bouton est risqué ou si elle hésite, elle ne touche à rien.', '<b>As a last resort, the AI</b> identifies the intruder and closes an unexpected popup with the one button that has no business effect (close, OK, later). If the only button is risky or it is unsure, it touches nothing.')}</li>
</ol>
<h3>${t('Les gestionnaires d’imprévus', 'Interruption handlers')}</h3>
${P('Un <b>gestionnaire</b> est un scénario ordinaire à qui l’on dit « <i>quand cet écran est affiché</i> » (ses repères, comme n’importe quelle identité d’écran) et « <i>ensuite</i> ». Il n’entre dans aucune campagne : il se déclenche seul quand un pas échoue alors que son écran est présent, puis le pas est rejoué. Il se crée, s’édite, s’enregistre et se rejoue comme n’importe quel scénario, avec l’IA ou à la main, et peut <b>appeler</b> d’autres scénarios.', 'A <b>handler</b> is an ordinary scenario to which you say “<i>when this screen is showing</i>” (its markers, like any screen identity) and “<i>afterwards</i>”. It is part of no campaign: it runs by itself when a step fails while its screen is present, then the step is replayed. It is created, edited, recorded and replayed like any scenario, with AI or by hand, and can <b>call</b> other scenarios.')}
${P('<b>Reprise</b> : « rejouer le pas là où l’app se trouve », ou « <b>revenir à l’écran d’origine</b> puis rejouer » — l’écran d’où le pas est parti est retrouvé par le lien profond de l’écran, puis les navigations connues. Les gestionnaires <b>s’enchaînent</b> (jusqu’à 3 par échec).', '<b>Resume</b>: “replay the step where the app is”, or “<b>go back to the original screen</b> then replay” — the screen the step started from is found through the screen’s deep link, then the known navigations. Handlers <b>chain</b> (up to 3 per failure).')}
<div class="callout">${b('<b>Exemple : reconnexion rapide.</b> Un pas échoue parce qu’une popup « Session expirée » le recouvre. Gestionnaire 1 — écran : le texte de la popup ; pas : appuyer sur OK. L’appui déconnecte et ramène l’écran de connexion. Gestionnaire 2 — écran : l’écran de connexion ; pas : un appel au scénario « Se connecter » ; reprise : <i>revenir à l’écran d’origine</i>. Le moteur dit OK, se reconnecte, retourne là où il était, et rejoue le pas : passé, avec « imprévu géré » dans le rapport.', '<b>Example: quick reconnection.</b> A step fails because an “Session expired” popup covers it. Handler 1 — screen: the popup text; step: tap OK. The tap logs out and brings the login screen. Handler 2 — screen: the login screen; step: a call to the “Log in” scenario; resume: <i>go back to the original screen</i>. The engine taps OK, logs in again, goes back where it was, and replays the step: passed, with “interruption handled” in the report.')}</div>
${P('<b>Garde-fous</b> : jamais d’imprévu dans un gestionnaire ; au plus 3 tours par pas, une douzaine par exécution, un nombre maximum de déclenchements par gestionnaire ; tout est tracé dans le rapport (ce qui a été vu, ce qui a été fait, si ça a marché). Le réglage <i>Imprévus</i> (Paramètres → Exécution) permet de choisir : complet, gestionnaires et app disparue seulement, ou désactivé. En <b>création</b>, les dialogues système sont répondus pour l’agent, le rejeu de la proposition applique vos gestionnaires, et l’agent est invité à ne pas inclure dans le scénario une popup qu’il a dû fermer.', '<b>Safeguards</b>: never an interruption inside a handler; at most 3 rounds per step, a dozen per run, a maximum number of triggers per handler; everything is traced in the report (what was seen, what was done, whether it worked). The <i>Interruptions</i> setting (Settings → Execution) lets you choose: full, handlers and vanished app only, or off. In <b>creation</b>, system dialogs are answered for the agent, the proposal replay applies your handlers, and the agent is asked not to include a popup it had to close in the scenario.')}

<h2 id="diagnostic">${t('Diagnostic : comprendre un échec', 'Diagnostics: understanding a failure')}</h2>
<ul>
<li>${b('<b>Vidéo</b> : chaque scénario est filmé, la vidéo n’est gardée que s’il échoue. Elle se lit dans le détail du pas, ouverte quelques secondes avant lui. Réglable (Paramètres → Exécution).', '<b>Video</b>: every scenario is filmed and the video is kept only if it fails. It plays in the step detail, opened a few seconds before it. Adjustable (Settings → Execution).')}</li>
<li>${b('<b>Journal de l’appareil</b> : syslog iOS filtré sur le processus de l’app, logcat Android sur son package. Les lignes utiles autour de l’échec sont jointes au pas et à l’analyse IA.', '<b>Device log</b>: iOS syslog filtered on the app’s process, Android logcat on its package. The useful lines around the failure are attached to the step and to the AI analysis.')}</li>
<li>${b('<b>Signes de problème réseau</b> détectés dans ce journal : hors ligne, délai dépassé, connexion refusée, certificat/TLS, réponses 5xx, accès refusé 401/403 — « ce n’est pas l’app, c’est le réseau ».', '<b>Signs of network trouble</b> found in that log: offline, timeout, connection refused, certificate/TLS, 5xx responses, 401/403 access denied — “it is not the app, it is the network”.')}</li>
<li>${b('<b>Comparaison visuelle</b> avec la dernière réussite du même pas : les zones qui ont changé sont entourées, avec le pourcentage de l’écran qui diffère (la barre d’état est ignorée). Un écart quasi nul oriente vers un problème de timing ou de données, un écart massif vers un autre écran.', '<b>Visual comparison</b> with the last pass of the same step: changed areas are outlined, with the percentage of the screen that differs (the status bar is ignored). A near-zero gap points to timing or data, a huge one to another screen.')}</li>
</ul>

<h2 id="vitesse">${t('Vitesse', 'Speed')}</h2>
<ul>
<li>${b('Android et iOS sont pilotés <b>en parallèle</b> : la durée est celle de l’OS le plus lent, pas la somme.', 'Android and iOS are driven <b>in parallel</b>: the duration is that of the slowest OS, not the sum.')}</li>
<li>${b('<b>Attentes sur condition</b> : détection de changement d’écran en quelques requêtes légères, nouvel essai immédiat puis espacé, attente du clavier plutôt qu’un délai fixe.', '<b>Condition-based waits</b>: screen-change detection in a few light requests, immediate then spaced retries, waiting for the keyboard rather than a fixed delay.')}</li>
<li>${b('<b>Raccourci par lien profond</b> : un écran de départ peut porter un lien (par OS). Il est essayé <i>avant</i> de relancer l’app et de rejouer un parcours ; s’il n’atterrit pas au bon endroit, le chemin sûr reprend.', '<b>Deep-link shortcut</b>: a start screen can carry a link (per OS). It is tried <i>before</i> relaunching the app and replaying a route; if it does not land in the right place, the safe path takes over.')}</li>
<li>${b('<b>Profil de durée</b> : Progression liste les pas les plus lents et la part du temps passée en preuves plutôt qu’à agir ; l’outil MCP <code>slowest_steps</code> y ajoute des suggestions. Le niveau de preuves (tout, écrans clés, échecs) se règle.', '<b>Duration profile</b>: Progress lists the slowest steps and the share of time spent on evidence rather than acting; the MCP tool <code>slowest_steps</code> adds suggestions. The evidence level (all, key screens, failures) is adjustable.')}</li>
</ul>

<h2 id="mcp">MCP</h2>
${P('Le serveur MCP intégré (Réglages → MCP) expose <b>45 outils</b> en six groupes, chacun activable séparément. Toutes les réponses sont structurées et expliquées : résumé, résultat par OS, étape en échec avec message, historique, analyse, capture, journal, et « quoi faire ensuite ».', 'The built-in MCP server (Settings → MCP) exposes <b>45 tools</b> in six groups, each switchable separately. Every answer is structured and explained: summary, per-OS result, failing step with message, history, analysis, capture, log, and “what to do next”.')}
<table><tr><th>${t('Groupe', 'Group')}</th><th>${t('Outils', 'Tools')}</th></tr>
<tr><td>${t('Lecture', 'Read')}</td><td><code>list_projects</code>, <code>list_scenarios</code>, <code>get_scenario</code>, <code>list_devices</code>, <code>get_device_health</code>, <code>list_campaigns</code>, <code>audit_selectors</code></td></tr>
<tr><td>${t('Observation', 'Observe')}</td><td><code>screenshot</code>, <code>inspect_screen</code>, <code>get_campaign_report</code>, <code>slowest_steps</code>, <code>flaky_steps</code>, <code>find_path</code>, <code>wait_for</code></td></tr>
<tr><td>${t('Exécution', 'Execute')}</td><td><code>run_scenario</code>, <code>run_campaign</code>, <code>run_folder</code>, <code>run_element</code>, <code>run_navigation</code>, <code>cancel_run</code>, <code>get_run_status</code></td></tr>
<tr><td>${t('Création', 'Create')}</td><td><code>create_scenario_from_prompt</code>, <code>replay_proposal</code>, <code>accept_proposal</code>, <code>update_node</code>, <code>add_nodes</code>, <code>delete_node</code>, <code>apply_healed_selectors</code></td></tr>
<tr><td>${t('Utilitaire', 'Utility')}</td><td><code>relaunch_app</code>, <code>list_variables</code>, <code>select_environment</code>, <code>open_project</code></td></tr>
<tr><td>${t('Exploration', 'Explore')}</td><td><code>explore</code>, <code>click</code>, <code>type_text</code>, <code>swipe</code>, <code>back</code>, <code>long_press</code>, <code>double_tap</code>, <code>scroll_to</code>, <code>check</code>, <code>open_link</code>, <code>answer_alert</code>, <code>app_control</code>, <code>rotate</code></td></tr>
</table>
${P('<code>add_nodes</code> et <code>update_node</code> acceptent aussi les conditions (<code>when</code>), appels (<code>call</code>), jeux de données (<code>dataset</code>), gestionnaires (<code>handler</code>) et l’opération <code>capture</code>. Détail : <a href="https://github.com/pickywawa/cybermonkey/blob/main/docs/mcp.md">docs/mcp.md</a>.', '<code>add_nodes</code> and <code>update_node</code> also accept conditions (<code>when</code>), calls (<code>call</code>), datasets (<code>dataset</code>), handlers (<code>handler</code>) and the <code>capture</code> operation. Details: <a href="https://github.com/pickywawa/cybermonkey/blob/main/docs/mcp.md">docs/mcp.md</a>.')}

<h2 id="limites">${t('Limites connues', 'Known limits')}</h2>
<table><tr><th>${t('Fonctionnalité', 'Feature')}</th><th>macOS</th><th>Windows</th></tr>
<tr><td>Android (appareils, émulateurs)</td><td>✓</td><td>✓</td></tr>
<tr><td>${t('iOS : simulateurs', 'iOS: simulators')}</td><td>✓</td><td>${t('✗ (Xcode requis)', '✗ (Xcode required)')}</td></tr>
<tr><td>${t('iOS : iPhone physique', 'iOS: physical iPhone')}</td><td>✓</td><td>${t('✗ (mode avancé non garanti)', '✗ (advanced mode, not guaranteed)')}</td></tr>
<tr><td>${t('Création IA, enregistrement, import, campagnes, MCP, imprévus, environnements', 'AI creation, recording, import, campaigns, MCP, interruptions, environments')}</td><td>✓</td><td>${t('✓ (Android)', '✓ (Android)')}</td></tr>
<tr><td>${t('Vidéo des échecs, journal, comparaison visuelle', 'Failure video, device log, visual comparison')}</td><td>✓</td><td>${t('✓ (Android : logcat, vidéo 3 min max)', '✓ (Android: logcat, 3 min video max)')}</td></tr>
<tr><td>${t('Installateur signé', 'Signed installer')}</td><td>${t('signature locale', 'local signature')}</td><td>${t('non signé (SmartScreen)', 'not signed (SmartScreen)')}</td></tr>
<tr><td>${t('Mises à jour dans l’application', 'In-app updates')}</td><td>✓</td><td>${t('✓ (ouvre l’installateur)', '✓ (opens the installer)')}</td></tr>
</table>
<ul>
<li>${b('La vidéo sur <b>iPhone réel</b> exige <code>ffmpeg</code> ; sans lui elle est désactivée automatiquement, sans effet sur le résultat. Les enregistrements Android sont limités à 3 minutes par scénario.', 'Video on a <b>real iPhone</b> requires <code>ffmpeg</code>; without it it is disabled automatically, with no effect on the result. Android recordings are limited to 3 minutes per scenario.')}</li>
<li>${b('Les requêtes réseau elles-mêmes ne sont pas capturées (cela demanderait un proxy) : seuls les signes présents dans le journal de l’appareil sont détectés.', 'Network requests themselves are not captured (that would take a proxy): only the signs present in the device log are detected.')}</li>
<li>${b('Les boîtes de dialogue <b>dessinées par l’app</b> (hors système) sont gérées par vos gestionnaires ou, en dernier recours, par l’IA ; elles ne sont pas visibles comme alertes natives.', 'Dialogs <b>drawn by the app</b> (not system ones) are handled by your handlers or, as a last resort, by the AI; they are not visible as native alerts.')}</li>
<li>${b('Un défilement jusqu’à un composant ne voit que l’arbre d’accessibilité : sur Android, un élément d’une liste pas encore affichée peut ne pas exister dans l’arbre avant d’avoir défilé.', 'Scrolling to a component only sees the accessibility tree: on Android, an element of a list not yet displayed may not exist in the tree before scrolling.')}</li>
</ul>
</article></div>`;

const notFound = `<div class="narrow" style="padding:120px 0;text-align:center"><h1>404</h1><p class="lead" style="margin:0 auto 28px">${t('Cette page n’existe pas.', 'This page does not exist.')}</p><a class="btn primary" href="index.html">${t('Retour à l’accueil', 'Back home')}</a></div>`;

const pages = [
  {
    file: 'index.html',
    title: {
      fr: 'Cybermonkey — Vos tests mobiles. Les preuves en plus.',
      en: 'Cybermonkey — Your mobile tests. With proof built in.',
    },
    desc: {
      fr: 'Créez, enregistrez et rejouez vos scénarios Android et iOS avec l’IA. Captures, cartographie et rapports dans un atelier QA mobile open source.',
    },
    body: home,
  },
  {
    file: 'fonctionnement.html',
    title: { fr: 'Fonctionnement — Cybermonkey', en: 'How it works — Cybermonkey' },
    desc: {
      fr: 'Création par IA, enregistrement, import, exécution rapide, réparation de sélecteurs, cartographie : le fonctionnement détaillé de Cybermonkey.',
    },
    body: how,
  },
  {
    file: 'fonctionnalites.html',
    title: { fr: 'Fonctionnalités — Cybermonkey', en: 'Features — Cybermonkey' },
    desc: {
      fr: 'Pas riches, logique de scénario, environnements, fiabilité, imprévus (popups, session expirée, plantage), diagnostic vidéo/journal/réseau, vitesse et MCP.',
      en: 'Rich steps, scenario logic, environments, reliability, interruptions (popups, expired session, crash), video/log/network diagnostics, speed and MCP.',
    },
    body: features,
  },
  {
    file: 'aide.html',
    title: { fr: 'Aide — Cybermonkey', en: 'Help — Cybermonkey' },
    desc: {
      fr: 'Installation, configuration Android et iOS, IA, réglages et dépannage de Cybermonkey.',
    },
    body: help,
  },
  {
    file: '404.html',
    title: { fr: 'Page introuvable — Cybermonkey', en: 'Page not found — Cybermonkey' },
    desc: { fr: 'Page introuvable.' },
    body: notFound,
  },
];
for (const p of pages) writeFileSync(new URL(`../site/${p.file}`, import.meta.url), page(p));
writeFileSync(
  new URL('../site/robots.txt', import.meta.url),
  `User-agent: *\nAllow: /\nSitemap: ${BASE}sitemap.xml\n`,
);
writeFileSync(
  new URL('../site/sitemap.xml', import.meta.url),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['', 'fonctionnement.html', 'fonctionnalites.html', 'aide.html'].map((p) => `  <url><loc>${BASE}${p}</loc></url>`).join('\n')}\n</urlset>\n`,
);
console.log('site generated:', pages.map((p) => p.file).join(', '));
