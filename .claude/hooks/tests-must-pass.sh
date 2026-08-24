#!/bin/bash
# Stop hook: refuse to end the turn while the suite is red.
#
# Exits 2 on failure, which is a blocking error: stderr is handed back so the
# work continues against the actual output rather than a claim that it passed.
#
# The attempt cap exists because a suite that cannot be fixed would otherwise
# block forever. After MAX_ATTEMPTS the turn is allowed to end, with the
# failure stated rather than swallowed.

MAX_ATTEMPTS="${TESTS_MUST_PASS_MAX_ATTEMPTS:-3}"

input=$(cat)

read -r dir session <<EOF
$(printf '%s' "$input" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    d = {}
print(d.get("cwd") or ".", d.get("session_id") or "nosession")
' 2>/dev/null)
EOF

cd "${CLAUDE_PROJECT_DIR:-$dir}" 2>/dev/null || exit 0
[ -f package.json ] || exit 0

counter="${TMPDIR:-/tmp}/claude-tests-must-pass.$session"

if output=$(npm test 2>&1); then
  rm -f "$counter"
  exit 0
fi

attempts=$(( $(cat "$counter" 2>/dev/null || echo 0) + 1 ))
echo "$attempts" > "$counter"

if [ "$attempts" -gt "$MAX_ATTEMPTS" ]; then
  rm -f "$counter"
  echo "Tests still failing after $MAX_ATTEMPTS attempts; letting the turn end." >&2
  exit 0
fi

{
  echo "The test suite is failing, so the work is not finished."
  echo "Attempt $attempts of $MAX_ATTEMPTS. Fix the code or the test, then stop."
  echo
  printf '%s\n' "$output" | grep -vE '^\s*$' | tail -40
} >&2
exit 2
