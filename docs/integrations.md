# Intégrations : Git, notifications, outils de test, tickets

_Réglages → Intégrations._ Tout est **facultatif et désactivé par défaut**. Ces fonctions s’appuient sur les événements de l’application (un pas échoue, une exécution se termine, un scénario est modifié) et fonctionnent aussi depuis la [ligne de commande](cli.md) pour la CI/CD.

| Fonction                          | Déclencheur                                              | Confirmation                        |
| --------------------------------- | -------------------------------------------------------- | ----------------------------------- |
| [Git](#git)                       | démarrage, minuteur, modification, fin d’exécution       | **toujours** une fenêtre            |
| [Notifications](#notifications)   | échec d’un test, régression, avancement, fin d’exécution | aucune (messages seulement)         |
| [Outils de test](#outils-de-test) | fin d’exécution                                          | jamais / avec fenêtre / automatique |
| [Tickets](#tickets)               | régression à la fin d’une exécution                      | jamais / avec fenêtre / automatique |

## Régression : ce que cela veut dire

Une **régression** est une étape qui **passait avant** et **échoue maintenant**. Elle est calculée avec l’historique des campagnes du projet (les 8 dernières, plus l’exécution en cours), avec la même logique que l’historique de stabilité :

- une étape **instable** (qui passe parfois, parfois non) n’est **pas** une régression : la signaler ainsi apprendrait aux gens à ignorer le message ;
- une étape qui **n’a jamais marché** non plus ;
- une étape sans historique non plus (rien ne permet de dire qu’elle marchait).

Notifications « régression » et tickets utilisent cette même définition.

## Secrets

Jetons, clés d’API, mots de passe SMTP et URLs de webhooks **ne sont jamais** dans les réglages ni dans le projet (que vous pourriez pousser sur git). Ils sont enregistrés à part, dans `integrations/secrets.json` du dossier de données de l’application :

- **chiffrés par le système** (Trousseau macOS, DPAPI Windows, libsecret) quand il est disponible, sinon protégés par les droits du fichier (lecture réservée à l’utilisateur). Le trousseau n’est sollicité qu’**au moment d’enregistrer ou de lire un secret**, jamais au lancement ni quand une page de réglages demande seulement « est-il renseigné ? » : macOS peut demander l’autorisation à ce moment-là ;
- la fenêtre sait seulement si un secret est **renseigné ou non** : elle ne le revoit jamais ;
- **en CI**, une variable d’environnement l’emporte sur le fichier. C’est la bonne pratique : le secret vient du coffre de votre CI. **En ligne de commande, le trousseau n’est pas utilisé** (un job ne doit jamais attendre une fenêtre d’autorisation) : les secrets enregistrés chiffrés par l’application ne sont donc pas lisibles, utilisez les variables d’environnement. Pour les utiliser quand même depuis votre poste, `CYBERMONKEY_KEYCHAIN=1` avec `Cybermonkey --cli`. Le lanceur Node autonome (`npm run cli`) n’a jamais accès au chiffrement système.

| Secret                   | Variable d’environnement       |
| ------------------------ | ------------------------------ |
| URL du webhook Slack     | `CYBERMONKEY_SLACK_WEBHOOK`    |
| URL du webhook Teams     | `CYBERMONKEY_TEAMS_WEBHOOK`    |
| Mot de passe SMTP        | `CYBERMONKEY_SMTP_PASSWORD`    |
| Jeton GitHub             | `CYBERMONKEY_GITHUB_TOKEN`     |
| Jeton Jira               | `CYBERMONKEY_JIRA_TOKEN`       |
| Clé d’API TestRail       | `CYBERMONKEY_TESTRAIL_API_KEY` |
| Jeton Azure DevOps (PAT) | `CYBERMONKEY_AZURE_PAT`        |

Un secret ne sort jamais dans un message : les **valeurs des variables du projet dont le nom ressemble à un secret** (`PASSWORD`, `TOKEN`, `PIN`, `CODE`, `KEY`…) sont masquées (`[REDACTED]`) dans les notifications, les tickets et les commentaires envoyés aux outils de test. Les messages d’erreur réseau masquent aussi les jetons et les URLs de webhook.

> Les **variables du projet** (mots de passe de test…) sont, elles, stockées **en clair** dans `cybermonkey.project.json`. Si vous synchronisez le projet avec git, ne poussez pas vers un dépôt public.

## Git

Si le **dossier des projets** (Réglages → Général) est dans un dépôt git, l’onglet l’indique (branche, branche distante suivie, fichiers modifiés, à envoyer, à récupérer) et propose :

| Réglage                                | Effet                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Au démarrage, proposer de récupérer    | Vérifie le dépôt distant (`git fetch`) quelques secondes après le lancement.                                                                |
| Vérifier toutes les … minutes          | Même vérification, périodique (0 = jamais).                                                                                                 |
| Après une création ou une modification | Propose un commit + push, après un délai (défaut 60 s) sans nouvelle modification, pour qu’une rafale d’éditions fasse **une** proposition. |
| Après une exécution                    | Propose un commit + push des résultats de campagne, une fois l’exécution terminée.                                                          |
| Inclure captures et vidéos             | Désactivé par défaut : elles sont volumineuses.                                                                                             |
| Message de validation                  | Modèle (`{summary}` = nom du projet et nombre de fichiers), modifiable dans la fenêtre.                                                     |

**Toujours avec une fenêtre de confirmation** : elle liste les fichiers concernés et laisse modifier le message. Pour un envoi, « Plus tard » ne repropose pas la même chose tant que les fichiers modifiés ne changent pas ; pour une récupération, la question revient à la prochaine vérification (démarrage ou minuteur). Rien n’est proposé pendant qu’une exécution tourne.

**Ce que Cybermonkey ne fait jamais** : fusionner, rebaser, écraser, forcer un envoi, ni résoudre un conflit.

- _Récupérer_ = `git pull --ff-only` (avance rapide). Si les historiques ont divergé, ou si vos modifications locales bloquent la mise à jour, une fenêtre vous le dit et **rien n’est modifié** : c’est à vous de résoudre avec vos outils.
- _Envoyer_ = `git add` limité au dossier du projet, puis `git commit`, puis `git push`. Si vous avez déjà des fichiers indexés (`git add`) ailleurs, l’envoi est refusé plutôt que de les inclure. Si le dépôt distant a avancé entre-temps, le push est refusé : votre commit reste en local, avec un message vous invitant à récupérer d’abord. Sans branche distante suivie, le premier envoi la crée (la fenêtre l’indique).
- Après une récupération réussie, les projets sont relus depuis le disque, pour que l’application n’écrase pas ce qui vient d’arriver.

Boutons de test : _Chercher des nouveautés maintenant_ et _Proposer un envoi maintenant_ (une fenêtre s’ouvre s’il y a quelque chose à faire).

Git est désactivé en ligne de commande : sans fenêtre, il n’y a personne pour confirmer.

## Notifications

Trois canaux, tous facultatifs, qui reçoivent les mêmes messages :

| Canal               | Ce qu’il faut                                                                                                                          | Fichiers joints |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **Slack**           | URL d’un [webhook entrant](https://api.slack.com/messaging/webhooks) (lié à un canal)                                                  | non             |
| **Microsoft Teams** | URL d’un webhook de workflow (« Publier dans un canal quand une demande webhook est reçue »)                                           | non             |
| **E-mail**          | serveur SMTP, port, chiffrement (STARTTLS, TLS direct, ou aucun en réseau local), utilisateur, mot de passe, expéditeur, destinataires | oui             |

**Quoi notifier** (chaque case est indépendante) :

| Événement                        | Par défaut | Comportement anti-spam                                                                                                                                                                |
| -------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Régression** dans une campagne | oui        | **un seul message par exécution**, qui liste toutes les régressions                                                                                                                   |
| **Échec d’un test**              | **non**    | un message par échec, **limité par exécution** (défaut 5) ; le reste est compté dans le résumé de fin                                                                                 |
| **Avancement** de la campagne    | non        | un message à chaque **palier** (5, 10, 20, 25 ou 50 %), une seule fois chacun ; un saut de plusieurs paliers fait **un** message ; 100 % n’est pas annoncé (c’est la fin d’exécution) |
| **Fin d’exécution** (résumé)     | non        | un message par exécution                                                                                                                                                              |

**À joindre** : l’analyse IA (cause probable, piste), la capture d’écran, la vidéo de l’échec.

> **Limite : captures et vidéos ne partent que par e-mail.** Les webhooks entrants de Slack et de Teams n’acceptent pas de fichiers. Les vidéos ne sont jointes que si elles sont assez petites pour un serveur de messagerie (environ 5 Mo), et les pièces jointes ne couvrent que les 3 premières étapes concernées d’un message.

Le bouton **Tester** de chaque canal envoie un message d’essai avec la configuration affichée (même non enregistrée).

## Outils de test

Renvoie les résultats d’une exécution vers l’outil où vivent vos cas de test.

- **TestRail** : crée un _run_ avec les cas liés (`add_run`) puis y ajoute les résultats (`add_results_for_cases`) : réussi / échec, durée, commentaire avec les étapes en échec.
- **Azure Test Plans** : retrouve les _test points_ des cas dans la suite du plan, crée un _run_, puis complète chaque résultat (`Passed` / `Failed`) et clôt le run.
- **Squash TM : pas pris en charge.** Son interface de résultats d’exécution n’a pas pu être vérifiée ; plutôt que de deviner une API, la fonction n’est pas proposée.

**Le lien scénario ↔ cas** vient de l’**import** : un scénario créé en important un cas depuis l’outil porte une référence (`testrail:C123`, `azure:456`), visible dans l’éditeur. Seuls les scénarios liés sont envoyés ; les autres sont ignorés (et comptés). Les deux OS sont repliés en un statut par cas : échec si une étape a échoué sur l’un ou l’autre, réussi si des étapes ont réussi et aucune n’a échoué ; un scénario qui n’a pas été joué n’est pas envoyé.

Chaque envoi crée **un nouveau run**. Modes : _jamais_, _avec confirmation_ (la fenêtre permet de nommer le run), _automatiquement_.

> **Non éprouvé sur une vraie instance.** Les requêtes suivent la documentation des API et sont vérifiées contre des serveurs simulés, mais pas contre un TestRail ou un Azure DevOps réels. Utilisez d’abord le bouton **Tester** (lecture seule), puis un envoi « avec confirmation » sur un projet d’essai.

## Tickets

Crée un ticket **Jira** ou **GitHub** quand une régression apparaît.

- **Regroupement** : un ticket **par exécution** (défaut, liste toutes les régressions) ou un ticket **par étape**. Au plus N tickets par exécution (défaut 3).
- **Jamais de doublon** : chaque ticket créé est mémorisé (`integrations/tickets.json`). Pour les mêmes régressions, si le ticket est **encore ouvert**, rien n’est recréé ; s’il est fermé, un nouveau ticket est créé. Si l’état du ticket ne peut pas être vérifié (réseau, droits), il est considéré comme ouvert : mieux vaut ne pas créer que dupliquer.
- **Modes** : _jamais_, _avec confirmation_ (la fenêtre montre **le contenu exact qui sera envoyé**, modifiable), _automatiquement_.
- **Rien n’est créé** sur une exécution annulée.

### GitHub

Propriétaire, dépôt, étiquettes (défaut `bug, cybermonkey`), assignés, jeton (droit _Issues : écriture_). Les étiquettes doivent exister dans le dépôt.

### Jira

Adresse, authentification (**Jira Cloud** : e-mail + jeton d’API ; **Server / Data Center** : jeton personnel en _bearer_), clé du projet, type de ticket, étiquettes, et des **champs supplémentaires** en JSON, identiques pour tous les tickets :

```json
{ "customfield_10010": "Mobile", "components": [{ "name": "App" }] }
```

La description utilise le balisage wiki de Jira (API v2, valable pour Cloud et Server). Case _Joindre la capture d’écran_ : la capture du premier pas en échec est jointe au ticket.

### Faire rédiger le ticket par l’IA

Vos champs Jira personnalisés (`customfield_NNNNN`) sont propres à votre instance : Cybermonkey ne peut pas les deviner. Plutôt que de coder des cas particuliers, vous les **décrivez en texte libre** et l’IA rédige le ticket :

1. Cochez _Faire rédiger le ticket par l’IA_.
2. Dans **Instructions pour l’IA**, écrivez comment remplir les champs, vos règles de rédaction, et si possible collez **un exemple de création en `curl`** : l’IA en imite les noms de champs et la forme des valeurs.

   ```text
   Titre court en français, préfixé par [Mobile].
   Le champ customfield_10201 (« Équipe ») vaut {"value": "Mobile QA"}.
   La priorité est « High » si le parcours est un achat ou une connexion.

   curl -X POST $JIRA/rest/api/2/issue -d '{"fields": {"project": {"key": "APP"},
     "issuetype": {"name": "Bug"}, "summary": "…", "customfield_10201": {"value": "Mobile QA"}}}'
   ```

**Ce que l’IA reçoit** : ce texte, le contexte de la régression (étapes, messages d’erreur, historique, analyse, avec les secrets masqués) et un brouillon par défaut. **Ce qu’elle ne fait pas** : elle n’exécute rien, n’a pas accès à votre jeton et n’appelle pas Jira. C’est **Cybermonkey** qui envoie la requête, après avoir validé la réponse :

- elle ne peut renseigner que `summary`, `description`, `labels`, `components`, `priority`, `assignee`, `fixVersions`, `versions`, `environment`, `duedate` et les `customfield_*` ; tout autre champ est **refusé** et signalé dans l’activité ;
- le **projet**, le **type de ticket** et le **rapporteur** viennent toujours de vos réglages, jamais de l’IA ;
- l’ordre de priorité des champs est : réglages fixes < champs supplémentaires JSON < champs écrits par l’IA ;
- si l’IA échoue (quota, réponse invalide), le ticket est créé avec le **brouillon par défaut** et l’activité le signale.

> **Choisir un « skill » local** n’est pas pris en charge : les instructions en texte libre couvrent le besoin sans dépendre de ce que vous avez installé sur la machine.

Le bouton **Tester** vérifie le jeton et l’existence du projet (Jira : `GET /myself` et `/project/<clé>`, GitHub : accès au dépôt et tickets activés) sans rien créer.

## Activité récente

Le bas de l’onglet liste ce que les intégrations ont fait récemment (envoyé, refusé, ignoré, erreur) : un envoi silencieusement raté ne reste pas un mystère. Les 50 dernières entrées sont gardées en mémoire.

## En ligne de commande (CI/CD)

`cybermonkey run` déclenche les mêmes notifications, envois vers les outils de test et créations de tickets à la fin de l’exécution, et **attend leur fin avant de quitter** ; leur résultat s’affiche dans la sortie (`↗` ok, `⚠` échec). Sans fenêtre pour répondre :

- le mode **« avec confirmation » est ignoré** (indiqué dans l’activité) : choisissez **« automatiquement »** pour un pipeline ;
- **Git est désactivé** ;
- fournissez les secrets par **variables d’environnement** (voir plus haut) : la machine de test les lit sans passer par l’application.

Un échec d’intégration n’influence **pas** le code de sortie : celui-ci ne dépend que des tests (voir [cli.md](cli.md)).

## Limites connues

- Squash TM n’est pas pris en charge (API de résultats non vérifiée).
- Les connecteurs TestRail et Azure Test Plans n’ont pas été éprouvés sur une instance réelle.
- Slack et Teams : texte seulement, pas de captures ni de vidéos.
- Les messages de l’« activité récente » et des erreurs sont en français ; les fenêtres de confirmation, elles, suivent la langue de l’application.
- Pas de « skill » local, pas de création de tickets pour autre chose qu’une régression, pas de commentaire sur un ticket existant.
