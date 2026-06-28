# Banque de screenshots & détection de régression visuelle — Design

**Date :** 2026-06-29
**Statut :** Design (premier jet, local uniquement)
**Portée :** Maestro Deck, fonctionnalité locale (pas de cloud/sync pour l'instant)

## Objectif

Éviter les régressions visuelles utilisateur entre deux exécutions d'un flow Maestro.
Le principe : maintenir une **banque de screenshots de référence** (la « vérité ») par
device, et à chaque run comparer pixel par pixel les nouveaux screenshots à cette
référence. Toute divergence significative est signalée comme **régression** et soumise à
la revue de l'utilisateur, qui décide de garder la référence ou de la remplacer.

## Décisions clés (verrouillées)

| Sujet | Décision |
|-------|----------|
| Source des screenshots | Commandes `takeScreenshot: <nom>` du flow YAML ; `<nom>` = clé de matching |
| Algorithme de diff | Pixelmatch-like : seuil % de pixels changés + tolérance couleur par pixel |
| Masques / zones ignorées | **Hors scope v1** (prévu v2) |
| Sémantique du refus | Garder la banque = **régression détectée** (signal d'alerte) ; banque inchangée |
| Sémantique de l'acceptation | Remplacer = la nouvelle capture devient la vérité (écrase la banque) |
| Portée | **Tout** run d'un flow (single + Run All) |
| Clé de banque | `<model>_<W>x<H>` (modèle + résolution, sanitizé) |
| Emplacement | `<workspace>/maestro/bank/<key>/` (créer `bank/` si `maestro/` existe déjà) |
| Récupération PNG | Non invasif : CWD du runner = **dossier du flow** ; collecte des `<nom>.png` sur place |
| Implémentation diff | **Rust** (crate `image`), le front ne reçoit que verdicts + chemins |
| Banque vide (1er run) | Seed : tous les screenshots deviennent la référence, sans revue |

## Architecture

```
Run flow (single ou Run All)
        │
        ▼
[Rust] run_flow : CWD du runner = dossier du flow
        │
        ▼
Maestro exécute, écrit <nom>.png à côté du flow
        │
   runner:exit
        │
        ▼
[Rust] Comparateur de banque
   ├─ parse YAML → liste des noms takeScreenshot attendus
   ├─ résout clé device = <model>_<W>x<H>
   ├─ pour chaque <nom>.png :
   │     ├─ pas de baseline → Seed (copie dans bank/)
   │     ├─ dimensions ≠   → DimensionMismatch (flag)
   │     ├─ diff > seuil    → Changed (flag + diff.png + bbox)
   │     ├─ diff ≤ seuil    → Match
   │     └─ attendu absent  → Missing (flag)
   └─ écrit maestro/.runs/<run_id>/report.json
        │
        ▼ (event screenshot:report)
[Front] Panneau de revue (si ≥1 Changed/Missing/DimensionMismatch)
   ├─ Gauche : banque (vérité) | Droite : nouvelle + bbox encadrée
   ├─ Toggle overlay diff (rouge)
   └─ Action : « Garder la banque » | « Remplacer par la nouvelle »
        │
        ▼
[Rust] resolve_comparison(name, decision)
   ├─ Keep    → enregistre régression dans report.json
   └─ Replace → écrase bank/<key>/<nom>.png
```

## Composants

### 1. Stockage de la banque

```
<workspace>/maestro/
├── bank/
│   └── <model>_<W>x<H>/          ex: iPhone15_1179x2556/
│       ├── .bank.json            { key, model, width, height, created_at }
│       ├── login.png
│       └── home.png
└── .runs/
    └── <run_id>/
        ├── report.json           rapport de comparaison du run
        └── diffs/<nom>.png       images de diff générées (overlay rouge)
```

- Clé device = `sanitize(Device.model) + "_" + width + "x" + height`. Sanitize :
  espaces, `/`, et caractères non-alphanumériques → `_`.
- `<nom>` provient de l'argument `takeScreenshot:` (string simple ou champ `path:`).
- Création paresseuse : `mkdir -p` de `maestro/bank/<key>/` au besoin (ne touche pas à
  un `maestro/` existant au-delà d'y ajouter `bank/`).

### 2. Pipeline de capture (Rust, runner)

- `run_flow` fixe `Command.current_dir(<dossier du fichier flow>)` pour les variantes du
  runner (android, ios-sim, ios-device, web). C'est la convention Maestro standard ; les
  chemins relatifs des flows sont résolus correctement et les `takeScreenshot` atterrissent
  à côté du flow de façon déterministe.
- Parse du YAML du flow pour extraire la **liste ordonnée des noms** `takeScreenshot`
  (sert au matching et à détecter un `Missing`).
- Au `runner:exit` (code 0 ou non), collecte des `<nom>.png` attendus dans le dossier du
  flow.

### 3. Moteur de comparaison (Rust, nouveau module `src-tauri/src/bank/`)

- Décodage PNG via la crate `image`.
- Diff pixelmatch-like :
  - Si dimensions ≠ → `DimensionMismatch` immédiat.
  - Sinon, pour chaque pixel : distance couleur (YIQ ou euclidienne RGBA) au-delà d'une
    **tolérance** → pixel compté comme changé.
  - `changed_ratio = pixels_changés / total`. Si `changed_ratio > seuil` → `Changed`.
  - Génère `diffs/<nom>.png` (overlay rouge sur les pixels changés) et le **bounding box**
    englobant (x, y, w, h) pour l'encadré UI.
- Seuils par défaut configurables (constantes v1, settings plus tard) :
  - tolérance couleur ≈ 0.1 (échelle pixelmatch)
  - seuil ratio ≈ 0.001 (0.1 % des pixels)

### 4. Modèle de résultat

```rust
enum ComparisonStatus { Seeded, Match, Changed, Missing, DimensionMismatch }

struct ScreenshotComparison {
    name: String,
    status: ComparisonStatus,
    bank_path: Option<String>,
    new_path: Option<String>,
    diff_path: Option<String>,
    changed_ratio: f32,
    bbox: Option<[u32; 4]>,        // x, y, w, h
}

struct RunReport {
    run_id: String,
    flow_path: String,
    device_key: String,
    comparisons: Vec<ScreenshotComparison>,
    regressions: Vec<String>,     // noms gardés en banque (régression confirmée)
}
```

- Émis vers le front via un event Tauri (`screenshot:report`) en fin de run.
- Persisté dans `maestro/.runs/<run_id>/report.json` pour la traçabilité.

### 5. UI de revue (front React)

- Nouveau composant `ScreenshotReview` ouvert en fin de run **si** ≥1 statut
  `Changed | Missing | DimensionMismatch`.
- File d'attente si plusieurs : un screenshot à la fois.
- Layout :
  - **Gauche** : image de la banque (la vérité).
  - **Droite** : nouvelle capture, avec **bbox encadrée** sur la zone divergente.
  - Toggle overlay diff (rouge) optionnel.
- Deux actions par screenshot :
  - **Garder la banque** → `resolve_comparison(name, Keep)` : banque inchangée, régression
    enregistrée dans le rapport.
  - **Remplacer par la nouvelle** → `resolve_comparison(name, Replace)` : écrase
    `bank/<key>/<nom>.png`.
- Les statuts `Seeded` ne déclenchent pas de revue : simple bandeau « N références créées ».
- `Match` : silencieux.

### 6. Commandes IPC (Rust ↔ front)

- `run_flow` (existant) — étendu : fixe le CWD, et après l'exit déclenche la comparaison.
- `get_run_report(run_id) -> RunReport` — lire le rapport.
- `resolve_comparison(run_id, name, decision: Keep | Replace)` — applique la décision.

## Gestion des erreurs / cas limites

- **PNG manquant** alors qu'attendu (`takeScreenshot` dans le YAML mais pas de fichier) →
  statut `Missing` (le flow a peut-être échoué avant cette étape). Signalé, pas bloquant.
- **Run échoué** (exit ≠ 0) → on compare quand même les screenshots produits ; un run
  interrompu produira des `Missing`.
- **YAML non parsable** → on ne bloque pas le run ; on collecte les PNG présents par leur
  nom de fichier en best-effort, et on log un avertissement.
- **Nouvelle résolution / nouveau modèle** → nouvelle clé de banque → comportement seed
  (1er run sur ce device-type).
- **Collisions de noms** (deux `takeScreenshot: login` dans le même flow) → hors scope v1 ;
  on documente que les noms doivent être uniques par flow.

## Tests

- **Unit (Rust)** — moteur de diff : images identiques → `Match` ; 1 bloc modifié →
  `Changed` + bbox correct ; dimensions ≠ → `DimensionMismatch` ; tolérance absorbe le
  bruit anti-aliasing ; seed quand banque vide.
- **Unit (Rust)** — clé device : sanitize correct, mêmes model+résolution → même clé.
- **Unit (Rust)** — parse YAML : extraction des noms `takeScreenshot` (forme string et
  forme `path:`).
- **Intégration** — `resolve_comparison(Replace)` écrase bien le fichier banque ; `Keep`
  laisse la banque intacte et enregistre la régression.
- **Front** — `ScreenshotReview` : file de plusieurs diffs, actions Keep/Replace,
  rendu de la bbox et de l'overlay.

## Hors scope (v2+)

- Masques / zones à ignorer (horloge, barre de statut) par screenshot.
- Réglages de seuils dans l'UI Settings.
- Historique/diff entre runs au-delà de la dernière référence.
- Synchronisation cloud / partage d'équipe de la banque.
- Fallback de clé par UUID device.
```
