#!/bin/bash
# Mock gt binary for Docker-based testing
# Simulates gt session capture, sling, and session management

case "$1" in
  session)
    case "$2" in
      capture)
        # Return mock session output
        echo "[$(date '+%H:%M:%S')] Claude is working on the task..."
        echo "[$(date '+%H:%M:%S')] Analyzing codebase structure..."
        echo "[$(date '+%H:%M:%S')] Reading file: src/server.js"
        echo "[$(date '+%H:%M:%S')] Found 3 potential improvements"
        echo "[$(date '+%H:%M:%S')] Implementing fix #1: Update error handling"
        echo "[$(date '+%H:%M:%S')] Writing changes to disk..."
        echo "[$(date '+%H:%M:%S')] Running tests..."
        echo "[$(date '+%H:%M:%S')] All tests passed."
        ;;
      list)
        echo '[]'
        ;;
      start)
        echo "session started for $3"
        ;;
      stop)
        echo "session stopped for $3"
        ;;
      status)
        # Return JSON status
        echo '{"running": true, "alive": true, "session": "'"$3"'"}'
        ;;
      check)
        echo '{"alive": true}'
        ;;
      *)
        echo "gt session: unknown subcommand $2"
        ;;
    esac
    ;;
  sling)
    echo "Work dispatched: $2 to $3"
    ;;
  feed)
    # For SSE legacy endpoint
    echo ""
    ;;
  convoy)
    case "$2" in
      list)
        if echo "$*" | grep -q -- "--json"; then
          echo '[]'
        else
          echo "No active convoys"
        fi
        ;;
      status)
        echo '{"id": "'"$3"'", "status": "active"}'
        ;;
    esac
    ;;
  mail)
    echo "mail sent"
    ;;
  stop)
    echo "agent stopped: $2"
    ;;
  *)
    echo "gt mock: $*"
    ;;
esac
