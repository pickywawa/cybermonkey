# Appareils distants et fermes de devices

Cybermonkey peut tester des téléphones **qui ne sont pas branchés à la machine** : un téléphone Android joint par le réseau (`adb`), un **cloud d’appareils** (BrowserStack, Sauce Labs, AWS Device Farm), ou **votre propre serveur Appium** (un labo de devices).

_Réglages → Appareils → Appareils distants et cloud_, et en [ligne de commande](cli.md) pour la CI/CD.

| Cible                            | Comment c’est piloté                                                                     | Ce qui marche comme en local                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **ADB sur le réseau** (Android)  | `adb connect hôte:port` : le téléphone apparaît dans `adb devices` comme un appareil USB | tout : miroir, installation, journal, vidéo, liste des applications |
| **BrowserStack App Automate**    | une session sur leur serveur Appium, avec votre application envoyée chez eux             | exécutions, exploration IA, enregistrement, captures                |
| **Sauce Labs** (appareils réels) | idem                                                                                     | idem                                                                |
| **AWS Device Farm**              | une _session d’accès distant_ qui expose un endpoint Appium                              | idem                                                                |
| **Votre serveur Appium**         | une session sur votre serveur (qui voit les téléphones)                                  | idem, l’application doit déjà y être installée                      |

## Ce qui change avec un appareil cloud

Un appareil cloud n’est **pas branché ici** : c’est un _profil_ (« Pixel 8 sur BrowserStack ») qui devient un appareil du panneau Appareils, associable à un projet comme les autres. Trois conséquences :

- **La session démarre seulement quand elle sert** : pendant une exécution, une exploration IA ou un enregistrement. Elle est **facturée par le fournisseur à la minute**, donc elle se **termine avec l’exécution** (ou l’exploration, l’enregistrement). Une session ouverte à la main (« Reconnecter ») est fermée après N minutes d’inactivité (défaut 5, réglable). À la fermeture de l’application, tout est rendu au fournisseur.
- **Pas de miroir hors session** : l’écran n’est visible que pendant une session. Hors session, le panneau le dit au lieu d’ouvrir une session facturée.
- **Pas de liste des applications** de l’appareil (elle passe par `adb`) : saisissez l’identifiant de l’application dans les réglages du projet. Le journal et la vidéo de l’appareil sont demandés au serveur Appium en _meilleur effort_ : s’ils ne sont pas disponibles, l’exécution continue.

Une même exécution peut mélanger local et cloud, et jouer Android et iOS **en parallèle** (un appareil par OS).

## ADB sur le réseau

Un téléphone Android par ligne, au format `hôte:port` (port 5555 par défaut). Cybermonkey lance `adb connect` pour chaque hôte non connecté, **en arrière-plan** (jamais plus d’une tentative toutes les 20 s, sans ralentir la détection), tant que l’application est ouverte. Un hôte injoignable s’affiche **hors ligne avec la raison**.

- **Android 11 et plus** : _Options pour les développeurs → Débogage sans fil_. Appairez **une fois** (adresse et code d’appairage affichés sur le téléphone ; formulaire « Appairer » de l’onglet, ou `cybermonkey remote adb-pair hôte:port code`), puis ajoutez l’adresse de _connexion_ (port différent de celui d’appairage).
- **Avant** : `adb tcpip 5555` une fois en USB, puis l’adresse IP du téléphone.
- « Autorisez » la connexion sur le téléphone (« Toujours autoriser ») : l’état « à autoriser » le rappelle.

Un serveur adb distant (`ADB_SERVER_SOCKET`) n’est pas géré : seuls les téléphones joints par `adb connect` le sont.

## BrowserStack

Nom d’utilisateur, **clé d’accès** (secret), version d’Appium (facultatif). Les sessions s’ouvrent sur `hub-cloud.browserstack.com/wd/hub`. Dans le profil : **modèle** (« Samsung Galaxy S23 ») et **version de l’OS** (« 13.0 »).

**Application** : envoyez un `.apk` / `.ipa` (bouton « Envoyer un fichier… », ou `remote upload`). BrowserStack renvoie une référence `bs://…`, **conservée 30 jours** par défaut : renvoyez le fichier au besoin. Le test de session n’aboutit pas tant qu’aucune application n’a été envoyée (message explicite).

Le tunnel _BrowserStack Local_ (tester une préprod interne) n’est pas géré.

## Sauce Labs

Nom d’utilisateur, **clé d’accès**, **région** (`us-west-1`, `eu-central-1`, `us-east-4`), version d’Appium (facultatif). Profil : modèle (une expression régulière est acceptée par Sauce, par exemple `Samsung.*`) et version de l’OS. L’application est envoyée dans le stockage Sauce (référence `storage:…`).

## AWS Device Farm

Identifiant de clé d’accès AWS, **clé secrète**, **ARN du projet** Device Farm. Variable `AWS_SESSION_TOKEN` prise en compte pour des identifiants temporaires. Le service n’existe que dans la région **us-west-2**.

Fonctionnement (documentation « Appium endpoint » de Device Farm) : Cybermonkey crée une **session d’accès distant** sur l’appareil du profil (son **ARN**), attend qu’elle soit `RUNNING` (jusqu’à 6 minutes), lit `remoteDriverEndpoint`, ouvre sa session Appium sur cette adresse, et **arrête** la session d’accès distant à la fin. Les appels AWS sont signés en SigV4 par Cybermonkey, sans SDK. Limites du service : 150 minutes par session, **5 minutes d’inactivité** maximum.

**Application** : envoyée par `CreateUpload` (le fichier part vers une URL signée), puis installée à la création de la session ; la référence est l’ARN de l’envoi.

## Votre propre serveur Appium

Adresse (`https://labo:4723`), authentification (aucune, utilisateur + mot de passe, ou jeton _bearer_) et le **udid** de chaque appareil dans son profil. Le serveur est supposé gérer ses pilotes (UiAutomator2, XCUITest, WebDriverAgent…) et avoir l’application déjà installée : il n’y a pas de stockage d’applications.

## Secrets

Clés d’accès, mots de passe et jetons sont stockés **à part** des réglages et du projet (chiffrés par le système quand c’est possible), comme les secrets des [intégrations](integrations.md). En CI, une variable d’environnement l’emporte :

| Secret               | Variable Cybermonkey               | Variable standard du fournisseur |
| -------------------- | ---------------------------------- | -------------------------------- |
| Clé BrowserStack     | `CYBERMONKEY_BROWSERSTACK_KEY`     | `BROWSERSTACK_ACCESS_KEY`        |
| Clé Sauce Labs       | `CYBERMONKEY_SAUCELABS_KEY`        | `SAUCE_ACCESS_KEY`               |
| Clé secrète AWS      | `CYBERMONKEY_AWS_SECRET_KEY`       | `AWS_SECRET_ACCESS_KEY`          |
| Serveur Appium perso | `CYBERMONKEY_REMOTE_APPIUM_SECRET` | —                                |

Les noms d’utilisateur se prennent dans les réglages, sinon dans `BROWSERSTACK_USERNAME`, `SAUCE_USERNAME`, `AWS_ACCESS_KEY_ID`. Les erreurs réseau masquent les clés.

Le bouton **Tester** de chaque fournisseur vérifie le compte (lecture seule, avec la configuration affichée, même non enregistrée).

## Ligne de commande (CI/CD)

```sh
# Un appareil cloud, le build est envoyé chez le fournisseur :
cybermonkey run --project "Atlas Mobile" \
  --android-device remote:pixel-8 --android-app app-debug.apk

# Même chose avec une application déjà envoyée (upload fait une fois pour tout le pipeline) :
REF=$(cybermonkey remote upload browserstack app-debug.apk)
cybermonkey run --project "Atlas Mobile" --android-device remote:pixel-8 --android-app-ref "$REF"

# Un téléphone Android sur le réseau :
cybermonkey run --project "Atlas Mobile" --adb-host 10.0.0.5:5555 --android-device android:10.0.0.5:5555 --android-app app-debug.apk
```

| Commande / option                                                 | Effet                                                                                                                                          |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `--android-device remote:<id>` / `--ios-device …`                 | Un profil cloud (l’identifiant figure dans `cybermonkey devices`), ou son nom                                                                  |
| `--android-app` / `--ios-app`                                     | Sur un appareil cloud : **envoie** le build au fournisseur au lieu de l’installer. `--fresh` est inutile (chaque session cloud démarre propre) |
| `--android-app-ref` / `--ios-app-ref`                             | Référence d’une application **déjà envoyée** (`bs://…`, `storage:…`, ARN)                                                                      |
| `--adb-host hôte:port[,…]`                                        | Connecte des téléphones Android par le réseau pour cette commande, en plus de ceux des réglages                                                |
| `remote status [--json]`                                          | Fournisseurs prêts ou incomplets, état des hôtes ADB                                                                                           |
| `remote test <fournisseur>`                                       | Vérifie les identifiants (`browserstack`, `saucelabs`, `devicefarm`, `appium`) ; code 2 si échec                                               |
| `remote upload <fournisseur> <fichier> [--platform android\|ios]` | Envoie un `.apk` / `.ipa` ; **la référence seule sur la sortie standard**                                                                      |
| `remote adb-connect [hôte:port…]`                                 | Connecte et affiche le résultat par hôte                                                                                                       |
| `remote adb-pair <hôte:port> <code>`                              | Appairage Android 11+                                                                                                                          |

Les profils (modèle, fournisseur) se **configurent dans l’application** : la ligne de commande lit les mêmes réglages. Les codes de sortie restent ceux de [cli.md](cli.md) : une session cloud qui ne s’ouvre pas (identifiants refusés, appareil indisponible, application absente) est une **erreur d’infrastructure (2)**, jamais un échec de test (1). À la fin (et sur Ctrl+C), les sessions cloud sont **rendues au fournisseur** avant de quitter. Si le processus est tué brutalement, le fournisseur les clôt de lui-même à leur délai d’inactivité.

## Ce qui n’est pas vérifié, et ce qui manque

- **Aucun compte réel n’a été utilisé.** Les URL, capacités et appels viennent de la documentation des fournisseurs et sont vérifiés contre des serveurs simulés. Seule la **signature AWS SigV4** est comparée à l’exemple publié par AWS. Utilisez le bouton **Tester**, puis une exécution d’un seul scénario, avant de vous y fier.
- Les vérifications de compte **BrowserStack** (`plan.json`) et **Sauce Labs** (`/rest/v1/users/<nom>`) ne sont pas confirmées par la documentation consultée : un « Tester » en échec n’empêche pas forcément d’ouvrir une session.
- Device Farm : le nom du paramètre qui joint l’application à la création de session (`appArn`) suit la formulation de la documentation, sans l’avoir exécuté.
- **Pas de catalogue d’appareils** : le modèle et la version se saisissent à la main, tels que le fournisseur les nomme.
- Pas de tunnel (BrowserStack Local, Sauce Connect), pas d’hôte iOS distant piloté en `devicectl`, pas de serveur adb distant.
- Une application iOS pour un appareil cloud doit être un **`.ipa` signé pour appareil réel**, pas un `.app` de simulateur.
- Les messages du fournisseur (refus, indisponibilité) sont affichés tels quels.
