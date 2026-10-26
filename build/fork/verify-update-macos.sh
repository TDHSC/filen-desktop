#!/usr/bin/env bash
# Fork: auto-update end-to-end check for the ad-hoc signed fork build (adapted from build/ci/verify-update-macos.sh).
#
# Upstream's check serves the candidate as its own successor. For a Developer ID build that proves the pipeline; for
# the fork it would not, because an identical bundle has an identical cdhash and would pass Squirrel.Mac's signature
# check even with a plain ad-hoc signature. So this installs the candidate (build A) and serves a DIFFERENT bundle as
# the update: A plus a marker file, re-signed the same way build/fork/afterPack.js signs releases (build B, new cdhash).
# Success means Squirrel accepted B against A's stable designated requirement, ShipIt swapped it in and relaunched -
# the exact path a real fork update takes.
#
# Usage: verify-update-macos.sh   (expects prod/Filen_mac_arm64.zip and prod/latest-mac.yml)

set -euo pipefail

FEED_PORT=8124
APP_DIR="$HOME/filen-e2e"
APP="$APP_DIR/Filen.app"
LOG_FILE="$HOME/Library/Application Support/@filen/logs/desktop.log"
APP_OUT="$(mktemp /tmp/filen-e2e-out.XXXXXX)"
ONCE_FILE="$(mktemp -u /tmp/filen-e2e-once.XXXXXX)"
WORK_DIR="$(mktemp -d /tmp/filen-e2e-work.XXXXXX)"
FEED_DIR="$(mktemp -d /tmp/filen-feed.XXXXXX)"
MARKER="fork-e2e-update-marker"
SERVER_PID=""

fail() {
	echo "FAIL: $1"
	if [ -f "$LOG_FILE" ]; then
		echo "--- desktop.log updater lines ---"
		grep -iE "updater|update|installing" "$LOG_FILE" | tail -n 60 || true
	fi
	echo "--- app stdout/stderr tail ---"
	tail -n 40 "$APP_OUT" || true
	exit 1
}

cleanup() {
	pkill -f "$APP_DIR" >/dev/null 2>&1 || true
	[ -n "$SERVER_PID" ] && kill "$SERVER_PID" >/dev/null 2>&1 || true
	rm -f "$ONCE_FILE"
}
trap cleanup EXIT

# 1. Install build A where ShipIt can swap it.
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
ditto -x -k prod/Filen_mac_arm64.zip "$APP_DIR"
[ -d "$APP" ] || fail "candidate app missing after extraction"

DR="$(codesign --display --requirements - "$APP" 2>&1 | sed -n 's/^designated => //p')"
[ "$DR" = 'identifier "io.filen.desktop"' ] || fail "build A has an unexpected designated requirement: '$DR'"

# 2. Build B: A + marker, outer bundle re-signed with the same stable requirement. Must differ from A by cdhash.
ditto -x -k prod/Filen_mac_arm64.zip "$WORK_DIR"
echo "$(date -u +%FT%TZ)" > "$WORK_DIR/Filen.app/Contents/Resources/$MARKER"
codesign --force --sign - --requirements "=designated => $DR" "$WORK_DIR/Filen.app"
codesign --verify --deep --strict -R="$DR" "$WORK_DIR/Filen.app" || fail "build B does not satisfy build A's designated requirement"

CDHASH_A="$(codesign -dvvv "$APP" 2>&1 | sed -n 's/^CDHash=//p')"
CDHASH_B="$(codesign -dvvv "$WORK_DIR/Filen.app" 2>&1 | sed -n 's/^CDHash=//p')"
[ "$CDHASH_A" != "$CDHASH_B" ] || fail "build B has the same cdhash as build A - the check would prove nothing"
echo "build A cdhash $CDHASH_A, build B cdhash $CDHASH_B"

ditto -c -k --sequesterRsrc --keepParent "$WORK_DIR/Filen.app" "$FEED_DIR/Filen_mac_arm64.zip"

# 3. Loopback feed for B, shaped like the release manifest (version bumped so the updater takes it).
SHA512="$(openssl dgst -sha512 -binary "$FEED_DIR/Filen_mac_arm64.zip" | base64 | tr -d '\n')"
SIZE="$(stat -f %z "$FEED_DIR/Filen_mac_arm64.zip")"
MIN_SYSTEM="$(sed -n 's/^minimumSystemVersion: //p' prod/latest-mac.yml)"
cat > "$FEED_DIR/latest-mac.yml" <<EOF
minimumSystemVersion: ${MIN_SYSTEM:-21.0.0}
version: 9.9.9-fork.1
files:
  - url: Filen_mac_arm64.zip
    sha512: $SHA512
    size: $SIZE
path: Filen_mac_arm64.zip
sha512: $SHA512
releaseDate: '$(date -u +%FT%T.000Z)'
EOF

python3 -m http.server "$FEED_PORT" --bind 127.0.0.1 --directory "$FEED_DIR" >/dev/null 2>&1 &
SERVER_PID=$!

READY=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
	if curl -sf --max-time 3 "http://127.0.0.1:${FEED_PORT}/latest-mac.yml" >/dev/null 2>&1; then
		READY=1
		break
	fi
	sleep 1
done
[ -n "$READY" ] || fail "loopback feed server did not become ready on port $FEED_PORT"

# 4. Launch A in E2E updater mode.
rm -f "$LOG_FILE"
INODE_BEFORE="$(stat -f %i "$APP/Contents/MacOS/Filen")"
FILEN_E2E_UPDATER=1 FILEN_E2E_UPDATE_FEED="http://127.0.0.1:${FEED_PORT}/" FILEN_E2E_ONCE_FILE="$ONCE_FILE" \
	"$APP/Contents/MacOS/Filen" >"$APP_OUT" 2>&1 &
ORIGINAL_PID=$!

ENGAGED=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
	sleep 5
	if [ -f "$LOG_FILE" ] && grep -q "Updater E2E mode enabled" "$LOG_FILE"; then
		ENGAGED=1
		break
	fi
done
[ -n "$ENGAGED" ] || fail "E2E feed override did not engage within 60s"

# 5. Wait for: Squirrel staging -> ShipIt swap (inode changes) -> relaunch (new pid, old pid gone).
DEADLINE=$((SECONDS + 900))
SWAPPED=""
RELAUNCHED=""
NEW_PID=""
while [ $SECONDS -lt $DEADLINE ]; do
	sleep 5

	if [ -z "$SWAPPED" ] && [ -x "$APP/Contents/MacOS/Filen" ]; then
		INODE_NOW="$(stat -f %i "$APP/Contents/MacOS/Filen" 2>/dev/null || echo "$INODE_BEFORE")"
		if [ "$INODE_NOW" != "$INODE_BEFORE" ]; then
			SWAPPED=1
			echo "ShipIt swapped the app bundle (inode $INODE_BEFORE -> $INODE_NOW)"
		fi
	fi

	if [ -n "$SWAPPED" ]; then
		NEW_PID="$(pgrep -f "$APP_DIR/Filen.app/Contents/MacOS/Filen" | head -1 || true)"
		if [ -n "$NEW_PID" ] && [ "$NEW_PID" != "$ORIGINAL_PID" ]; then
			RELAUNCHED=1
			echo "App relaunched after update (pid $NEW_PID)"
			break
		fi
	fi
done

[ -n "$SWAPPED" ] || fail "ShipIt never swapped the bundle within the timeout - Squirrel staging did not complete (signature rejected?)"
[ -n "$RELAUNCHED" ] || fail "app did not relaunch after the ShipIt swap"

kill -0 "$ORIGINAL_PID" 2>/dev/null && fail "original app process (pid $ORIGINAL_PID) is still alive after the swap"

sleep 15
kill -0 "$NEW_PID" 2>/dev/null || fail "relaunched app (pid $NEW_PID) died shortly after starting"
pkill -f "$APP_DIR" >/dev/null 2>&1 || true

grep -q "Update downloaded" "$LOG_FILE" || fail "desktop.log has no 'Update downloaded' entry"
grep -q "Installing update" "$LOG_FILE" || fail "desktop.log has no 'Installing update' entry"

# 6. The installed bundle must be B (not A re-launched) and still verify.
[ -f "$APP/Contents/Resources/$MARKER" ] || fail "installed bundle has no $MARKER - build B was not installed"
codesign --verify --deep --strict "$APP" || fail "swapped bundle fails codesign verification"

echo "fork verify-update-macos PASSED"
