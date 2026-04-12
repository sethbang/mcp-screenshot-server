#!/usr/bin/env bash
set -euo pipefail

# Start Xvfb on display :99 with a virtual 1280x1024 screen
Xvfb :99 -screen 0 1280x1024x24 &
XVFB_PID=$!

# Wait for Xvfb to be ready
for i in $(seq 1 10); do
  if xdpyinfo -display :99 >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

export DISPLAY=:99

# Run the e2e tests, or a custom command if provided
if [ $# -eq 0 ]; then
  npx vitest run --config vitest.e2e.config.ts
else
  exec "$@"
fi

EXIT_CODE=$?
kill "$XVFB_PID" 2>/dev/null || true
exit "$EXIT_CODE"
