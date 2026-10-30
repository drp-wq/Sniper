#!/usr/bin/env bash
# 24-Hour Persistent Paper Bot Supervisor
# Keeps the paper trading runner alive, monitors process health, and rotates logs.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

LOGS_DIR="$ROOT_DIR/logs"
mkdir -p "$LOGS_DIR"

SUPERVISOR_LOG="$LOGS_DIR/supervisor.log"
RUNNER_PID=""

log_msg() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$msg"
  echo "$msg" >> "$SUPERVISOR_LOG"
}

cleanup() {
  log_msg "Received shutdown signal. Stopping paper runner..."
  if [ -n "$RUNNER_PID" ] && kill -0 "$RUNNER_PID" 2>/dev/null; then
    kill -TERM "$RUNNER_PID" 2>/dev/null || true
    wait "$RUNNER_PID" 2>/dev/null || true
  fi
  log_msg "Supervisor stopped cleanly."
  exit 0
}

trap cleanup SIGINT SIGTERM SIGHUP

# Termux wake-lock support if running on Android
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock || true
  log_msg "Acquired Termux wake-lock for background continuous execution."
fi

log_msg "=========================================================="
log_msg " SolRelay Sniper — 24-Hour Paper Bot Supervisor Started"
log_msg " Root: $ROOT_DIR"
log_msg " Mode: PAPER ONLY (Dry-run, zero live funds, zero signing)"
log_msg "=========================================================="

MAX_RESTARTS=100
RESTART_COUNT=0
START_TIME=$(date +%s)

while true; do
  # Check if HALT file is set locally
  if [ -f "$ROOT_DIR/HALT" ]; then
    log_msg "HALT file detected. Standing by without restarting runner..."
    sleep 5
    continue
  fi

  # Rotate paper.jsonl if larger than 20MB
  if [ -f "$LOGS_DIR/paper.jsonl" ]; then
    FILE_SIZE=$(wc -c < "$LOGS_DIR/paper.jsonl" 2>/dev/null || echo 0)
    if [ "$FILE_SIZE" -gt 20971520 ]; then
      ARCHIVE_NAME="$LOGS_DIR/paper_$(date +%Y%m%d_%H%M%S).jsonl"
      log_msg "Rotating $LOGS_DIR/paper.jsonl ($FILE_SIZE bytes) to $ARCHIVE_NAME"
      mv "$LOGS_DIR/paper.jsonl" "$ARCHIVE_NAME"
      touch "$LOGS_DIR/paper.jsonl"
    fi
  fi

  log_msg "Starting node src/main.js (restart count: $RESTART_COUNT)..."
  node src/main.js &
  RUNNER_PID=$!

  wait "$RUNNER_PID" || EXIT_CODE=$?
  EXIT_CODE=${EXIT_CODE:-0}

  NOW=$(date +%s)
  UPTIME=$((NOW - START_TIME))

  log_msg "Paper runner process exited with code $EXIT_CODE (supervisor uptime: ${UPTIME}s)."

  if [ "$EXIT_CODE" -eq 0 ]; then
    log_msg "Runner exited cleanly with code 0. Sleeping 3s before next iteration..."
    sleep 3
  else
    RESTART_COUNT=$((RESTART_COUNT + 1))
    if [ "$RESTART_COUNT" -gt "$MAX_RESTARTS" ]; then
      log_msg "CRITICAL: Max restart limit ($MAX_RESTARTS) reached. Halting supervisor."
      touch "$ROOT_DIR/HALT"
      exit 1
    fi
    # Exponential backoff capped at 15s
    BACKOFF=$((RESTART_COUNT > 5 ? 15 : RESTART_COUNT * 2))
    log_msg "Runner crashed or exited abnormally. Waiting ${BACKOFF}s before auto-recovering..."
    sleep "$BACKOFF"
  fi
done
