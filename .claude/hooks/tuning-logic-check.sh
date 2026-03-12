#!/bin/bash
# PostToolUse hook: reminds to consult /tuning-advisor when analysis files are modified.
#
# Triggers on Edit/Write to analysis modules, quality scoring, metrics extraction,
# flight guide constants, analysis/tuning IPC handlers, and demo data generator.
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
  */src/shared/utils/tuneQualityScore*)
    echo "⚠️ Quality scoring modified — consider running /tuning-advisor review before committing." >&2
    ;;
  */src/shared/utils/metricsExtract*)
    echo "⚠️ Metrics extraction modified — consider running /tuning-advisor review before committing." >&2
    ;;
  */src/shared/constants/flightGuide*)
    echo "⚠️ Flight guide constants modified — consider running /tuning-advisor review before committing." >&2
    ;;
  */src/main/ipc/handlers/analysisHandlers*)
    echo "⚠️ Analysis IPC handlers modified — consider running /tuning-advisor review before committing." >&2
    ;;
  */src/main/ipc/handlers/tuningHandlers*)
    echo "⚠️ Tuning IPC handlers modified — consider running /tuning-advisor review before committing." >&2
    ;;
esac

exit 0
