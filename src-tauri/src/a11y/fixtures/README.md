# Fixtures de l'audit d'accessibilité

Captures réelles (hiérarchie UI + capture d'écran) utilisées par `a11y/fixtures_test.rs`.

## iOS

| Fichier | Source | Appareil | Ce qu'on y vérifie |
|---|---|---|---|
| `ios/settings-home.{json,png}` | App Réglages, écran d'accueil (sans compte Apple connecté) | Simulateur iPhone 17 Pro, iOS 26.1, 402 × 874 pt (@3x) | Champ de recherche avec placeholder (R1). Conteneur `Application` exclu du contraste. Bouton coupé par le bord de l'écran exclu de B1. |
| `ios/settings-display-text-size.{json,png}` | Réglages › Accessibilité › Affichage et taille du texte | idem | 13 interrupteurs (`elementType` 40, valeur « 0 ») qui exposent leur état (R3). Interrupteurs internes sans libellé imbriqués dans la ligne libellée, non signalés (R1). Gris secondaire iOS #8A8A8E sur blanc ≈ 3,4:1 (R4). |

Capturées le 2026-11-25 avec Maestro CLI 2.12.1 :
- `POST /viewHierarchy` (body `{"appIds":["com.apple.Preferences"],"excludeKeyboardElements":false}`) pour le JSON ;
- `GET /screenshot` pour le PNG, sur le port du runner XCTest.

Aucune donnée personnelle (simulateur vierge).

## Android

Des vrais écrans Android capturés sur émulateur pour MD-40. Pour chaque écran il y a deux fichiers, rangés par app :

- `android/<app>/<ecran>.json` : la hiérarchie sortie par `maestro hierarchy`, lue avec `hierarchy::parse_maestro_json`
- `android/<app>/<ecran>.png` : la capture du même écran (`adb exec-out screencap -p`)

Les tests sont dans `mod android` de `fixtures_test.rs`.

### Appareil

Tout a été capturé le 25/11/2026 sur le même émulateur :

| | |
|---|---|
| Appareil | Émulateur Android 15 (API 35, Google APIs x86_64), profil Pixel 7 |
| Résolution | 1080 x 2400 px |
| Densité | 420 dpi, donc 2,625 px par dp |
| Langue | fr-FR |
| Barre d'état | mode démo (10:00, batterie pleine, pas de notifs) |
| Animations | coupées |
| Maestro | 2.12.1 |

Aucun compte connecté, donc pas de données perso.

Pour refaire ou ajouter une capture (marche aussi sur un vrai téléphone) :

```bash
scripts/a11y-capture-fixture.sh <app> <ecran>
```

### Les écrans

| Fixture | Contenu |
|---|---|
| `sample-app/signin` | Connexion : titre, champ e-mail avec indice, bouton |
| `sample-app/welcome` | Pareil après « Sign in » |
| `a11y-bad-app/home` | Accueil : barre du haut, bandeau promo, onglets en icônes, bouton flottant |
| `a11y-bad-app/form` | Formulaire de virement : champs, message d'erreur, cases à cocher, boutons |
| `a11y-bad-app/list` | Liste d'opérations avec un bouton « Voir » et une corbeille par ligne |
| `a11y-bad-app/toggles` | Préférences : interrupteurs, case à cocher, étoile favori |
| `a11y-bad-app/account` | Compte : au moins un défaut par règle |
| `settings/home` | Paramètres, liste principale |
| `settings/display` | Paramètres > Écran, avec l'interrupteur « Thème sombre » |
| `settings/accessibility` | Paramètres > Accessibilité |
| `clock/alarms` | Horloge en thème sombre, alarmes avec interrupteurs |
| `wikipedia/onboarding` | Premier écran de Wikipedia |
| `wikipedia/interests` | Choix des centres d'intérêt |
| `wikipedia/explore` | Fil d'actu avec « Les plus lus » |
| `wikipedia/widget-dialog` | Fenêtre du bas « Une méthode de recherche plus rapide » |
| `wikipedia/search-results` | Résultats de recherche |
| `wikipedia/article` | Article « Accessibilité numérique » |
| `wikipedia/settings` | Paramètres de Wikipedia |

#### Pourquoi ces apps

- `sample-app` c'est l'app de démo de Maestro Deck, le cas propre. Elle n'a qu'un écran donc juste deux captures.
- `a11y-bad-app` c'est une petite app qu'on a faite exprès mal accessible (dossier `a11y-bad-app/` à la racine, même build que `sample-app/`). Comme on a mis les fautes nous-mêmes, on sait ce que l'audit doit trouver. Les fautes sont commentées dans chaque `res/layout/<ecran>.xml`. Pour ouvrir un écran : `adb shell am start -n com.maestrodeck.a11ybad/.MainActivity --es screen <ecran>`.
- Wikipedia vient des exemples officiels de Maestro (`maestro download-samples`, `wikipedia.apk`), version `r/50606-r-2026-09-09`, licence Apache 2.0. On garde que les captures, pas l'APK. Le fil montre le contenu public du jour de la capture.
- Paramètres et Horloge sont déjà sur tous les émulateurs, donc faciles à refaire.

Les vraies apps servent à voir comment les règles réagissent sur des écrans qu'on n'a pas écrits, et c'est là qu'on trouve les faux positifs.

### Ce que l'audit doit trouver sur `a11y-bad-app`

La liste exacte est dans `fixtures_test.rs` (`BAD_APP_EXPECTED` et les tests par règle).

| Écran | R1 | R2 | R3 | R4 | B1 |
|---|---|---|---|---|---|
| `home` | menu et 3 onglets sans libellé | rien | rien | blanc sur jaune | bouton flottant de 32 dp |
| `form` | 2 champs sans libellé ni indice | 2 boutons « OK » | rien | erreur rouge pâle | case de 20 dp |
| `list` | 4 corbeilles sans libellé | 4 boutons « Voir » | rien | date gris clair | rien |
| `toggles` | étoile cliquable sans libellé | rien | « Alertes de paiement » cache son état | légende gris clair | interrupteur de 32 dp |
| `account` | bouton fermer, champ nom, carte photo | 2 « Supprimer » et « Bouton valider » | « Notifications » cache son état | texte `#BDBDBD` | 2 champs de 45 dp, bouton aide de 24 dp |

Les cases à cocher utilisent un dessin fixe (`checkbox_on/off_background`) parce que celle par défaut ne s'affichait pas sur l'émulateur.

### Couverture par règle

| Règle | Écrans où ça échoue | Écrans où ça passe |
|---|---|---|
| R1 | les 5 écrans de `a11y-bad-app`, `wikipedia/article` | `sample-app/signin`, `settings/home`, `clock/alarms`, `wikipedia/onboarding`, `wikipedia/search-results` |
| R2 | `a11y-bad-app/form`, `list`, `account` | `sample-app/signin`, `settings/home`, `settings/display`, `wikipedia/article`, `wikipedia/settings` |
| R3 | aucun détecté (voir plus bas, test en `#[ignore]`) | `wikipedia/interests`, `a11y-bad-app/form`, `a11y-bad-app/toggles` |
| R4 | `a11y-bad-app/account` et les autres écrans de `a11y-bad-app` | `settings/home`, `settings/accessibility`, `clock/alarms`, texte foncé de `a11y-bad-app/account` |
| B1 | `a11y-bad-app/home`, `form`, `toggles`, `account`, `wikipedia/article` | `settings/home`, `settings/accessibility`, `wikipedia/widget-dialog`, `wikipedia/settings` |

### Problèmes trouvés

On a rien corrigé dans les règles, c'est à voir avec Dayss sur MD-38.

1. **R3 voit pas un interrupteur qui cache son état.** `maestro hierarchy` ne donne pas `checkable` et remplit toujours `checked`, donc les deux interrupteurs cassés de `a11y-bad-app` passent.
2. **R4 sur les boutons gris.** La zone du bouton contient la marge blanche autour, prise pour la couleur du texte. « SIGN IN » sort à 1,38:1 alors que c'est du `#1C1C1C` sur `#D6D7D7`, donc 11,8:1. Pareil pour « COMMENCER », « OK » et « VALIDER » dans `a11y-bad-app`.
3. **R4 sur la barre d'état.** Sur `wikipedia/widget-dialog` l'heure « 10:00 » sous le fond gris est signalée. Le JSON de Maestro ne donne pas `package`, donc `is_system_ui` reconnaît pas la barre d'état.
4. **R4 sur le texte d'un interrupteur.** « Sons » dans `a11y-bad-app/toggles` sort en `#ECECEC` sur blanc, c'est la couleur du rail de l'interrupteur et pas celle du texte.
5. **Éléments coupés au bord de l'écran.** Sur `settings/display` la dernière ligne cachée par la barre de navigation fait 11 dp visibles. Sur `wikipedia/explore` un élément fait 1 px de haut. R1 les signale, et B1 aussi pour la ligne de 11 dp (le filtre ignore seulement en dessous de 8 dp).
6. **R2 cherche « bouton » seulement dans `content-desc`.** La spec dit dans le libellé, donc un texte visible « Bouton Valider » passe.
7. **R1 ignore `important-for-accessibility="false"`.** Le fond gris derrière la fenêtre de `wikipedia/widget-dialog` est exclu de l'accessibilité par l'app mais R1 le signale quand même.
8. **B1 signale les liens dans le texte** (« matériel », « logiciel » dans `wikipedia/article`). WCAG 2.5.8 ne compte pas les liens dans une phrase.
9. **Arrondi dans le message de B1.** Le bouton de `wikipedia/onboarding` fait 47,6 dp et le message dit « 48x48 dp, minimum 48x48 dp ».
10. **À voir ensemble.** Ces cas respectent les règles telles qu'elles sont écrites, mais c'est discutable :
    - `clock/alarms` : deux cartes lues « Alarme » (R2) et une icône de 40 x 48 dp (B1)
    - `wikipedia/explore` et `wikipedia/interests` : textes gris à 4,48:1 pour 4,5 demandé (R4), c'est à la limite de l'estimation
    - `wikipedia/search-results` : le champ de recherche fait 36 dp mais il est dans une zone cliquable avec un libellé, donc B1 le compte plus

## Voir le rapport complet

```bash
cargo test --lib a11y::fixtures_test::print_reports -- --ignored --nocapture
cargo test --lib a11y::fixtures_test::android::print_reports -- --ignored --nocapture
```
