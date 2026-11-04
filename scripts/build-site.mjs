// Generates the static site in /site (FR/EN in one page). Run: node scripts/build-site.mjs
import { writeFileSync, readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const V = pkg.version;
const BASE = 'https://pickywawa.github.io/cybermonkey/';
const REPO = 'https://github.com/pickywawa/cybermonkey';
const DMG = `${REPO}/releases/download/v${V}/Cybermonkey-${V}-mac-arm64.dmg`;
const t = (fr, en) => `<span class="fr">${fr}</span><span class="en">${en}</span>`;
const b = t; // inline bilingual HTML
const P = (fr, en) => `<p>${t(fr, en)}</p>`; // standalone paragraph
const shot = (name, alt) => `<figure class="shot"><img src="assets/screenshots/${name}.png" alt="${alt}" loading="lazy" width="2250" height="1410"></figure>`;

const NAV = [
  ['index.html', t('Accueil', 'Home')],
  ['fonctionnement.html', t('Fonctionnement', 'How it works')],
  ['aide.html', t('Aide', 'Help')],
];
function page({ file, title, desc, body }) {
  const nav = NAV.map(([href, label]) => `<a href="${href}"${href === file ? ' aria-current="page"' : ''}>${label}</a>`).join('') + `<a href="${REPO}" rel="noopener">GitHub ↗</a>`;
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
  ['creation', t('Créer', 'Create'), b('Un scénario partagé : l’intention (nom, description) et une variante par OS. Créez à la main, avec l’IA, en enregistrant ou en important.', 'One shared scenario: the intent (name, description) and one variant per OS. Create by hand, with AI, by recording or by importing.')],
  ['synthese', t('Valider', 'Review'), b('L’IA propose, vous décidez : synthèse, couverture par OS, résultat du rejeu et corrections automatiques. Rien n’est enregistré avant votre validation.', 'The AI proposes, you decide: synthesis, per-OS coverage, replay result and automatic fixes. Nothing is saved before you accept.')],
  ['progression', t('Suivre', 'Track'), b('Avancement par OS et par scénario, résultats de la dernière tentative, chronologie rejouable avec les captures.', 'Progress per OS and per scenario, latest-attempt results, a scrubbable timeline with captures.')],
  ['cartographie', t('Comprendre', 'Understand'), b('Les écrans testés, leurs captures et les résultats Android/iOS, reliés par les transitions observées.', 'Tested screens, their captures and Android/iOS results, linked by the transitions observed.')],
  ['diagnostic', t('Configurer', 'Set up'), b('Chaque appareil dit précisément ce qui manque et comment le corriger, avec la commande à copier et un diagnostic par l’IA.', 'Each device says exactly what is missing and how to fix it, with a command to copy and an AI diagnosis.')],
];
const home = `
<div class="wrap hero">
<div>
<p class="eyebrow"><i></i>${t('Atelier QA mobile · open source', 'Mobile QA workspace · open source')}</p>
<h1>${t('Vos tests mobiles.<br><em>Les preuves en plus.</em>', 'Your mobile tests.<br><em>With proof built in.</em>')}</h1>
<p class="lead">${t('Créez, enregistrez et rejouez vos scénarios Android et iOS. L’IA explore vos appareils, répare les sélecteurs cassés et analyse les échecs ; chaque étape garde sa capture.', 'Create, record and replay your Android and iOS scenarios. The AI explores your devices, repairs broken selectors and analyses failures; every step keeps its screenshot.')}</p>
<div class="cta"><a class="btn primary big" href="#telecharger">${t('Télécharger pour macOS', 'Download for macOS')}</a><a class="btn big" href="fonctionnement.html">${t('Voir le fonctionnement', 'See how it works')}</a></div>
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
<div><h2>${t('Télécharger Cybermonkey', 'Download Cybermonkey')} ${V}</h2><p class="lead">${t('Application macOS Apple Silicon. Ouvrez le DMG et glissez Cybermonkey dans Applications. Les mises à jour suivantes sont proposées dans l’application.', 'macOS Apple Silicon app. Open the DMG and drag Cybermonkey into Applications. Later updates are offered inside the app.')}</p>
<p class="caption">${t('Signature locale (ad hoc), sans notarisation Apple : au premier lancement, autorisez l’app dans Réglages Système → Confidentialité et sécurité → « Ouvrir quand même ».', 'Locally signed (ad hoc), not notarized by Apple: on first launch, allow the app in System Settings → Privacy &amp; Security → “Open Anyway”.')}</p></div>
<div style="display:grid;gap:12px"><a class="btn primary big" href="${DMG}">⬇ Cybermonkey-${V}-mac-arm64.dmg</a><a class="btn" href="${REPO}/releases/latest">${t('Notes de version et empreintes', 'Release notes and checksums')}</a><a class="btn" href="${REPO}#development">${t('Compiler depuis les sources (Windows, Linux, Intel)', 'Build from source (Windows, Linux, Intel)')}</a></div>
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
const toc = (items) => `<nav class="toc" aria-label="Sommaire">${items.map(([id, l]) => `<a href="#${id}">${l}</a>`).join('')}</nav>`;
const howToc = [
  ['vue', t('Vue d’ensemble', 'Overview')], ['projets', t('Projets et appareils', 'Projects and devices')], ['creer', t('Créer un scénario', 'Create a scenario')], ['modele', t('Le modèle de scénario', 'The scenario model')],
  ['ia', t('L’IA de création', 'AI creation')], ['web', t('Vues web', 'Web views')], ['executer', t('Exécuter une campagne', 'Run a campaign')], ['comprendre', t('Suivi et cartographie', 'Tracking and map')], ['donnees', t('Données et architecture', 'Data and architecture')],
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
const helpToc = [['demarrer', t('Démarrage rapide', 'Quick start')], ['install', t('Installation', 'Installation')], ['android', 'Android'], ['ios', 'iOS'], ['ia', t('Configurer l’IA', 'Set up the AI')], ['reglages', t('Réglages utiles', 'Useful settings')], ['depannage', t('Dépannage', 'Troubleshooting')], ['contact', t('Contact', 'Contact')]];
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
${P('<b>macOS (Apple Silicon)</b> : téléchargez le DMG depuis la <a href="' + REPO + '/releases/latest">dernière release</a>, glissez Cybermonkey dans Applications. L’app est signée localement sans notarisation : au premier lancement, ouvrez <i>Réglages Système → Confidentialité et sécurité</i> et choisissez « Ouvrir quand même ». <b>Autres systèmes</b> : compilez depuis les sources.', '<b>macOS (Apple Silicon)</b>: download the DMG from the <a href="' + REPO + '/releases/latest">latest release</a>, drag Cybermonkey into Applications. The app is locally signed without notarization: on first launch open <i>System Settings → Privacy &amp; Security</i> and choose “Open Anyway”. <b>Other systems</b>: build from source.')}
<pre><code>git clone ${REPO}.git
cd cybermonkey
npm ci
npm run dev        # ${t('développement', 'development')}
npm run dist -- --mac dmg --arm64   # ${t('installateur macOS', 'macOS installer')}</code></pre>
<p>${t('Node.js 22.12 ou plus est requis.', 'Node.js 22.12 or later is required.')}</p>
<h2 id="android">Android</h2>
<ul><li>${b('Installez les <b>Android Platform Tools</b> (<code>adb</code>) et un <b>JDK</b> : <code>brew install --cask android-platform-tools temurin</code>.', 'Install <b>Android Platform Tools</b> (<code>adb</code>) and a <b>JDK</b>: <code>brew install --cask android-platform-tools temurin</code>.')}</li>
<li>${b('Activez les <b>options pour les développeurs</b> et le <b>débogage USB</b> sur le téléphone, branchez-le et acceptez l’autorisation RSA.', 'Enable <b>Developer options</b> and <b>USB debugging</b> on the phone, plug it in and accept the RSA prompt.')}</li>
<li>${b('Les émulateurs démarrés sont détectés aussi. Vérifiez avec <code>adb devices</code>.', 'Running emulators are detected too. Check with <code>adb devices</code>.')}</li></ul>
<h2 id="ios">iOS</h2>
<ul><li>${b('<b>Simulateurs</b> : installez Xcode et ses runtimes, démarrez un simulateur ; aucune signature n’est nécessaire.', '<b>Simulators</b>: install Xcode and its runtimes, boot a simulator; no signing needed.')}</li>
<li>${b('<b>iPhone physique</b> : activez le <b>mode développeur</b>, faites confiance à l’ordinateur, laissez Xcode préparer l’appareil, puis renseignez dans <i>Paramètres → Appareils</i> le <b>Team ID</b> Apple et un <b>Bundle ID</b> WebDriverAgent couvert par votre profil Development (base + <code>.xctrunner</code>). Ajoutez votre compte Apple dans Xcode.', '<b>Physical iPhone</b>: enable <b>Developer Mode</b>, trust the computer, let Xcode prepare the device, then set in <i>Settings → Devices</i> the Apple <b>Team ID</b> and a WebDriverAgent <b>Bundle ID</b> covered by your Development profile (base + <code>.xctrunner</code>). Add your Apple account in Xcode.')}</li>
<li>${b('<b>Windows / Linux</b> : WDA préinstallé ou externe, iOS 18+ et tunnel RemoteXPC (voir la documentation Appium XCUITest).', '<b>Windows / Linux</b>: preinstalled or external WDA, iOS 18+ and a RemoteXPC tunnel (see the Appium XCUITest docs).')}</li></ul>
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
<tr><td>${t('Préparation de l’écran de départ', 'Start-screen preparation')}</td><td>${t('Désactivée, parcours existants, ou IA en dernier recours.', 'Off, existing routes, or AI as a last resort.')}</td></tr></table>
<h2 id="depannage">${t('Dépannage', 'Troubleshooting')}</h2>
<details><summary>${t('Mon appareil n’apparaît pas', 'My device does not show up')}</summary><p>${b('Menu « ⋯ » de la carte de l’appareil → <b>Diagnostic</b> : chaque ligne rouge donne la cause et le correctif. Android : <code>adb devices</code> doit afficher « device » (pas « unauthorized »). iOS : mode développeur, confiance, Xcode ouvert une fois.', 'Device card “⋯” menu → <b>Diagnostics</b>: each red row gives the cause and the fix. Android: <code>adb devices</code> must show “device” (not “unauthorized”). iOS: Developer Mode, trust, Xcode opened once.')}</p></details>
<details><summary>${t('« Exploration en cours… » ne progresse pas', '“Exploring…” does not progress')}</summary><p>${b('Le message affiche l’étape en cours. Si la connexion à l’appareil dépasse 3 minutes, une erreur indique de rouvrir son diagnostic. Consultez <code>~/Library/Application Support/Cybermonkey/logs/cybermonkey.log</code>. Un reste d’agent iOS d’une session précédente est nettoyé automatiquement au lancement.', 'The message shows the current step. If connecting to the device exceeds 3 minutes an error asks you to open its diagnostics. Check <code>~/Library/Application Support/Cybermonkey/logs/cybermonkey.log</code>. A leftover iOS agent from a previous session is cleaned up on launch.')}</p></details>
<details><summary>${t('Le rejeu est « bloqué »', 'The replay is “blocked”')}</summary><p>${b('L’app redémarre sur un autre écran que celui où l’exploration a commencé. Explorez depuis l’écran de lancement, ou activez la préparation de l’écran de départ.', 'The app restarts on a different screen than where the exploration started. Explore from the launch screen, or enable start-screen preparation.')}</p></details>
<details><summary>${t('« Écran destination non confirmé »', '“Destination screen not confirmed”')}</summary><p>${b('Les repères de l’écran cible ne sont pas tous présents. Ouvrez la navigation → « Écran de destination » : gardez des repères stables (titre, composant propre à l’écran), retirez ceux qui changent (compteurs, dates, <code>platform_view[n]</code>).', 'Not all of the target screen’s markers are present. Open the navigation → “Destination screen”: keep stable markers (title, a component specific to the screen), remove those that change (counters, dates, <code>platform_view[n]</code>).')}</p></details>
<details><summary>${t('Une étape est « ignorée : à compléter »', 'A step is “skipped: to complete”')}</summary><p>${b('Elle n’a pas de variante pour cet OS. Cliquez « Compléter avec l’IA » dans l’éditeur, ou associez un composant du miroir. Si l’étape n’existe que sur un OS, décochez l’autre dans « S’applique à ».', 'It has no variant for this OS. Click “Complete with AI” in the editor, or bind a component from the mirror. If the step exists on one OS only, untick the other under “Applies to”.')}</p></details>
<details><summary>${t('iOS : « Connexion iOS impossible » / signature', 'iOS: “iOS connection impossible” / signing')}</summary><p>${b('Vérifiez Team ID, Bundle ID WDA et compte Apple dans Xcode (<i>Diagnostic → Signature WDA</i>). Pour un simulateur, aucune signature n’est requise.', 'Check Team ID, WDA Bundle ID and your Apple account in Xcode (<i>Diagnostics → WDA signing</i>). A simulator needs no signing.')}</p></details>
<details><summary>${t('Où se trouvent mes projets ?', 'Where are my projects?')}</summary><p>${b('Dans le dossier choisi dans Paramètres → Général (par défaut <code>~/Documents/Cybermonkey/Projects</code>). « Afficher le dossier » dans le menu du projet l’ouvre.', 'In the folder set in Settings → General (default <code>~/Documents/Cybermonkey/Projects</code>). “Show folder” in the project menu opens it.')}</p></details>
<details><summary>${t('Comment mettre à jour ?', 'How do I update?')}</summary><p>${b('L’application vérifie les releases stables au démarrage et toutes les 4 heures ; Paramètres → Mises à jour permet de vérifier, télécharger (empreinte SHA-256 contrôlée) et installer.', 'The app checks stable releases at startup and every 4 hours; Settings → Updates lets you check, download (SHA-256 verified) and install.')}</p></details>
<h2 id="contact">${t('Contact et contribution', 'Contact and contributing')}</h2>
${P('Signalez un problème sur <a href="' + REPO + '/issues">GitHub</a> en précisant la version, l’OS hôte et cible, l’étape concernée et un extrait <b>sans identifiants</b> du journal ou de la trace d’exploration.', 'Report an issue on <a href="' + REPO + '/issues">GitHub</a> with the version, host and target OS, the step involved and an excerpt <b>without credentials</b> of the log or exploration trace.')}
</article></div>`;

const notFound = `<div class="narrow" style="padding:120px 0;text-align:center"><h1>404</h1><p class="lead" style="margin:0 auto 28px">${t('Cette page n’existe pas.', 'This page does not exist.')}</p><a class="btn primary" href="index.html">${t('Retour à l’accueil', 'Back home')}</a></div>`;

const pages = [
  { file: 'index.html', title: { fr: 'Cybermonkey — Vos tests mobiles. Les preuves en plus.', en: 'Cybermonkey — Your mobile tests. With proof built in.' }, desc: { fr: 'Créez, enregistrez et rejouez vos scénarios Android et iOS avec l’IA. Captures, cartographie et rapports dans un atelier QA mobile open source.' }, body: home },
  { file: 'fonctionnement.html', title: { fr: 'Fonctionnement — Cybermonkey', en: 'How it works — Cybermonkey' }, desc: { fr: 'Création par IA, enregistrement, import, exécution rapide, réparation de sélecteurs, cartographie : le fonctionnement détaillé de Cybermonkey.' }, body: how },
  { file: 'aide.html', title: { fr: 'Aide — Cybermonkey', en: 'Help — Cybermonkey' }, desc: { fr: 'Installation, configuration Android et iOS, IA, réglages et dépannage de Cybermonkey.' }, body: help },
  { file: '404.html', title: { fr: 'Page introuvable — Cybermonkey', en: 'Page not found — Cybermonkey' }, desc: { fr: 'Page introuvable.' }, body: notFound },
];
for (const p of pages) writeFileSync(new URL(`../site/${p.file}`, import.meta.url), page(p));
writeFileSync(new URL('../site/robots.txt', import.meta.url), `User-agent: *\nAllow: /\nSitemap: ${BASE}sitemap.xml\n`);
writeFileSync(new URL('../site/sitemap.xml', import.meta.url), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['', 'fonctionnement.html', 'aide.html'].map((p) => `  <url><loc>${BASE}${p}</loc></url>`).join('\n')}\n</urlset>\n`);
console.log('site generated:', pages.map((p) => p.file).join(', '));
