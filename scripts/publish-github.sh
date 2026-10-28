#!/usr/bin/env bash
# Publiserer prosjektmappen til et eget GitHub-repo (som så deployes til GitHub Pages av .github/workflows/pages.yml).
#
# Prosjektet lever i Playground-monorepoet; dette skriptet eksporterer siste committede versjon av mappen
# (git archive respekterer export-ignore i .gitattributes, så PDF-ene og .claude/ blir ikke med) til et
# separat arbeidstre med egen historikk, committer og pusher til `origin main`.
#
# Bruk:  scripts/publish-github.sh <git-remote-url> [commit-melding]
# Krever: at remote-repoet finnes og at git har push-tilgang (gh auth login / Git Credential Manager).
set -euo pipefail

REMOTE="${1:?Bruk: scripts/publish-github.sh <git-remote-url> [melding]}"
MSG="${2:-Publish $(date +%Y-%m-%d)}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
PREFIX="$(git -C "$HERE" rev-parse --show-prefix)"
PREFIX="${PREFIX%/}"
EXPORT_DIR="${PUBLISH_DIR:-$ROOT/.publish/${PREFIX##*/}}"

if [ -n "$(git -C "$HERE" status --porcelain -- .)" ]; then
  echo "Det finnes ucommittede endringer i $PREFIX – commit dem først." >&2
  exit 1
fi

mkdir -p "$EXPORT_DIR"
if [ ! -d "$EXPORT_DIR/.git" ]; then
  git -C "$EXPORT_DIR" init -q -b main
  git -C "$EXPORT_DIR" remote add origin "$REMOTE"
  # Hent eksisterende historikk hvis repoet allerede har innhold
  git -C "$EXPORT_DIR" fetch -q origin main 2>/dev/null && git -C "$EXPORT_DIR" reset -q --soft origin/main || true
else
  git -C "$EXPORT_DIR" remote set-url origin "$REMOTE"
fi

# Tøm arbeidstreet (ikke .git) og legg inn ny eksport
find "$EXPORT_DIR" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
git -C "$ROOT" archive --format=tar "HEAD:$PREFIX" | tar -x -C "$EXPORT_DIR"

git -C "$EXPORT_DIR" add -A
if git -C "$EXPORT_DIR" diff --cached --quiet; then
  echo "Ingen endringer å publisere."
  exit 0
fi
git -C "$EXPORT_DIR" commit -q -m "$MSG" -m "Eksportert fra $(git -C "$ROOT" rev-parse --short HEAD) i $(basename "$ROOT")/$PREFIX"
git -C "$EXPORT_DIR" push -u origin main
echo "Publisert til $REMOTE – GitHub Actions bygger og deployer til Pages."
