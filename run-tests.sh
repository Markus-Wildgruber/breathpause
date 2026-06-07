#!/usr/bin/env bash
# macOS / dev test runner: node:test + coverage + 80%-core soft gate (SPEC §11).
# Uses Node's built-in coverage (zero extra deps). For the browsable HTML report, run:
#   npx c8 --reporter=text --reporter=html --report-dir=coverage/macos node --test 'test/macos/*.test.js'
set -u
cd "$(dirname "$0")"

GATE=80

out="$(node --test --experimental-test-coverage 'test/macos/*.test.js' 2>&1)"
status=$?
echo "$out"

# Soft gate: warn (never fail) if core line coverage < GATE.
core_line="$(printf '%s\n' "$out" \
  | grep -E 'core/(timefmt|breathing|pomodoro|eventlog|settings)\.js' \
  | awk -F'|' '{ gsub(/ /,"",$2); print $2 }' \
  | awk -v g="$GATE" 'BEGIN{min=100} {if($1<min)min=$1} END{print min}')"

if [ -n "${core_line:-}" ]; then
  awk -v c="$core_line" -v g="$GATE" 'BEGIN{
    if (c+0 < g+0) printf "\n\033[33mWARN: lowest core line coverage %.2f%% < %d%% target (soft gate, not failing).\033[0m\n", c, g;
    else printf "\nCore coverage OK: lowest core file %.2f%% >= %d%%.\n", c, g;
  }'
fi

exit $status
