# Vérif banque de screenshots en CI — notes

> Doc de travail, **non commité**. La CI est indépendante de Maestro Deck :
> après `maestro test`, elle compare la banque commitée aux captures produites
> et lève un drapeau si ça diffère. Juste un script shell.

## Principe

- **Maestro Deck (local)** : les testeurs maintiennent et commitent la banque
  `maestro/bank/<device_key>/*.png` (device_key = `<model>_<WxH>`).
- **CI (Ubuntu)** : `maestro test` produit les `*.png` à côté des flows → on
  compare **banque VS produits** → exit ≠ 0 si écart. La CI n'écrit rien.

## Le script (ImageMagick, tolérance via `-fuzz`)

```bash
#!/usr/bin/env bash
# compare la banque d'un device aux captures produites par `maestro test`.
# exit 0 = tout identique · 1 = au moins un écart (drapeau levé)
set -uo pipefail

BANK="maestro/bank/$DEVICE_KEY"   # dossier du device utilisé par la CI
PRODUCED="maestro"                # là où maestro dépose les png (à côté des flows)
OUT="bank-report"; mkdir -p "$OUT"
FUZZ="2%"                         # tolérance couleur (anti-aliasing / micro-rendu)

fail=0
for ref in "$BANK"/*.png; do
  name=$(basename "$ref")
  new=$(find "$PRODUCED" -name "$name" -not -path "$BANK/*" | head -n1)

  if [ -z "$new" ]; then
    echo "✖ $name  MISSING (capture absente)"; fail=1; continue
  fi

  # -metric AE = nb de pixels différents (au-delà du fuzz). 0 = identique.
  diff=$(compare -metric AE -fuzz "$FUZZ" "$ref" "$new" "$OUT/diff_$name" 2>&1)
  if [ "$diff" = "0" ]; then
    echo "✔ $name  match"
  else
    echo "✖ $name  CHANGED ($diff px)"; fail=1
  fi
done

[ "$fail" -eq 0 ] && echo "OK : aucun écart." || echo "RÉGRESSION → voir $OUT/"
exit $fail
```

## ⚠️ Où atterrissent les captures (à ne pas rater)

`takeScreenshot: home` écrit `home.png` **relativement au CWD** de `maestro`,
PAS à côté du flow. L'app locale contourne ça en lançant maestro avec le CWD =
dossier du flow (`runner/mod.rs`). En CI il faut faire pareil, sinon les PNG
tombent au mauvais endroit et le compare ne les trouve pas.

➡️ Boucler sur les flows et `cd` dans leur dossier avant de lancer :

```bash
# reproduit le comportement de l'app : CWD = dossier du flow
for flow in maestro/**/*.yaml; do
  ( cd "$(dirname "$flow")" && maestro --udid "$SERIAL" test "$(basename "$flow")" )
done
```

Les captures atterrissent alors à côté des flows, et le script les retrouve via
`find maestro -name "<name>.png"`.

## Job CI (exemple)

```yaml
bank-check:
  image: <image-avec-maestro-et-imagemagick>   # sinon: apt-get install -y imagemagick
  variables:
    DEVICE_KEY: "<model>_<WxH>"                 # ex. Pixel_6_1080x2400
  script:
    - shopt -s globstar
    - for flow in maestro/**/*.yaml; do ( cd "$(dirname "$flow")" && maestro --udid "$SERIAL" test "$(basename "$flow")" ); done
    - bash ci/bank-check.sh
  artifacts:
    when: always
    paths: [bank-report/]                       # diffs consultables même en échec
```

## Le seul vrai piège

`DEVICE_KEY` doit correspondre au **même model + résolution** que le device qui a
seedé la banque en local. Sinon : résolution ≠ → `compare` échoue (tailles
différentes) ; model ≠ → dossier introuvable → tout MISSING.
➡️ **Figer un profil d'émulateur unique**, et que les testeurs seedent dessus.

## À décider

- `-fuzz` : `2%` absorbe le bruit de rendu. Monter/descendre selon les faux positifs.
- Nouveau `takeScreenshot` sans baseline commitée → MISSING → rouge (voulu : force à commiter la réf).
```
