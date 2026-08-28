#!/bin/bash
# Install a macOS LaunchAgent that keeps API + collector running across reboots.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.zgiis.local-live.plist"
LABEL="com.zgiis.local-live"

chmod +x "$ROOT/scripts/start_api_kwek.sh" \
  "$ROOT/scripts/start_collector_kwek.sh" \
  "$ROOT/scripts/watch_local_live.sh"

mkdir -p "$HOME/Library/LaunchAgents"

cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${ROOT}/scripts/watch_local_live.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/zgiis_watchdog.launchd.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/zgiis_watchdog.launchd.err</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
if launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null; then
  launchctl enable "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  launchctl kickstart -k "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  echo "Installed LaunchAgent: $PLIST"
else
  echo "LaunchAgent install skipped (macOS may block ~/Documents — use run_local_live.sh instead)"
fi

if pgrep -f 'watch_local_live.sh' >/dev/null 2>&1; then
  echo "Watchdog already running"
else
  nohup "$ROOT/scripts/watch_local_live.sh" >>/tmp/zgiis_watchdog.log 2>&1 &
  echo "Watchdog pid=$! (nohup fallback)"
fi

echo "Logs: /tmp/zgiis_watchdog.log /tmp/zgiis_api_kwek.log /tmp/kwek_collector.log"
echo "Stop watchdog: pkill -f watch_local_live.sh"
echo "Stop all: pkill -f watch_local_live.sh; pkill -f live_ntrip_collector; pkill -f 'uvicorn backend.main'"
