/** Tools exposed by the built-in MCP server: the catalog drives both the server and the settings screen. */
export const MCP_GROUPS = ['read', 'observe', 'execute', 'create', 'utility', 'explore'] as const;
export type McpGroup = (typeof MCP_GROUPS)[number];
export interface McpToolInfo {
  name: string;
  group: McpGroup;
  fr: string;
  en: string;
}
export const MCP_TOOLS: McpToolInfo[] = [
  {
    name: 'list_projects',
    group: 'read',
    fr: 'Liste les projets (plateformes, apps, projet actif).',
    en: 'List projects (platforms, apps, active project).',
  },
  {
    name: 'list_scenarios',
    group: 'read',
    fr: 'Arbre des scénarios avec couverture par OS et dernier résultat.',
    en: 'Scenario tree with per-OS coverage and latest result.',
  },
  {
    name: 'get_scenario',
    group: 'read',
    fr: 'Détail complet d’un élément (variantes par OS, écrans, préconditions).',
    en: 'Full detail of an item (per-OS variants, screens, preconditions).',
  },
  {
    name: 'list_devices',
    group: 'read',
    fr: 'Appareils détectés, état et association au projet.',
    en: 'Detected devices, state and pairing with the project.',
  },
  {
    name: 'get_device_health',
    group: 'read',
    fr: 'Diagnostic d’un appareil : ce qui manque et comment le corriger.',
    en: 'Device diagnostics: what is missing and how to fix it.',
  },
  {
    name: 'list_campaigns',
    group: 'read',
    fr: 'Campagnes du projet et leur état.',
    en: 'Project campaigns and their state.',
  },
  {
    name: 'screenshot',
    group: 'observe',
    fr: 'Capture d’écran de chaque OS actif (image renvoyée à l’IA).',
    en: 'Screenshot of each active OS (image returned to the AI).',
  },
  {
    name: 'inspect_screen',
    group: 'observe',
    fr: 'Composants de l’écran courant et écran identifié, par OS.',
    en: 'Components of the current screen and identified screen, per OS.',
  },
  {
    name: 'get_campaign_report',
    group: 'observe',
    fr: 'Rapport d’une campagne : avancement, échecs, analyses, réparations.',
    en: 'Campaign report: progress, failures, analyses, repairs.',
  },
  {
    name: 'slowest_steps',
    group: 'observe',
    fr: 'Pas les plus lents d’une campagne et part du temps passée en preuves.',
    en: 'Slowest steps of a campaign and the share of time spent on evidence.',
  },
  {
    name: 'find_path',
    group: 'observe',
    fr: 'Chemin de navigation pour atteindre un élément (étapes à rejouer).',
    en: 'Navigation path to reach an item (steps to replay).',
  },
  {
    name: 'wait_for',
    group: 'observe',
    fr: 'Attend qu’un texte ou composant apparaisse à l’écran.',
    en: 'Wait until a text or component shows up on screen.',
  },
  {
    name: 'run_scenario',
    group: 'execute',
    fr: 'Joue un scénario sur les OS choisis ; résultat structuré.',
    en: 'Run a scenario on the chosen OS; structured result.',
  },
  {
    name: 'run_campaign',
    group: 'execute',
    fr: 'Joue tous les scénarios du projet dans une campagne.',
    en: 'Run every scenario of the project in a campaign.',
  },
  {
    name: 'run_folder',
    group: 'execute',
    fr: 'Joue un dossier (scénario ou groupe de navigation) avec ses enfants.',
    en: 'Run a folder (scenario or navigation group) with its children.',
  },
  {
    name: 'run_element',
    group: 'execute',
    fr: 'Joue un ou plusieurs éléments, dans l’ordre voulu, avec navigation préalable.',
    en: 'Run one or several items, in any order, with prior navigation.',
  },
  {
    name: 'run_navigation',
    group: 'execute',
    fr: 'Rejoue une liste de navigations pour atteindre un écran (relance facultative).',
    en: 'Replay a list of navigations to reach a screen (optional relaunch).',
  },
  {
    name: 'get_run_status',
    group: 'execute',
    fr: 'État d’une exécution en cours ou terminée.',
    en: 'State of a running or finished run.',
  },
  {
    name: 'cancel_run',
    group: 'execute',
    fr: 'Annule l’exécution en cours.',
    en: 'Cancel the current run.',
  },
  {
    name: 'create_scenario_from_prompt',
    group: 'create',
    fr: 'Crée un scénario avec l’agent IA de création (proposition à valider).',
    en: 'Create a scenario with the AI creation agent (proposal to accept).',
  },
  {
    name: 'replay_proposal',
    group: 'create',
    fr: 'Rejoue une proposition ou des nœuds JSON sur les appareils.',
    en: 'Replay a proposal or JSON nodes on the devices.',
  },
  {
    name: 'accept_proposal',
    group: 'create',
    fr: 'Insère une proposition dans le projet.',
    en: 'Insert a proposal into the project.',
  },
  {
    name: 'update_node',
    group: 'create',
    fr: 'Modifie un élément (nom, variantes par OS, repères, options).',
    en: 'Edit an item (name, per-OS variants, markers, options).',
  },
  {
    name: 'add_nodes',
    group: 'create',
    fr: 'Ajoute des nœuds JSON (scénarios ou étapes) au projet.',
    en: 'Add JSON nodes (scenarios or steps) to the project.',
  },
  {
    name: 'delete_node',
    group: 'create',
    fr: 'Supprime un élément et son contenu.',
    en: 'Delete an item and its content.',
  },
  {
    name: 'relaunch_app',
    group: 'utility',
    fr: 'Relance l’application testée (données conservées).',
    en: 'Relaunch the app under test (data kept).',
  },
  {
    name: 'list_variables',
    group: 'utility',
    fr: 'Noms des variables du projet (jamais leurs valeurs).',
    en: 'Project variable names (never their values).',
  },
  {
    name: 'open_project',
    group: 'utility',
    fr: 'Ouvre un projet dans l’application.',
    en: 'Open a project in the app.',
  },
  {
    name: 'explore',
    group: 'explore',
    fr: 'Exploration IA des appareils : décrit les écrans et parcours.',
    en: 'AI exploration of the devices: describes screens and journeys.',
  },
  {
    name: 'click',
    group: 'explore',
    fr: 'Appuie sur un composant (id, texte, sélecteur) ou une position.',
    en: 'Tap a component (id, text, selector) or a position.',
  },
  {
    name: 'type_text',
    group: 'explore',
    fr: 'Saisit du texte dans un champ (variables ${NOM} possibles).',
    en: 'Type text into a field (${NAME} variables allowed).',
  },
  {
    name: 'swipe',
    group: 'explore',
    fr: 'Glisse dans une direction (défilement).',
    en: 'Swipe in a direction (scrolling).',
  },
  {
    name: 'back',
    group: 'explore',
    fr: 'Retour arrière sur chaque OS actif.',
    en: 'Go back on each active OS.',
  },
  {
    name: 'long_press',
    group: 'explore',
    fr: 'Appui long sur un composant ou une position.',
    en: 'Long press a component or a position.',
  },
  {
    name: 'double_tap',
    group: 'explore',
    fr: 'Double appui sur un composant ou une position.',
    en: 'Double tap a component or a position.',
  },
  {
    name: 'scroll_to',
    group: 'explore',
    fr: 'Défile jusqu’à ce qu’un composant soit visible.',
    en: 'Scroll until a component is visible.',
  },
  {
    name: 'check',
    group: 'explore',
    fr: 'Vérifie une condition à l’écran (visible, texte, nombre…) sans rien enregistrer.',
    en: 'Verify a condition on screen (visible, text, count…) without saving anything.',
  },
  {
    name: 'open_link',
    group: 'explore',
    fr: 'Ouvre un lien profond dans l’application.',
    en: 'Open a deep link in the application.',
  },
  {
    name: 'answer_alert',
    group: 'explore',
    fr: 'Répond à une alerte ou permission système.',
    en: 'Answer a system alert or permission dialog.',
  },
  {
    name: 'app_control',
    group: 'explore',
    fr: 'Lance, relance, ferme ou met l’app en arrière-plan.',
    en: 'Launch, relaunch, close or background the app.',
  },
  {
    name: 'rotate',
    group: 'explore',
    fr: 'Change l’orientation ou masque le clavier.',
    en: 'Change orientation or hide the keyboard.',
  },
  {
    name: 'flaky_steps',
    group: 'observe',
    fr: 'Pas instables ou en régression d’après l’historique des campagnes.',
    en: 'Unstable or regressed steps from the campaign history.',
  },
  {
    name: 'audit_selectors',
    group: 'read',
    fr: 'Audit de la durabilité des sélecteurs, avec les identifiants à ajouter côté app.',
    en: 'Audit of selector durability, with the identifiers to add in the app.',
  },
  {
    name: 'apply_healed_selectors',
    group: 'create',
    fr: 'Applique aux scénarios les sélecteurs réparés par l’IA pendant les runs.',
    en: 'Apply the selectors repaired by the AI during runs to the scenarios.',
  },
  {
    name: 'select_environment',
    group: 'utility',
    fr: 'Choisit l’environnement du projet (recette, préprod…) pour tout ce qui suit.',
    en: 'Select the project environment (staging, pre-production…) for everything that follows.',
  },
];
export const MCP_DEFAULT_PORT = 4750;

export interface McpStatus {
  running: boolean;
  port: number;
  url: string;
  error?: string;
  /** Tools currently exposed to clients. */
  tools: number;
  calls: number;
  last?: { tool: string; at: string; ok: boolean };
}
