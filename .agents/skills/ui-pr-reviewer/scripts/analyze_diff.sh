#!/bin/bash
# Analyze a patch or diff for common red flags

DIFF_FILE=$1

if [ -z "$DIFF_FILE" ]; then
  echo "Usage: $0 <path_to_diff_file>"
  exit 1
fi

echo "--- PR Diff Analyzer ---"

# Check for console.log
if grep -q "console\.log" "$DIFF_FILE"; then
  echo "⚠️  WARNING: Found console.log statements in the diff."
fi

# Check for TODOs
if grep -iq "todo" "$DIFF_FILE"; then
  echo "⚠️  WARNING: Found 'TODO' comments in the diff."
fi

# Check for hardcoded secrets/passwords (Basic check)
if grep -iqE "(secret|password|api_key|token)\s*=\s*['\"][a-zA-Z0-9]+['\"]" "$DIFF_FILE"; then
  echo "🚨 CRITICAL: Possible hardcoded secret detected!"
fi

echo "Analysis complete."
