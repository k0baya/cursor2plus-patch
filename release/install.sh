#!/usr/bin/env bash
set -euo pipefail

PATCHED_BY="k0baya"
DISPLAY_NAME="Cursor++ k0baya Local"
SIGNATURE_FINGERPRINT="kbya-20260624-local"
DEFAULT_BASE_URL="__CCURSOR_RELEASE_BASE_URL__"
BASE_URL="${CCURSOR_RELEASE_BASE_URL:-$DEFAULT_BASE_URL}"
BASE_URL="${BASE_URL%/}"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<EOF
$DISPLAY_NAME installer

Usage:
  CCURSOR_RELEASE_BASE_URL="https://github.com/<org>/<repo>/releases/latest/download" bash install.sh
  /bin/bash -c "\$(curl -fsSL https://github.com/<org>/<repo>/releases/latest/download/install.sh)"
EOF
  exit 0
fi

if [[ "$BASE_URL" == "__CCURSOR_RELEASE_BASE_URL__" || -z "$BASE_URL" ]]; then
  echo "Release base URL is not configured. Set CCURSOR_RELEASE_BASE_URL or publish this script through the GitHub Actions release workflow." >&2
  exit 2
fi

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "$1 is required." >&2; exit 2; }
}

json_get() {
  node -e "const fs=require('fs'); const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); const path=process.argv[2].split('.'); let v=j; for (const p of path) v=v[p]; process.stdout.write(String(v));" "$1" "$2"
}

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else echo "shasum or sha256sum is required." >&2; exit 2
  fi
}

echo "== $DISPLAY_NAME installer =="
echo "Patched by: $PATCHED_BY"
echo "Signature: $SIGNATURE_FINGERPRINT"
echo "Release: $BASE_URL"

need_cmd node
need_cmd npm
need_cmd curl

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo "Node.js 18+ is required. Current major version: $NODE_MAJOR" >&2
  exit 2
fi

if pgrep -x "Cursor" >/dev/null 2>&1; then
  echo "Cursor is running. Close Cursor and run this installer again." >&2
  exit 2
fi

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

curl -fsSL "$BASE_URL/latest.json" -o "$TMP_DIR/latest.json"
LATEST_FINGERPRINT="$(json_get "$TMP_DIR/latest.json" signature.fingerprint)"
if [[ "$LATEST_FINGERPRINT" != "$SIGNATURE_FINGERPRINT" ]]; then
  echo "latest.json signature fingerprint is $LATEST_FINGERPRINT, expected $SIGNATURE_FINGERPRINT" >&2
  exit 1
fi
TARBALL_NAME="$(json_get "$TMP_DIR/latest.json" tarball.name)"
EXPECTED_HASH="$(json_get "$TMP_DIR/latest.json" tarball.sha256)"
curl -fsSL "$BASE_URL/$TARBALL_NAME" -o "$TMP_DIR/$TARBALL_NAME"
ACTUAL_HASH="$(sha256_file "$TMP_DIR/$TARBALL_NAME")"
if [[ "$ACTUAL_HASH" != "$EXPECTED_HASH" ]]; then
  echo "SHA256 mismatch for $TARBALL_NAME. Expected $EXPECTED_HASH, got $ACTUAL_HASH" >&2
  exit 1
fi
echo "SHA256 verified: $ACTUAL_HASH"

if command -v cursor >/dev/null 2>&1; then
  cursor --uninstall-extension company-internal.cursor2plus >/dev/null 2>&1 || true
  cursor --uninstall-extension cometix-space.cursor2plus >/dev/null 2>&1 || true
fi

NPM_CMD=(npm exec --yes --package "$TMP_DIR/$TARBALL_NAME" -- ccursor install)
STATUS_CMD=(npm exec --yes --package "$TMP_DIR/$TARBALL_NAME" -- ccursor status)

if [[ -d "/Applications/Cursor.app" && ! -w "/Applications/Cursor.app" ]]; then
  echo "Cursor is under /Applications and may require sudo."
  sudo -E env HOME="$HOME" PATH="$PATH" "${NPM_CMD[@]}"
  sudo -E env HOME="$HOME" PATH="$PATH" "${STATUS_CMD[@]}"
else
  "${NPM_CMD[@]}"
  "${STATUS_CMD[@]}"
fi

echo
echo "Installed $DISPLAY_NAME. Restart Cursor."
echo "Required after restart: set Cursor network mode to HTTP/1.1 and make sure Cursor++ BYOK is ON."
echo "Recommended: set Cursor orientation to vertical to find the Cursor++ configuration panel more easily."
echo "Update procedure: close Cursor, uninstall this patch, then install again."
