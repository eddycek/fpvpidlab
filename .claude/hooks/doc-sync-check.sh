#!/bin/bash
# PostToolUse hook: reminds to run /doc-sync when files affecting documentation are changed.
# Triggers on Edit/Write to analysis code, constants, types, IPC handlers, hooks, and test files.

FILE="${CLAUDE_FILE_PATH:-}"

# Check if the edited file is one that typically affects documentation accuracy
if echo "$FILE" | grep -qE '(src/main/analysis/|src/main/ipc/handlers/|src/shared/types/|src/shared/constants|src/shared/utils/|src/renderer/hooks/|\.test\.(ts|tsx)$)'; then
  echo "📝 This file change may affect documentation accuracy. Consider running /doc-sync before merging."
fi

exit 0
