#!/usr/bin/env bash
# @@HEADER@@
#
# Needs bash 3.2 or newer and curl. On Windows, run it in Git Bash or WSL.
# Run it:  bash @@FILE@@ @@CSV@@
#
# Each CSV row becomes one request, sent one at a time. {{name}} placeholders take
# the value of the row's column with that name, then of default_value below. A
# placeholder with no value is sent as written. The exit code is 1 when any request failed.

# Work byte by byte, so URL encoding and escaping behave the same everywhere.
export LC_ALL=C
NL=$'\n'

# ---------- Settings. Edit them freely. ----------

@@SETTINGS@@

# ---------- The request ----------

@@REQUEST@@

# ---------- Helpers ----------

die() {
  printf '%s\n' "$*" >&2
  exit 2
}

# Looks up a placeholder ($1) in the CSV row, then in default_value. Sets REPLY,
# or leaves the placeholder as written ($2) and returns 1 when nothing has that name.
v() {
  local i=0
  while [ "$i" -lt "${#COLS[@]}" ]; do
    if [ "${COLS[$i]}" = "$1" ]; then
      REPLY=${ROW[$i]}
      return 0
    fi
    i=$((i + 1))
  done
  default_value "$1" && return 0
  REPLY=$2
  return 1
}

# Replaces each {{name}} in $1 with its value (see v). Sets REPLY.
fill() {
  local rest=$1 out='' re='[{][{][[:space:]]*([^{}]*[^{}[:space:]])[[:space:]]*[}][}]' match
  while [[ $rest =~ $re ]]; do
    match=${BASH_REMATCH[0]}
    out+=${rest%%"$match"*}
    rest=${rest#*"$match"}
    v "${BASH_REMATCH[1]}" "$match"
    out+=$REPLY
  done
  REPLY=$out$rest
}
#@if json

# Like v, but escapes the value for use inside a JSON string.
vj() {
  v "$1" "$2" || return 0
  local s=$REPLY out='' c i n
  for ((i = 0; i < ${#s}; i++)); do
    c=${s:i:1}
    case $c in
      '"') out+='\"' ;;
      '\') out+='\\' ;;
      $'\n') out+='\n' ;;
      $'\r') out+='\r' ;;
      $'\t') out+='\t' ;;
      $'\b') out+='\b' ;;
      $'\f') out+='\f' ;;
      $'\177') out+=$c ;;
      [[:cntrl:]]) printf -v n '\\u%04x' "'$c"; out+=$n ;;
      *) out+=$c ;;
    esac
  done
  REPLY=$out
}
#@end
#@if encode

# Joins the key/value arrays named $1 and $2 as a=1&b=2, encoded like JavaScript's
# encodeURIComponent. Sets REPLY.
encode_pairs() {
  local out='' i=0 n s c j code side
  eval "n=\${#$1[@]}"
  while [ "$i" -lt "$n" ]; do
    [ -n "$out" ] && out+='&'
    for side in "$1" "$2"; do
      eval "s=\${$side[$i]}"
      for ((j = 0; j < ${#s}; j++)); do
        c=${s:j:1}
        case $c in
          [a-zA-Z0-9.~_!*\'\(\)-]) out+=$c ;;
          *) printf -v code '%d' "'$c"; printf -v c '%%%02X' $(((code + 256) % 256)); out+=$c ;;
        esac
      done
      [ "$side" = "$1" ] && out+='='
    done
    i=$((i + 1))
  done
  REPLY=$out
}
#@end

trim() {
  local s=$1
  s=${s#"${s%%[![:space:]]*}"}
  REPLY=${s%"${s##*[![:space:]]}"}
}
#@if apikeyheader

has_header() {
  local h
  shopt -s nocasematch
  for h in ${HK[@]+"${HK[@]}"}; do
    [[ $h == "$1" ]] && { shopt -u nocasematch; return 0; }
  done
  shopt -u nocasematch
  return 1
}
#@end

# Adds http:// when there is no scheme and appends the query parameters, like the app.
finish_url() {
  local base sep
  trim "$REQ_URL"
  REQ_URL=$REPLY
  if [ -n "$REQ_URL" ] && ! [[ $REQ_URL =~ ^[a-zA-Z][a-zA-Z0-9+.-]*:// ]]; then REQ_URL="http://$REQ_URL"; fi
  [ "${#QK[@]}" -gt 0 ] || return 0
  base=${REQ_URL%%#*}
  case $base in
    *\?) sep='' ;;
    *\&) [[ $base == *\?* ]] && sep='' || sep='?' ;;
    *\?*) sep='&' ;;
    *) sep='?' ;;
  esac
  encode_pairs QK QV
  REQ_URL="$base$sep$REPLY${REQ_URL:${#base}}"
}

# The request as text: method and URL, headers, a blank line and the body. Sets REPLY.
request_text() {
  local i=0
  REPLY="$REQ_METHOD $REQ_URL"
  while [ "$i" -lt "${#HK[@]}" ]; do
    REPLY+="$NL${HK[$i]}: ${HV[$i]}"
    i=$((i + 1))
  done
  [ -n "$REQ_BODY" ] && REPLY+="$NL$NL$REQ_BODY"
}

# Prints one results CSV line. A cell that looks like a formula gets a ' in front,
# so spreadsheets do not run it, and a cell is cut to fit Excel's 32,767 characters.
csv_line() {
  local s line=''
  for s in "$@"; do
    [[ $s =~ ^[[:space:][:cntrl:]]*[=+@-] ]] && s="'$s"
    [ "${#s}" -gt 32000 ] && s="${s:0:32000}... [cut]"
    line+="${line:+,}\"${s//\"/\"\"}\""
  done
  printf '%s\r\n' "$line"
}

# Sends the request built for the current row and adds its line to the results.
send_request() {
  local tmp="$TMP_DIR/r" meta rc status secs ms err='' response='' line result
  local -a args=(-sS -L --max-time "$TIMEOUT" -o "$tmp.body" -D "$tmp.head" -w '%{http_code} %{time_total}')
  rm -f "$tmp".*
  if [ "$REQ_METHOD" = HEAD ]; then
    args+=(--head)
  elif [ "$REQ_METHOD" != GET ] && ! { [ "$REQ_METHOD" = POST ] && [ "$REQ_HAS_BODY" = 1 ]; }; then
    args+=(-X "$REQ_METHOD") # otherwise curl picks GET or POST itself and follows redirects like a browser
  fi
  local k=0
  while [ "$k" -lt "${#HK[@]}" ]; do
    if [ -z "${HV[$k]}" ]; then args+=(-H "${HK[$k]};"); else args+=(-H "${HK[$k]}: ${HV[$k]}"); fi
    k=$((k + 1))
  done
#@if cert
  if [ -n "$CLIENT_CERT" ]; then
    args+=(--cert "$CLIENT_CERT")
    case "$CLIENT_CERT" in *.p12 | *.P12 | *.pfx | *.PFX) args+=(--cert-type P12) ;; esac
    [ -n "${CLIENT_KEY:-}" ] && args+=(--key "$CLIENT_KEY")
    [ -n "${REST_RUNNER_CERT_PASSPHRASE:-}" ] && args+=(--pass "$REST_RUNNER_CERT_PASSPHRASE")
  fi
  [ -n "${CA_CERT:-}" ] && args+=(--cacert "$CA_CERT")
#@end
  if [ "$REQ_HAS_BODY" = 1 ]; then
    printf '%s' "$REQ_BODY" >"$tmp.req"
    args+=(--data-binary "@$tmp.req")
  fi
  meta=$(curl "${args[@]}" --url "$REQ_URL" 2>"$tmp.err" </dev/null)
  rc=$?
  read -r status secs <<<"$meta"
  ms=$(awk -v s="${secs:-0}" 'BEGIN { printf "%d", s * 1000 + 0.5 }')
  if [ "$rc" -ne 0 ]; then
    IFS= read -r err <"$tmp.err"
    [ -n "$err" ] || err="curl exited with code $rc"
    status=''
  else
    # Keep the last block of headers (curl writes one per redirect).
    while IFS= read -r line || [ -n "$line" ]; do
      line=${line%$'\r'}
      case $line in
        HTTP/*) response="HTTP ${line#* }" ;;
        '') ;;
        *) response+="$NL$line" ;;
      esac
    done <"$tmp.head"
    if [ -s "$tmp.body" ]; then
      IFS= read -r -d '' line <"$tmp.body"
      response+="$NL$NL$line"
    fi
  fi
  LAST_FAILED=0
  if [ -z "$status" ] || { [ "$HTTP_ERRORS_FAIL" = 1 ] && [ "$status" -ge 400 ]; }; then LAST_FAILED=1; fi
  result=PASS
  [ "$LAST_FAILED" = 1 ] && result=FAIL
  printf '%s %3s %6d ms  row %d  %s %s  %s\n' "$result" "${status:-ERR}" "$ms" "$((INDEX + 1))" "$REQ_METHOD" "$REQ_URL" "$err"
  request_text
  csv_line "$((INDEX + 1))" "$result" "${status:-ERR}" "$ms" "$REQ_URL" "$REPLY" "$response" "$err" >>"$RESULTS_FILE"
}

# Reads the CSV like the app (separator detection, quotes, line breaks inside quotes,
# blank lines skipped, header names trimmed and made unique). Prints one "F<value>"
# line per field, with backslash, CR and LF escaped, and "E" after each record.
CSV_AWK='
function esc(s,   out, i, c) {
  out = ""
  for (i = 1; i <= length(s); i++) {
    c = substr(s, i, 1)
    out = out (c == "\\" ? "\\\\" : c == "\n" ? "\\n" : c == "\r" ? "\\r" : c)
  }
  return out
}
function trimws(s) { sub(/^[ \t\r\n]+/, "", s); sub(/[ \t\r\n]+$/, "", s); return s }
function end_field() { rec[nf++] = field; field = "" }
function end_record(   i, name, k) {
  end_field()
  if (nf == 1 && trimws(rec[0]) == "") { nf = 0; return }
  if (!ncols) {
    ncols = nf
    for (i = 0; i < nf; i++) {
      name = trimws(rec[i])
      if (name == "") name = "column" (i + 1)
      k = seen[name]++
      print "F" esc(k > 0 ? name "_" (k + 1) : name)
    }
  } else {
    for (i = 0; i < ncols; i++) print "F" ((i < nf) ? esc(rec[i]) : "")
  }
  print "E"
  nf = 0
}
function put(c) {
  if (skip_lf) { skip_lf = 0; if (c == "\n") return }
  if (in_quotes) {
    if (pending_quote) {
      pending_quote = 0
      if (c == "\"") { field = field "\""; return }
      in_quotes = 0
    } else if (c == "\"") { pending_quote = 1; return }
    else { field = field c; return }
  }
  if (c == "\"" && field == "") in_quotes = 1
  else if (c == delim) end_field()
  else if (c == "\r") { end_record(); skip_lf = 1 }
  else if (c == "\n") end_record()
  else field = field c
}
NR == 1 {
  if (substr($0, 1, 3) == "\357\273\277") $0 = substr($0, 4)
  # The separator is whichever of , ; tab | the first line has most of, outside quotes.
  seps[1] = ","; seps[2] = ";"; seps[3] = "\t"; seps[4] = "|"; q = 0; delim = ","; best = 0
  for (i = 1; i <= length($0); i++) {
    c = substr($0, i, 1)
    if (c == "\"") q = !q
    else if (!q && c == "\r") break
    else if (!q) cnt[c]++
  }
  for (i = 1; i <= 4; i++) if (cnt[seps[i]] > best) { delim = seps[i]; best = cnt[seps[i]] }
}
{
  for (i = 1; i <= length($0); i++) put(substr($0, i, 1))
  if (pending_quote) { pending_quote = 0; in_quotes = 0 }
  put("\n")
}
END {
  if (pending_quote) in_quotes = 0
  if (field != "" || nf > 0) end_record()
}
'

# ---------- Main ----------

CSV_FILE=${1:-$CSV_FILE}
case $CSV_FILE in '' | -*) die "Give the CSV file to read, for example: bash $0 data.csv${NL}Other settings are at the top of the script." ;; esac
[ -r "$CSV_FILE" ] || die "Could not read $CSV_FILE"
[ "$DRY_RUN" = 1 ] || command -v curl >/dev/null 2>&1 || die "curl is needed but was not found."

TMP_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t rest-runner) || die "Could not make a temporary folder."
# curl on Windows is a native program: give it a C:/... style path.
if command -v cygpath >/dev/null 2>&1; then TMP_DIR=$(cygpath -m "$TMP_DIR"); fi
trap 'rm -rf "$TMP_DIR"' EXIT

awk "$CSV_AWK" "$CSV_FILE" >"$TMP_DIR/rows" || die "Could not read $CSV_FILE"
TOTAL=$(($(grep -c '^E$' "$TMP_DIR/rows") - 1))
[ "$TOTAL" -ge 1 ] || die "No data rows found in $CSV_FILE. The first line must be the column names."

if [ "$DRY_RUN" = 0 ]; then
  name=${CSV_FILE##*/}
  [ -n "$RESULTS_FILE" ] || RESULTS_FILE="${name%.*}-results-$(date +%Y%m%d-%H%M%S).csv"
  csv_line row result status duration_ms url request response error >"$RESULTS_FILE"
  printf 'Sending %d requests...\n' "$TOTAL"
fi
DELAY_S=$(awk -v ms="$DELAY_MS" 'BEGIN { printf "%.3f", ms / 1000 }')
STARTED=$(date +%s)
END=Finished
trap 'END=Stopped' INT
SENT=0
FAILED=0
INDEX=0
COLS=()
FIELDS=()
HEADER_READ=0
while IFS= read -r line; do
  if [ "$line" != E ]; then
    f=${line#F}
    case $f in *\\*) printf -v f '%b' "$f" ;; esac
    FIELDS+=("$f")
    continue
  fi
  if [ "$HEADER_READ" = 0 ]; then
    COLS=(${FIELDS[@]+"${FIELDS[@]}"})
    HEADER_READ=1
  else
    ROW=(${FIELDS[@]+"${FIELDS[@]}"})
    build_request
    if [ "$DRY_RUN" = 1 ]; then
      request_text
      printf 'Row %d\n%s\n\n' "$((INDEX + 1))" "$REPLY"
    else
      [ "$INDEX" -gt 0 ] && [ "$DELAY_MS" -gt 0 ] && sleep "$DELAY_S"
      [ "$END" = Finished ] || break
      send_request
      SENT=$((SENT + 1))
      FAILED=$((FAILED + LAST_FAILED))
      if [ "$LAST_FAILED" = 1 ] && [ "$STOP_ON_FAILURE" = 1 ] && [ "$SENT" -lt "$TOTAL" ]; then
        END='Stopped after a failure'
        break
      fi
    fi
    INDEX=$((INDEX + 1))
  fi
  FIELDS=()
done <"$TMP_DIR/rows"

[ "$DRY_RUN" = 1 ] && exit 0
printf '%s: %d of %d sent, %d passed, %d failed in %d s. Results: %s\n' \
  "$END" "$SENT" "$TOTAL" "$((SENT - FAILED))" "$FAILED" "$(($(date +%s) - STARTED))" "$RESULTS_FILE"
[ "$FAILED" -eq 0 ] && [ "$END" != Stopped ]
