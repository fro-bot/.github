#!/usr/bin/env bash
set -euo pipefail

input="$(cat)"

if ! command -v jq >/dev/null 2>&1; then
    exit 0
fi

tool_name="$(printf '%s' "$input" | jq -r '.toolName // ""')"

if [[ "$tool_name" != "bash" && "$tool_name" != "run_in_terminal" ]]; then
    exit 0
fi

command="$(printf '%s' "$input" | jq -r '
    (.toolArgs // {}) as $args
    | if ($args | type) == "string" then
            ($args | fromjson? // {})
        else
            $args
        end
    | .command // ""
')"

dangerous_pattern='(^|[;&|][[:space:]]*)(sudo[[:space:]]+)?(rm[[:space:]]+((-[[:alnum:]]*r[[:alnum:]]*f[[:alnum:]]*)|(-[[:alnum:]]*f[[:alnum:]]*r[[:alnum:]]*)|(-[[:alnum:]]*r[[:alnum:]]*[[:space:]]+-[[:alnum:]]*f[[:alnum:]]*)|(-[[:alnum:]]*f[[:alnum:]]*[[:space:]]+-[[:alnum:]]*r[[:alnum:]]*)|(--recursive[[:space:]]+--force)|(--force[[:space:]]+--recursive))[[:space:]]+/[^[:space:]]*([[:space:]]|$)|mkfs(\.[[:alnum:]_+-]+)?([[:space:]]|$)|dd[[:space:]]+if=[^[:space:]]+[[:space:]]+of=/dev/[[:alnum:]_/-]+|shutdown([[:space:]]|$)|reboot([[:space:]]|$)|poweroff([[:space:]]|$)|halt([[:space:]]|$)|curl[[:space:]].*\|[[:space:]]*(sh|bash)([[:space:]]|$)|wget[[:space:]].*\|[[:space:]]*(sh|bash)([[:space:]]|$))'

if printf '%s' "$command" | grep -Eiq "$dangerous_pattern"; then
    jq -n '{permissionDecision: "deny", permissionDecisionReason: "Blocked potentially destructive shell command"}'
fi
