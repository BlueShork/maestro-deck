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

À ajouter (ticket MD-40) : `android/<app>/<ecran>.json` (`maestro hierarchy`) + `.png` (`adb exec-out screencap -p`), avec la densité (`adb shell wm density`).

## Voir le rapport complet

```bash
cargo test --lib a11y::fixtures_test::print_reports -- --ignored --nocapture
```
