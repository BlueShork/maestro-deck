# Signing & Distribution macOS (hors App Store)

## 1. Créer les certificats

Dans [developer.apple.com](https://developer.apple.com) > Certificates :
- Crée un certificat **"Developer ID Application"** (pour signer les apps distribuées hors App Store)
- Télécharge-le et installe-le dans ton Keychain

## 2. Créer un App-Specific Password pour la notarisation

Sur [appleid.apple.com](https://appleid.apple.com) > Security > App-Specific Passwords :
- Génère un mot de passe dédié à la notarisation

## 3. Configurer `tauri.conf.json`

```json
{
  "bundle": {
    "macOS": {
      "signingIdentity": "Developer ID Application: Ton Nom (TEAM_ID)",
      "providerShortName": "TEAM_ID",
      "entitlements": null
    }
  }
}
```

## 4. Variables d'environnement pour la notarisation

```bash
export APPLE_ID="ton@email.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TON_TEAM_ID"
```

> Ton Team ID se trouve sur developer.apple.com > Membership.

## 5. Build + sign + notarise en une commande

```bash
npm run tauri build
```

Tauri gère automatiquement la signature et la notarisation si les variables sont définies.
