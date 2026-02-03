#!/bin/sh
# Kill processes listening on given ports (space-separated in $PORTS) or default set.
# Usage: PORTS="5173 8787" npm run kill:ports  OR  npm run kill:ports

set -eu

DEFAULT_PORTS="5173 5174 8787 3000 8000"
PORTS="${PORTS:-$DEFAULT_PORTS}"

echo "Killing processes on ports: $PORTS"

for p in $PORTS; do
  echo "Checking port $p..."
  # Prefer lsof if available
  if command -v lsof >/dev/null 2>&1; then
    PIDS=$(lsof -ti tcp:${p} 2>/dev/null || true)
  else
    # Fallback to ss+awk (may require root for PID output on some systems)
    PIDS=$(ss -ltnp 2>/dev/null | awk -v port=":${p}" '$0 ~ port { for(i=1;i<=NF;i++) if($i ~ /pid=/) { sub(/pid=/,"",$i); sub(/,/ ,"", $i); print $i } }' || true)
  fi

  if [ -n "$PIDS" ]; then
    echo "Killing pids on port ${p}: $PIDS"
    # Use kill -TERM first, then fallback to -9 for stubborn processes
    echo "$PIDS" | xargs -r kill || true
    sleep 0.2
    # If still present, force kill
    if command -v lsof >/dev/null 2>&1; then
      STILL=$(lsof -ti tcp:${p} 2>/dev/null || true)
    else
      STILL=$(ss -ltnp 2>/dev/null | awk -v port=":${p}" '$0 ~ port { for(i=1;i<=NF;i++) if($i ~ /pid=/) { sub(/pid=/,"",$i); sub(/,/ ,"", $i); print $i } }' || true)
    fi
    if [ -n "$STILL" ]; then
      echo "Forcing kill on: $STILL"
      echo "$STILL" | xargs -r kill -9 || true
    fi
  else
    echo "No process on port $p"
  fi
done

echo "Done."
