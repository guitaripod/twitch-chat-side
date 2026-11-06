#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="com.guitaripod.twitch_chat_side"
HOST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
EXTENSION_DIR="$(dirname -- "$HOST_DIR")"
HOST_SCRIPT="$HOST_DIR/twitch_chat_side_host.py"
BROWSER_DIRS=(vivaldi vivaldi-snapshot chromium google-chrome google-chrome-beta BraveSoftware/Brave-Browser)

extension_id() {
  printf '%s' "$EXTENSION_DIR" | sha256sum | cut -c1-32 | tr '0-9a-f' 'a-p'
}

manifest() {
  python3 - "$HOST_NAME" "$HOST_SCRIPT" "$(extension_id)" <<'PY'
import json, sys
name, path, extension = sys.argv[1:4]
print(json.dumps({
    "name": name,
    "description": "Twitch Chat Side monitor helper (KWin)",
    "path": path,
    "type": "stdio",
    "allowed_origins": [f"chrome-extension://{extension}/"],
}, indent=2))
PY
}

if [[ "${1:-}" == "--uninstall" ]]; then
  for browser in "${BROWSER_DIRS[@]}"; do
    rm -fv "$HOME/.config/$browser/NativeMessagingHosts/$HOST_NAME.json"
  done
  exit 0
fi

chmod +x "$HOST_SCRIPT"
for browser in "${BROWSER_DIRS[@]}"; do
  [[ -d "$HOME/.config/$browser" ]] || continue
  mkdir -p "$HOME/.config/$browser/NativeMessagingHosts"
  manifest > "$HOME/.config/$browser/NativeMessagingHosts/$HOST_NAME.json"
  echo "registered for $browser (extension $(extension_id))"
done
