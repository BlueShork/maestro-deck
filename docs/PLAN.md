# StageHand — Plan de projet complet

Version: 0.1 — Plan initial pour exécution par agents
Auteur: Ethan Morisset
Date: 2026-04-23

---

## 1. Vision du produit

StageHand est un **IDE visuel open source pour créer des tests Maestro**. Il remplace Maestro Studio pour les équipes QA qui veulent :

- Pas de login, pas de compte, pas de télémétrie
- Un outil rapide et léger (démarrage < 1s, RAM < 100 MB)
- 100% offline, auditable, open source (Apache 2.0)
- Fonctionne sur macOS, Linux, Windows

**Scope v0.1** : Android uniquement, device physique USB uniquement, single device.

**Non-goals v0.1** :
- iOS (reporté v0.2+)
- Simulateurs/émulateurs (reporté v0.2)
- Multi-device (reporté v1.0)
- Record mode (reporté v1.0)
- Cloud execution (jamais)

---

## 2. Stack technique imposée

### Backend (process natif)
- **Rust** (edition 2021)
- **Tauri 2.x** comme framework d'app desktop
- **tokio** pour l'async runtime
- **quick-xml** pour parser les dumps UIAutomator
- **openh264-sys2** ou **ffmpeg-next** pour décodage H.264 du stream scrcpy
- **serde + bincode** pour IPC binaire Frontend↔Backend
- **rusb** pour détection USB device
- **anyhow + thiserror** pour error handling

### Frontend (webview Tauri)
- **React 18** + **TypeScript strict mode**
- **Vite** comme build tool
- **Tailwind CSS** + **shadcn/ui** pour composants
- **Monaco Editor** pour l'éditeur YAML
- **Zustand** pour state management (pas Redux, pas Context API pour le state global)
- **Lucide React** pour les icônes

### Dépendances externes embarquées
- **scrcpy-server.jar** (bundle dans les resources Tauri)
- **adb binary** (optionnel : on peut demander à l'utilisateur de l'avoir dans PATH)
- **maestro-runner** (spawn en sous-process, doit être dans PATH ou configurable)

### Raisons des choix (non négociables)

**Pourquoi Tauri et pas Electron** : streaming vidéo H.264 60fps avec latence <50ms impose du natif. Electron + WASM/JS decode ne tient pas la cible. Tauri permet des bindings Rust natifs directs vers les decoders vidéo.

**Pourquoi Rust et pas Go** : Tauri est en Rust nativement. Passer par Go ajouterait une couche FFI inutile. Les libs ADB/scrcpy/XML en Rust sont matures.

**Pourquoi pas de polling hierarchy** : `uiautomator dump` coûte 200-500ms par appel. On ne peut pas faire ça à 60fps. Stratégie : mode inspect à la demande avec freeze-frame.

---

## 3. Architecture détaillée

```
┌─────────────────────────────────────────────────┐
│ Frontend (React + TS dans webview Tauri)        │
│                                                 │
│ Modules :                                       │
│ - <DeviceView/>      : canvas de streaming      │
│ - <InspectorPanel/>  : arbre hiérarchie + props │
│ - <FlowEditor/>      : Monaco editor YAML       │
│ - <RunConsole/>      : logs de maestro-runner   │
│ - <DeviceSelector/>  : sélection device ADB     │
│                                                 │
│ State (Zustand) :                               │
│ - deviceStore : device connecté, résolution     │
│ - streamStore : frame courante, fps             │
│ - inspectorStore : mode inspect on/off, élément │
│ - flowStore     : YAML courant, curseur         │
│ - runStore      : état exécution, logs          │
└──────────────────┬──────────────────────────────┘
                   │ Tauri invoke / events
┌──────────────────▼──────────────────────────────┐
│ Backend Rust                                    │
│                                                 │
│ Modules :                                       │
│ - device/       : détection ADB, liste devices  │
│ - scrcpy/       : push server + TCP stream      │
│ - video/        : décodage H.264 → frames RGB   │
│ - input/        : forward clics/keys via scrcpy │
│ - hierarchy/    : dump UI + parsing XML         │
│ - selector/     : mapping clic → élément + gen  │
│ - yaml/         : génération commandes Maestro  │
│ - runner/       : spawn maestro-runner + logs   │
│ - ipc/          : commandes Tauri exposées      │
└─────────────────────────────────────────────────┘
                   │
                   ▼ USB
              Device Android
```

### Flux critiques

**Flux 1 : Démarrage et connexion device**
1. Frontend appelle `invoke("list_devices")`
2. Backend Rust exécute `adb devices -l`, parse la sortie
3. Frontend affiche la liste, utilisateur sélectionne
4. Frontend appelle `invoke("connect_device", {serial})`
5. Backend push scrcpy-server.jar sur le device via ADB
6. Backend lance scrcpy-server via `adb shell`, ouvre tunnel TCP localhost
7. Backend commence à recevoir le stream H.264
8. Backend décode les frames et les pousse au frontend via Tauri events

**Flux 2 : Streaming vidéo temps réel**
1. Backend reçoit paquets H.264 sur le socket scrcpy
2. Décodage H.264 → frame RGBA en mémoire
3. Frame envoyée au frontend via `emit("frame", &bytes)` (binaire, pas JSON)
4. Frontend reçoit via `listen("frame")`, push dans un `<canvas>` via `putImageData`
5. Cible : 60fps, latence totale <50ms

**Flux 3 : Inspection d'un élément**
1. Utilisateur active le mode inspect (touche I ou bouton)
2. Frontend appelle `invoke("enter_inspect_mode")`
3. Backend met le stream en pause (freeze frame en haut de la frontend)
4. Backend exécute `adb shell uiautomator dump`
5. Backend pull le XML, parse avec quick-xml, construit l'arbre
6. Backend construit un R-tree spatial pour lookup rapide
7. Frontend reçoit l'arbre, affiche dans `<InspectorPanel/>`
8. Quand user clique sur le device view → `invoke("query_element", {x, y})`
9. Backend query R-tree en O(log n), renvoie l'élément leaf le plus profond
10. Frontend affiche les propriétés et les sélecteurs candidats

**Flux 4 : Génération YAML**
1. Utilisateur clique sur un élément en mode inspect
2. Frontend reçoit les sélecteurs candidats triés par robustesse :
   - `resource-id` si présent et unique
   - `text` si présent et unique
   - `content-desc` (accessibility)
   - Fallback `point: "x%, y%"` (coords normalisées)
3. Utilisateur choisit une action (`tapOn`, `inputText`, `assertVisible`)
4. Frontend appelle `invoke("generate_command", {action, selector})`
5. Backend renvoie la string YAML à insérer
6. Frontend insère dans Monaco à la position du curseur

**Flux 5 : Exécution du flow**
1. Utilisateur clique Run
2. Frontend sauvegarde le YAML courant dans un fichier temp
3. Frontend appelle `invoke("run_flow", {file_path})`
4. Backend spawn `maestro-runner test <file>` en sous-process
5. Backend streame stdout/stderr au frontend via events
6. Frontend affiche les logs en live dans `<RunConsole/>`
7. À la fin, backend émet un event avec le code de retour

---

## 4. Breakdown en tâches pour les agents

### Phase 0 — Setup (1-2 jours)

**Agent : Architect**
- [ ] Créer le repo GitHub `stagehand` (privé dans un premier temps)
- [ ] Licence Apache 2.0
- [ ] README initial avec la vision et le scope v0.1
- [ ] .gitignore, .editorconfig, configuration Prettier + rustfmt
- [ ] GitHub Actions de base : lint Rust (clippy), lint TS (eslint), build sur 3 OS

**Agent : Developer**
- [ ] `pnpm create tauri-app` avec template React + TypeScript
- [ ] Structure monorepo : `src/` (frontend), `src-tauri/` (backend)
- [ ] Installer deps frontend : Tailwind, shadcn/ui, Zustand, Monaco, Lucide
- [ ] Installer deps Rust : tokio, quick-xml, serde, bincode, anyhow, thiserror
- [ ] Vérifier que l'app lance un "Hello World" sur les 3 OS

### Phase 1 — ADB bridge (3-4 jours)

**Agent : Developer**
- [ ] Module `device/` en Rust
- [ ] Fonction `list_devices()` qui exécute `adb devices -l` et parse la sortie
- [ ] Struct `Device { serial, model, android_version, screen_size }`
- [ ] Fonction `get_device_info(serial)` via `adb shell getprop`
- [ ] Fonction `exec_shell(serial, cmd)` générique
- [ ] Tauri command `list_devices()` exposée au frontend
- [ ] UI frontend : `<DeviceSelector/>` qui liste les devices, permet refresh
- [ ] Gestion des erreurs : ADB pas dans PATH, pas de device, device non autorisé

**Agent : Tester**
- [ ] Tests unitaires sur le parser de sortie `adb devices`
- [ ] Test d'intégration avec un device réel (Ethan a son Samsung ou Android de test)
- [ ] Test du cas "ADB introuvable" → message d'erreur explicite

**Agent : Verifier**
- [ ] Vérifier que le code compile sur macOS, Linux, Windows (via GitHub Actions)
- [ ] Vérifier gestion d'erreur propre (pas de `.unwrap()` dans les paths critiques)
- [ ] Review : l'API Tauri commands est-elle stable et bien typée ?

### Phase 2 — scrcpy integration (5-7 jours)

C'est la phase la plus risquée techniquement. Allouer du buffer temps.

**Agent : Architect**
- [ ] Étudier le protocole scrcpy-server en détail : https://github.com/Genymobile/scrcpy/blob/master/doc/develop.md
- [ ] Identifier la version de scrcpy-server.jar à bundler (dernière stable)
- [ ] Documenter le format du stream vidéo (H.264 Annex-B NAL units)

**Agent : Developer**
- [ ] Module `scrcpy/` en Rust
- [ ] Fonction `push_server(serial)` qui fait `adb push scrcpy-server.jar /data/local/tmp/`
- [ ] Fonction `start_server(serial, options)` qui fait `adb shell app_process ...`
- [ ] Fonction `create_tunnel(serial, port)` : `adb forward tcp:27183 localabstract:scrcpy`
- [ ] Connexion TCP au tunnel, réception des paquets vidéo
- [ ] Bundler scrcpy-server.jar dans les resources Tauri
- [ ] Module `video/` en Rust : décodage H.264 avec openh264-sys2
- [ ] Envoi des frames décodées au frontend via Tauri events
- [ ] Frontend : `<DeviceView/>` avec `<canvas>` qui affiche les frames
- [ ] Mesurer les FPS et la latence, afficher en dev mode

**Agent : Tester**
- [ ] Benchmark FPS sur un device physique
- [ ] Test de stabilité : laisser tourner 30 min, vérifier pas de memory leak
- [ ] Test avec différents devices (résolutions, versions Android)

**Agent : Verifier**
- [ ] Latence input→affichage mesurée et <50ms ? Sinon investiguer
- [ ] FPS moyen >= 55 ? Sinon optimiser
- [ ] Code review de la partie unsafe Rust si openh264 en impose

### Phase 3 — Input forwarding (2-3 jours)

**Agent : Developer**
- [ ] Module `input/` en Rust
- [ ] Protocole control de scrcpy pour envoyer des événements tactiles
- [ ] Fonction `send_tap(x, y)` avec coords normalisées
- [ ] Fonction `send_swipe(x1, y1, x2, y2, duration)`
- [ ] Fonction `send_text(text)` pour inputText
- [ ] Fonction `send_key(keycode)` pour back, home, etc.
- [ ] Frontend : capture des événements souris/clavier sur le canvas
- [ ] Conversion coords canvas → coords device (gestion du scale factor)
- [ ] Tauri command `send_input(event)`

**Agent : Tester**
- [ ] Test : cliquer sur un bouton dans l'app Bouygues Telecom → le bouton réagit
- [ ] Test : taper du texte dans un input → le texte apparaît
- [ ] Test : latence clic → action device <30ms

### Phase 4 — UI Hierarchy + Inspector (4-5 jours)

**Agent : Developer**
- [ ] Module `hierarchy/` en Rust
- [ ] Fonction `dump_hierarchy(serial)` : `adb shell uiautomator dump` puis `adb pull`
- [ ] Parser XML avec quick-xml, construction d'un arbre de nodes
- [ ] Struct `UINode { id, text, desc, class, bounds, children, parent }`
- [ ] Module `selector/` avec R-tree spatial (crate `rstar`)
- [ ] Fonction `find_element_at(x, y) -> Option<UINode>`
- [ ] Fonction `suggest_selectors(node) -> Vec<Selector>`
- [ ] Frontend : `<InspectorPanel/>` avec arbre collapsible de la hiérarchie
- [ ] Frontend : overlay sur le canvas montrant les bounds de l'élément hovered
- [ ] Mode inspect ON/OFF (toggle avec touche I)
- [ ] Quand inspect ON : freeze frame sur la dernière image, dump hierarchy

**Agent : Tester**
- [ ] Test sur app native Android (Settings)
- [ ] Test sur app React Native (Bouygues Telecom)
- [ ] Test sur app Flutter (trouver une app de test)
- [ ] Benchmark : dump + parse + R-tree build < 600ms ? Sinon optimiser

**Agent : Verifier**
- [ ] Gestion correcte des hiérarchies imbriquées profondes
- [ ] Gestion des éléments sans id/text (fallback coordonnées)
- [ ] Pas de memory leak après 100 dumps successifs

### Phase 5 — YAML generation + Monaco (3 jours)

**Agent : Developer**
- [ ] Module `yaml/` en Rust
- [ ] Fonction `generate_command(action, selector) -> String`
- [ ] Support des commandes : launchApp, tapOn, inputText, assertVisible, assertNotVisible, scroll, scrollUntilVisible, back, hideKeyboard, pressKey, waitForAnimationToEnd
- [ ] Frontend : intégration Monaco Editor
- [ ] Syntax highlighting YAML + snippets Maestro custom
- [ ] Panneau "Actions" qui propose les commandes contextuelles selon l'élément sélectionné
- [ ] Insertion à la position du curseur dans l'éditeur
- [ ] Save/Load de fichiers .yaml (dialog natif Tauri)

**Agent : Tester**
- [ ] Créer un flow complet manuellement via l'UI
- [ ] Vérifier que le YAML généré est valide syntaxiquement pour Maestro
- [ ] Tester l'exécution avec maestro-runner

### Phase 6 — Runner integration (2-3 jours)

**Agent : Developer**
- [ ] Module `runner/` en Rust
- [ ] Fonction `spawn_runner(flow_path) -> Process`
- [ ] Capture stdout/stderr, stream vers frontend
- [ ] Gestion du kill en cours d'exécution
- [ ] Frontend : `<RunConsole/>` avec logs colorés (vert/rouge selon succès)
- [ ] Bouton Run, bouton Stop
- [ ] Détection auto : maestro-runner dans PATH ? Sinon UI pour configurer le chemin
- [ ] Indicateurs visuels : ligne du YAML en cours d'exécution highlightée

**Agent : Tester**
- [ ] Test end-to-end complet : créer un flow, run, vérifier le succès
- [ ] Test avec un flow qui échoue, vérifier affichage de l'erreur
- [ ] Test stop en cours d'exécution

### Phase 7 — Polish + Packaging (4-5 jours)

**Agent : Developer**
- [ ] Design final avec Tailwind + shadcn/ui, dark mode par défaut
- [ ] Onboarding au premier lancement (explique comment brancher un device, activer debug USB)
- [ ] Settings : path de adb, path de maestro-runner, résolution stream, FPS cible
- [ ] Keyboard shortcuts : Cmd/Ctrl+R run, Cmd/Ctrl+S save, I inspect
- [ ] Gestion propre des erreurs avec toasts informatifs
- [ ] Packaging Tauri : .dmg macOS, .AppImage + .deb Linux, .msi Windows
- [ ] Code signing macOS (Ethan a un certificat Apple Developer ?)
- [ ] GitHub Actions pour build auto des releases sur tag

**Agent : Tester**
- [ ] Tester l'installation sur macOS Intel, macOS ARM, Ubuntu 22.04, Windows 11
- [ ] Vérifier que tout fonctionne sans avoir à installer de deps manuellement (à part adb)
- [ ] Taille du binaire : cible <15 MB

**Agent : Verifier**
- [ ] Le README final couvre : installation, quickstart, troubleshooting, contributing
- [ ] La licence est bien Apache 2.0 sur tous les fichiers
- [ ] Pas de credentials, secrets, ou données perso committés

### Phase 8 — Open source launch (1-2 jours)

**Agent : Architect**
- [ ] Préparer CONTRIBUTING.md et CODE_OF_CONDUCT.md
- [ ] Issues templates GitHub (bug, feature, question)
- [ ] Passer le repo public
- [ ] Créer un site statique minimal (Astro ou simple HTML sur GitHub Pages)
- [ ] Créer un Discord ou Slack pour la communauté

**Marketing (Ethan lui-même)**
- [ ] Post LinkedIn avec démo vidéo (30-60s)
- [ ] Post sur Reddit r/reactnative, r/androiddev, r/mobiledev
- [ ] Post sur Hacker News ("Show HN: StageHand — Open source Maestro Studio alternative")
- [ ] Tweet/X avec démo GIF
- [ ] Éventuellement TikTok dans la lignée de ce que tu fais pour ClideOps

---

## 5. Planning prévisionnel

| Phase | Durée | Cumul |
|---|---|---|
| 0 — Setup | 2j | 2j |
| 1 — ADB bridge | 4j | 6j |
| 2 — scrcpy integration | 7j | 13j |
| 3 — Input forwarding | 3j | 16j |
| 4 — Hierarchy + Inspector | 5j | 21j |
| 5 — YAML + Monaco | 3j | 24j |
| 6 — Runner integration | 3j | 27j |
| 7 — Polish + Packaging | 5j | 32j |
| 8 — Launch | 2j | 34j |

**Total : ~34 jours de travail effectif.**

En side project à 10h/semaine ça fait environ 4 mois calendaires pour sortir la v0.1 publique.
En full time (hypothétique) : 6-7 semaines.

---

## 6. KPIs de performance (à valider en CI)

| Métrique | Cible | Blocker si |
|---|---|---|
| Taille du binaire final | < 15 MB | > 30 MB |
| Démarrage à froid | < 1s | > 3s |
| RAM idle (app ouverte, device connecté) | < 100 MB | > 250 MB |
| RAM en streaming 60fps | < 200 MB | > 500 MB |
| Latence input→display | < 50ms | > 100ms |
| FPS streaming | 60 stable | < 45 |
| Temps dump + parse hierarchy | < 600ms | > 1200ms |
| Temps clic→action device | < 30ms | > 80ms |

À benchmarker sur un MacBook M1 et un ThinkPad récent comme baseline.

---

## 7. Risques identifiés

**Risque 1 : Décodage H.264 en Rust plus complexe que prévu**
- Probabilité : moyenne
- Impact : élevé (bloque phase 2)
- Mitigation : fallback sur WebCodecs API côté frontend (le browser decode, on envoie juste les paquets en binaire). Accepter +10-20ms de latence.

**Risque 2 : Protocole scrcpy change entre versions**
- Probabilité : faible mais récurrent
- Impact : moyen
- Mitigation : pinner une version précise de scrcpy-server.jar. Tester les mises à jour avant de bumper.

**Risque 3 : Résolutions et densités Android très variées**
- Probabilité : certaine
- Impact : moyen (bugs UX)
- Mitigation : tester sur au moins 5 devices différents (Pixel, Samsung, Xiaomi, tablette, petit écran).

**Risque 4 : Distractions (ClideOps, alternance, études, stage)**
- Probabilité : certaine
- Impact : élevé
- Mitigation : timeboxer à 10h/semaine max. Si ça dérape, assumer et repousser la v0.1. Ne pas sacrifier ClideOps.

**Risque 5 : mobile-dev-inc ouvre Maestro Studio pendant le développement**
- Probabilité : faible mais non nulle
- Impact : moyen (réduit la pertinence)
- Mitigation : garder un différenciateur clair (performance, vraiment offline, modèle communautaire). Même si ça arrive, ton projet aura de la valeur.

---

## 8. Après la v0.1

Roadmap envisagée (pas un engagement) :

**v0.2** (1-2 mois après v0.1)
- Support iOS simulateur
- Multi-device (stream plusieurs en parallèle)
- Mode record (capture des interactions automatiquement)

**v0.3**
- Support iOS device physique (WebDriverAgent integration)
- Plugin system pour étendre les commandes custom

**v1.0**
- Stable, documenté, utilisé par des vraies équipes
- Peut-être intégration AI via Claude/MCP (si ça matche la vision)

---

## 9. Notes pour les agents

- **Architect** : avant chaque phase, produire un handoff document qui détaille les décisions techniques, les interfaces entre modules, et les pièges identifiés.
- **Developer** : commits petits et atomiques, messages clairs, branches par feature.
- **Tester** : écrire les tests AVANT de considérer une phase terminée, pas après. Benchmark automatisés pour les KPIs de perf.
- **Verifier** : review stricte sur les phases 2, 3, 4 (les plus risquées). Droit de veto sur merge si un KPI blocker est rouge.

Pas de raccourci sur la qualité. Si une phase prend plus longtemps que prévu mais livre quelque chose de solide, c'est OK. Si une phase est rushée et livre du code fragile, on paie le prix 3 phases plus loin.

---

## 10. Contact

Ethan Morisset — propriétaire du projet, décideur final sur le scope et la direction.
