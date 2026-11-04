# Serveur MCP de Cybermonkey

Cybermonkey embarque un serveur **MCP** (Model Context Protocol) : une IA externe (Claude Code, Claude Desktop, Cursor…) peut lire vos scénarios, piloter les téléphones, lancer des tests et en créer.

- **Activé par défaut**, désactivable entièrement : _Réglages → MCP_.
- Écoute uniquement sur `127.0.0.1` (port **4750** par défaut), transport _Streamable HTTP_ sans état, route `/mcp`.
- Protégé par un **jeton** (en-tête `Authorization: Bearer …`) généré au premier lancement, régénérable. Contrôle de l’en-tête `Host`/`Origin` (anti DNS-rebinding).
- **Chaque outil** se coche/décoche dans son groupe (tous cochés par défaut). Les changements s’appliquent à l’enregistrement des réglages, sans redémarrage.

## Connexion

```sh
claude mcp add --transport http cybermonkey http://127.0.0.1:4750/mcp --header "Authorization: Bearer <jeton>"
```

Autres clients : le JSON à copier est affiché dans _Réglages → MCP_.

## Principe

Toutes les actions visent l’OS **coché dans l’application** (ou `platforms` si vous le précisez) et renvoient **un résultat par OS** : les écarts Android/iOS sont visibles, et un OS indisponible n’empêche pas l’autre. Chaque réponse est un JSON avec `summary` et `next_steps`, et les échecs expliquent `what_to_do`. Un seul run à la fois peut utiliser un appareil.

Boucle type après un développement :
`list_scenarios` (impact) → `find_path` (chemin) → `run_navigation` / `run_element` (aller et rejouer) → échec : `screenshot` + `inspect_screen`, `update_node`, `run_element` → nouveau comportement : `create_scenario_from_prompt` → `replay_proposal` → `accept_proposal`.

## Outils

| Groupe      | Outils                                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lecture     | `list_projects`, `list_scenarios`, `get_scenario`, `list_devices`, `get_device_health`, `list_campaigns`, `audit_selectors`                              |
| Observation | `screenshot` (image), `inspect_screen`, `get_campaign_report`, `slowest_steps`, `flaky_steps`, `find_path`, `wait_for`                                   |
| Exécution   | `run_scenario`, `run_campaign`, `run_folder`, `run_element`, `run_navigation`, `get_run_status`, `cancel_run`                                            |
| Création    | `create_scenario_from_prompt`, `replay_proposal`, `accept_proposal`, `update_node`, `add_nodes`, `delete_node`, `apply_healed_selectors`                 |
| Utilitaire  | `relaunch_app`, `list_variables`, `select_environment`, `open_project`                                                                                   |
| Exploration | `explore`, `click`, `type_text`, `swipe`, `back`, `long_press`, `double_tap`, `scroll_to`, `check`, `open_link`, `answer_alert`, `app_control`, `rotate` |

Notes :

- `run_element` rejoue des éléments **dans l’ordre voulu**, en jouant d’abord (par défaut) les navigations qui y mènent ; `run_navigation` déplace l’application (option `restart_app` pour repartir d’un lancement propre) et indique l’écran atteint.
- Le résultat d’un run contient, par OS : réussite/échec, étape en échec, message, analyse IA, capture, sélecteurs réparés, étapes ignorées et leur raison.
- `list_variables` ne renvoie jamais les valeurs (elles peuvent être secrètes).
- Les propositions de `create_scenario_from_prompt` ne sont pas enregistrées avant `accept_proposal`.

## Logique des scénarios

Les outils de création (`add_nodes`, `update_node`) acceptent :

- `when` — condition par OS (assertion vérifiée juste avant le pas). Non remplie : le pas et ses enfants sont ignorés (statut _skipped_, pas un échec). Donnez un `timeoutMs` court (1500).
- `call` — sur une action sans variantes : id ou nom d'un scénario dont les pas s'exécutent à cet endroit.
- `dataset` — sur un scénario : une ligne par passage ; les clés sont des variables (`${CLE}`). `run_element` sur un pas joue la première ligne.
- opération `capture` — `value` = nom de la variable, `expected` = expression régulière facultative (le premier groupe est conservé).

Les aperçus (`list_scenarios`, `get_scenario`) montrent `only_if`, `calls_scenario` et `dataset`; les échecs d'un scénario à données indiquent `dataset_row`.

## Fiabilité et diagnostic

Chaque échec renvoyé par `run_*` contient, quand ils existent : `history` (stable, instable, régression… d'après les dernières campagnes), `since_last_pass` (% de l'écran qui diffère de la dernière réussite, zones, image avec les écarts entourés), `device_log` (lignes de l'app autour de l'échec), `network_hints` (hors ligne, délai, refus, TLS, 5xx, 401/403) et `video` (enregistrement gardé dans l'app, non lisible via MCP). Les pas réussis seulement au 2e essai sont listés dans `flaky_steps`.

- `flaky_steps` : instables et régressions d'après l'historique.
- `audit_selectors` : durabilité des sélecteurs et identifiants à demander aux développeurs.
- `apply_healed_selectors` : écrit dans les scénarios les sélecteurs réparés par l'IA (`dry_run` pour les lister).

## Imprévus et environnements

- `add_nodes` / `update_node` sur un **scénario** accepte `handler` : `{ when: <écran>, resume: "return" | "retry", max_per_run }`. Ce scénario devient un **gestionnaire d'imprévu** : hors campagnes, il se déclenche quand un pas échoue alors que l'écran `when` est affiché (popup, message de session expirée, écran de connexion…), puis le pas est rejoué. `resume: "return"` revient d'abord à l'écran d'où le pas est parti. Les gestionnaires s'enchaînent ; un gestionnaire de reconnexion peut contenir une action avec `call` vers votre scénario de connexion.
- Les résultats `run_*` listent `interruptions_handled` (ce qui a gêné, ce qui a été fait, si ça a marché) et expliquent quand l'IA a fermé une popup pour que vous la rendiez permanente par un gestionnaire.
- `select_environment` choisit l'environnement du projet (ou `none`) ; `list_variables` indique, par variable, si sa valeur vient de l'environnement ou des variables communes. Les rapports portent `environment`.
