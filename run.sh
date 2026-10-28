#!/data/data/com.termux/files/usr/bin/bash
# Pull the latest code and (re)start the bot in tmux. Run on the Android device.
set -e
cd "$(dirname "$0")"
termux-wake-lock || true
git pull --ff-only
tmux kill-session -t bot 2>/dev/null || true
tmux new-session -d -s bot 'while true; do node src/main.js; sleep 2; done'
echo "Started. Attach: tmux attach -t bot   Logs: tail -f logs/paper.jsonl"
