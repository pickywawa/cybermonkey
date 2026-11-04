# Ligne de commande et CI/CD

Cybermonkey peut lancer une campagne **sans fenêtre** et rendre un **code de sortie** que Jenkins, GitHub Actions, GitLab CI ou n’importe quel orchestrateur comprend. Le moteur est le même que celui de l’application : mêmes projets, mêmes appareils associés, mêmes environnements, mêmes imprévus et mêmes rapports.

## Le principe : la CI déclenche, un poste dédié exécute

Un runner CI classique est une machine éphémère, sans téléphone ni émulateur. Cybermonkey n’y tourne donc pas. Le pipeline **construit** l’application, puis demande à une **machine de test** (un Mac ou un PC avec des appareils branchés ou des émulateurs) de l’**installer** et de **jouer la campagne**.

```
Pipeline (build de l'APK / du .app)
   │  1. publie le build
   │  2. exécute sur la machine de test :  cybermonkey run --android-app app.apk --fresh …
   ▼
Machine de test (Cybermonkey installé, appareils branchés)
   │  3. installe le build (désinstalle avant avec --fresh)
   │  4. joue la campagne sur les appareils
   │  5. écrit junit.xml / html.html / json.json
   ▼
Pipeline lit le code de sortie et publie le rapport JUnit
```

La machine de test est un **agent** Jenkins (ou un runner GitHub / GitLab auto-hébergé) portant une étiquette, par exemple `mobile-devices`. Les jobs qui ont besoin d’appareils y sont envoyés ; les autres restent sur les runners ordinaires.

## Prérequis sur la machine de test

1. **Cybermonkey installé** et lancé au moins une fois : les projets, les appareils associés, les environnements et la connexion IA sont lus dans ses données.
2. **Le projet configuré dans l’application** : scénarios, identifiants de l’application (réglages du projet), variables, environnements. La ligne de commande ne crée ni ne modifie de scénario.
3. **Android** : `adb` et un JDK (voir l’aide). **iOS** : macOS avec Xcode.
4. **Un seul processus à la fois** : fermez la fenêtre Cybermonkey avant un job, et ne lancez pas deux jobs en même temps sur les mêmes appareils. La commande n’a pas de file d’attente : c’est au pipeline de sérialiser (voir _Éviter les collisions_).

## Lancer la commande

Deux façons, même résultat.

**Application installée** (recommandé sur la machine de test) :

```sh
# macOS
/Applications/Cybermonkey.app/Contents/MacOS/Cybermonkey --cli run --project "Atlas Mobile"

# Windows
"%LOCALAPPDATA%\Programs\Cybermonkey\Cybermonkey.exe" --cli run --project "Atlas Mobile"
```

Tout ce qui suit `--cli` est la ligne de commande décrite ci-dessous. Aucune fenêtre ne s’ouvre.

**Depuis les sources** (développement, ou machine sans installation) :

```sh
npm ci && npx tsc -p tsconfig.main.json
node dist-electron/main/cli/index.js run --project "Atlas Mobile"
# ou
npm run cli -- run --project "Atlas Mobile"
```

Dans les exemples suivants, `cybermonkey` désigne l’une ou l’autre de ces commandes.

## Commandes

| Commande                        | Rôle                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `cybermonkey run [options]`     | Installe un build (facultatif), joue une campagne et écrit les rapports        |
| `cybermonkey devices [--json]`  | Liste les appareils détectés (identifiant à donner à `--android-device`, etc.) |
| `cybermonkey projects [--json]` | Liste les projets connus, leurs OS et leurs environnements                     |
| `cybermonkey --help`            | Aide complète                                                                  |

## Options de `run`

| Option                          | Effet                                                                                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--project <nom\|id>`           | Projet. Défaut : le projet actif dans l’application.                                                                                                  |
| `--env <nom\|id>`               | Environnement (recette, préprod…) **pour cette exécution seulement** : le choix de l’application n’est pas modifié.                                   |
| `--os <android\|ios\|all>`      | OS à jouer. Défaut : le choix du projet.                                                                                                              |
| `--android-device <id>`         | Appareil Android. Défaut : l’appareil associé au projet, sinon le seul appareil prêt.                                                                 |
| `--ios-device <id>`             | Appareil iOS (idem).                                                                                                                                  |
| `--android-app <fichier>`       | APK à installer avant le test.                                                                                                                        |
| `--ios-app <fichier>`           | `.app` (simulateur) ou `.ipa` (iPhone) à installer avant le test.                                                                                     |
| `--fresh`                       | Désinstalle l’application avant d’installer le build : départ sans aucune donnée. Demande l’identifiant de l’application dans les réglages du projet. |
| `--scenario <nom\|id>`          | Un seul scénario au lieu de tout le projet.                                                                                                           |
| `--campaign <libellé>`          | Nom de la campagne créée. Défaut : `CI 2026-11-04 14:30`.                                                                                             |
| `--out <dossier>`               | Dossier des rapports. Défaut : `./cybermonkey-report`.                                                                                                |
| `--format <liste>`              | `text`, `csv`, `markdown`, `confluence`, `html`, `junit`, `json`, séparés par des virgules. Défaut : `junit,html,json`.                               |
| `--artifacts`                   | Copie aussi les captures et vidéos de la campagne dans `<dossier>/campaign`.                                                                          |
| `--prepare <off\|existing\|ai>` | Accès à l’écran de départ des exécutions partielles. Défaut : `existing` (parcours connus, sans IA).                                                  |
| `--timeout <secondes>`          | Durée maximale. Défaut : 3600. À l’expiration, l’exécution est annulée (code 3).                                                                      |
| `--data-dir <dossier>`          | Données Cybermonkey à utiliser. Défaut : celles de l’application installée.                                                                           |
| `--quiet`                       | Seulement le résumé final.                                                                                                                            |

Chaque exécution crée une **nouvelle campagne** : l’historique de stabilité (« passé 8 fois sur 10 ») s’enrichit à chaque passage, et la campagne reste consultable dans l’application.

## Codes de sortie

La séparation entre « l’application est cassée » et « la machine est cassée » est le point le plus important pour une CI : une alerte de régression ne doit pas se déclencher parce qu’un téléphone s’est débranché.

| Code | Sens                                                                                                                                                                                                        |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Tous les tests ont réussi (les pas **instables** réussis sont comptés et signalés, pas masqués).                                                                                                            |
| `1`  | Au moins un test a échoué.                                                                                                                                                                                  |
| `2`  | Erreur d’usage ou d’infrastructure : option invalide, projet ou appareil introuvable, build refusé ou impossible à installer, aucun appareil associé à un OS, erreur du moteur, **rien n’a pu s’exécuter**. |
| `3`  | Délai dépassé ou exécution interrompue (Ctrl+C, SIGTERM). L’exécution en cours est annulée proprement.                                                                                                      |

Une exécution qui n’a produit **aucun** résultat n’est jamais « verte » : elle rend `2`.

## Rapports

Le dossier `--out` contient un fichier par format demandé, nommé d’après le format : `junit.xml`, `html.html`, `json.json`… Le JUnit est celui de _Résultats → Exporter_ : un `testsuite` par OS, un `testcase` par étape, les échecs avec leur message et l’analyse.

## Installer le build

L’installation se fait avant la campagne, avec les outils de la plateforme :

| Cible                         | Fichier attendu                           | Commande utilisée                                              |
| ----------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| Android (appareil, émulateur) | `.apk`                                    | `adb -s <id> install -r -t -g <apk>` (permissions accordées)   |
| Simulateur iOS                | dossier `.app` compilé pour le simulateur | `xcrun simctl install <udid> <app>`                            |
| iPhone                        | `.ipa` signé (ou `.app`)                  | `xcrun devicectl device install app --device <udid> <fichier>` |

Avec `--fresh`, l’application est d’abord désinstallée (`adb uninstall`, `simctl uninstall`, `devicectl device uninstall app`) ; une application absente n’est pas une erreur.

Conseil : en CI, préférez les **émulateurs et simulateurs** aux téléphones physiques. Ils ne se débranchent pas, ne se verrouillent pas et ne se mettent pas à jour tout seuls. Un `.aab` doit d’abord être converti en APK ; un `.ipa` signé pour un iPhone ne s’installe pas sur un simulateur.

## Exemples

### Jenkins (agent étiqueté)

```groovy
pipeline {
  agent none
  stages {
    stage('Build') {
      agent { label 'linux' }
      steps {
        sh './gradlew assembleDebug'
        stash name: 'apk', includes: 'app/build/outputs/apk/debug/app-debug.apk'
      }
    }
    stage('Tests mobiles') {
      agent { label 'mobile-devices' }
      options { lock(resource: 'mobile-devices') }   // un job à la fois sur les appareils
      steps {
        unstash 'apk'
        sh '''
          /Applications/Cybermonkey.app/Contents/MacOS/Cybermonkey --cli run \
            --project "Atlas Mobile" --env recette \
            --android-app app/build/outputs/apk/debug/app-debug.apk --fresh \
            --out reports --artifacts --timeout 1800
        '''
      }
      post {
        always {
          junit 'reports/junit.xml'
          archiveArtifacts artifacts: 'reports/**', allowEmptyArchive: true
        }
      }
    }
  }
}
```

### GitHub Actions (runner auto-hébergé)

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./gradlew assembleDebug
      - uses: actions/upload-artifact@v4
        with: { name: apk, path: app/build/outputs/apk/debug/app-debug.apk }

  mobile-tests:
    needs: build
    runs-on: [self-hosted, mobile-devices]
    concurrency: mobile-devices # un job à la fois sur les appareils
    steps:
      - uses: actions/download-artifact@v4
        with: { name: apk }
      - run: >
          /Applications/Cybermonkey.app/Contents/MacOS/Cybermonkey --cli run
          --project "Atlas Mobile" --env recette
          --android-app app-debug.apk --fresh --out reports --artifacts
      - if: always()
        uses: actions/upload-artifact@v4
        with: { name: cybermonkey-report, path: reports }
```

### GitLab CI

```yaml
mobile-tests:
  stage: test
  tags: [mobile-devices]
  resource_group: mobile-devices # un job à la fois sur les appareils
  script:
    - >
      /Applications/Cybermonkey.app/Contents/MacOS/Cybermonkey --cli run
      --project "Atlas Mobile" --env recette
      --android-app app/build/outputs/apk/debug/app-debug.apk --fresh --out reports
  artifacts:
    when: always
    paths: [reports/]
    reports:
      junit: reports/junit.xml
```

## Éviter les collisions

Un téléphone ne peut faire qu’un test à la fois, et la commande ne met pas les jobs en file. Sérialisez au niveau du pipeline : `lock` (Jenkins, plugin _Lockable Resources_), `concurrency` (GitHub Actions), `resource_group` (GitLab). Avec plusieurs appareils, utilisez un verrou par appareil et passez `--android-device` / `--ios-device`.

## Notifications, résultats et tickets en CI

À la fin de l'exécution, `cybermonkey run` déclenche aussi ce qui est configuré dans Réglages → Intégrations (notifications Slack / Teams / e-mail, envoi vers TestRail ou Azure Test Plans, tickets Jira / GitHub) et **attend leur fin avant de quitter** ; leur résultat s'affiche dans la sortie (`↗` ok, `⚠` échec). Sans fenêtre pour répondre, le mode « avec confirmation » est ignoré : choisissez « automatiquement » pour un pipeline. Les secrets se fournissent par variables d'environnement (`CYBERMONKEY_JIRA_TOKEN`, `CYBERMONKEY_SLACK_WEBHOOK`…). Un échec d'intégration ne change pas le code de sortie. Détail : [integrations.md](integrations.md).

## Appareils distants (réseau, cloud)

La commande sait aussi viser des téléphones qui ne sont pas branchés à la machine de test : un appareil **cloud** (`--android-device remote:<id>`, le build est envoyé au fournisseur par `--android-app`), un téléphone Android **sur le réseau** (`--adb-host hôte:port`), et la commande `remote` (`status`, `test`, `upload`, `adb-connect`, `adb-pair`). Détail, options et variables d'environnement : [remote-devices.md](remote-devices.md). Une session cloud qui ne s'ouvre pas est une erreur d'infrastructure (code 2) ; les sessions sont rendues au fournisseur avant de quitter.

## Ce que la ligne de commande ne fait pas (encore)

- **Pas de serveur ni de file d’attente** : la CI doit s’exécuter sur la machine de test (agent ou runner) et sérialiser elle-même.
- **Pas de création ni de modification de scénario** : tout se prépare dans l’application ou via MCP.
- **iOS sous Windows** reste impossible (voir le README).
- **Connexion IA** : les fonctions qui s’appuient sur l’IA (réparation de sélecteurs, analyse d’échec, `--prepare ai`) utilisent la connexion enregistrée dans l’application installée sur la machine. Connectez-vous-y une fois, à la main.
