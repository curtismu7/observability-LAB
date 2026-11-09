#!/usr/bin/env bash
# Make a READ-ONLY Elasticsearch API key for this lab and save it in the lab's own .env. Run it yourself in a terminal: the lab never creates
# a credential, and neither does Claude.
#
# What it does: takes the password of an Elasticsearch user that may create API keys (typed hidden, or read from a cluster Secret in your own
# shell; never stored or printed), creates a key that can only READ ping-siem-events-v2, ping-logs-* and pingone-events and expires, then writes
# PRIVILEGE_SIEM_URL, PRIVILEGE_SIEM_INDEX (only if unset) and PRIVILEGE_SIEM_READ_APIKEY into .env (mode 600, the old file kept as .env.bak.<time>).
# It talks only to the Elasticsearch port-forward already running on this Mac (http://localhost:9200).
#
#   scripts/make-read-key.sh --find                           list candidate Secrets (names only)
#   ES_SECRET=<name> ES_SECRET_KEY=<key> scripts/make-read-key.sh   read the password from the cluster Secret
#   scripts/make-read-key.sh [elastic-user-name]              or type the password (default user: elastic)
# Settings: ES_LOCAL_URL (default http://localhost:9200), OBS_ENV_FILE (default ./.env beside this repo), OBS_KEY_EXPIRY (default 30d),
#           ES_NS / ES_KUBE_CONTEXT (default ping-devops-curtismuir / us).
set -euo pipefail
ES="${ES_LOCAL_URL:-http://localhost:9200}"
USER_NAME="${1:-elastic}"; [ "$USER_NAME" = "--find" ] && USER_NAME=elastic
HERE="$(cd "$(dirname "$0")" && pwd)"
FILE="${OBS_ENV_FILE:-$HERE/../.env}"
EXPIRY="${OBS_KEY_EXPIRY:-30d}"
NS="${ES_NS:-ping-devops-curtismuir}"; CTX="${ES_KUBE_CONTEXT:-us}"

if [ "${1:-}" = "--find" ]; then
  echo "Secrets in $NS that look like Elasticsearch ones, with their key NAMES (no values):"
  kubectl --context "$CTX" -n "$NS" get secrets -o json | python3 -c '
import sys,json
for it in json.load(sys.stdin)["items"]:
    n=it["metadata"]["name"]
    if any(w in n.lower() for w in ("elastic","siem","kibana")): print(" ", n, "->", sorted((it.get("data") or {}).keys()))'
  echo "Then run:  ES_SECRET=<secret name> ES_SECRET_KEY=<key name> scripts/make-read-key.sh"
  exit 0
fi

[ -f "$FILE" ] || { echo "missing $FILE (copy .env.example to .env first)" >&2; exit 1; }
curl -s -m 5 -o /dev/null "$ES/" || { echo "cannot reach $ES (is the Elasticsearch port-forward running?)" >&2; exit 1; }

if [ -n "${ES_SECRET:-}" ]; then
  PW=$(kubectl --context "$CTX" -n "$NS" get secret "$ES_SECRET" -o "jsonpath={.data.${ES_SECRET_KEY:-elastic}}" | base64 -d)
  [ -n "$PW" ] || { echo "that secret/key is empty or missing (try --find)" >&2; exit 1; }
  if [ -z "${1:-}" ]; then U=$(kubectl --context "$CTX" -n "$NS" get secret "$ES_SECRET" -o 'jsonpath={.data.username}' 2>/dev/null | base64 -d 2>/dev/null || true); [ -n "$U" ] && USER_NAME="$U"; fi
else
  read -r -s -p "Password for Elasticsearch user '$USER_NAME' (hidden): " PW; echo
  [ -n "$PW" ] || { echo "no password given" >&2; exit 1; }
fi

BODY=$(printf '{"name":"observability-lab-reader","expiration":"%s","role_descriptors":{"reader":{"indices":[{"names":["ping-siem-events-v2","ping-logs-*","pingone-events"],"privileges":["read","view_index_metadata"]}]}}}' "$EXPIRY")
# The password goes to curl on stdin as a config line, so it never appears in the process list.
esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
RESP=$(printf 'user = "%s:%s"\n' "$(esc "$USER_NAME")" "$(esc "$PW")" | curl -s -m 20 -w '\n%{http_code}' -K - -H 'Content-Type: application/json' -X POST "$ES/_security/api_key" -d "$BODY") || true
unset PW
CODE=${RESP##*$'\n'}; JSON=${RESP%$'\n'*}
if [ "$CODE" != "200" ]; then echo "Elasticsearch answered HTTP $CODE (no key written):"; printf '%s\n' "$JSON" | head -c 400; echo; exit 1; fi

ENCODED=$(printf '%s' "$JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["encoded"])')
[ -n "$ENCODED" ] || { echo "no key in the answer" >&2; exit 1; }
cp "$FILE" "$FILE.bak.$(date +%s)"
python3 - "$FILE" "$ENCODED" <<'EOF'
import sys
path, enc = sys.argv[1], sys.argv[2]
want = {"PRIVILEGE_SIEM_URL": ("http://127.0.0.1:9200", False), "PRIVILEGE_SIEM_INDEX": ("ping-siem-events-v2", False), "PRIVILEGE_SIEM_READ_APIKEY": (enc, True)}
lines = open(path).read().splitlines()
seen, out = set(), []
for l in lines:
    k = l.split("=", 1)[0]
    if k in want and not l.lstrip().startswith("#"):
        val, force = want[k]
        out.append(f"{k}={val}" if force else l)  # URL and index are only added when missing; the key is always replaced
        seen.add(k)
    else:
        out.append(l)
for k, (val, _force) in want.items():
    if k not in seen: out.append(f"{k}={val}")
open(path, "w").write("\n".join(out) + "\n")
EOF
chmod 600 "$FILE"
echo "Done: a read-only key (expires in $EXPIRY) is saved in $FILE; the old file is kept as a .bak next to it. Tell Claude 'read key saved'."
echo "Restart the lab stack so it picks it up (the README's whole-stack command, with --profile siem)."
