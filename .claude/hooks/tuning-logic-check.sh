#!/bin/bash
# PostToolUse hook: reminds to consult /tuning-advisor when analysis files are modified.
#
# Triggers on Edit/Write to src/main/analysis/ files.
# Outputs a reminder to stderr (visible to Claude) but does NOT block (exit 0).

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.file_path // empty')

# Only trigger for analysis-related files
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

case "$FILE_PATH" in
  */src/main/analysis/*)
    BASENAME=$(basename "$FILE_PATH")
    echo "⚠️ Tuning logic modified: $BASENAME — consider running /tuning-advisor review before committing." >&2
    ;;
  */src/main/demo/DemoDataGenerator*)
    echo "⚠️ Demo data generator modified — consider running /tuning-advisor review to validate realism." >&2
    ;;
esac

exit 0
