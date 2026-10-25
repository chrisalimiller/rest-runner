#!/usr/bin/env bash
# @@HEADER@@
#
# Needs bash (3.2 or newer) and curl. macOS and Linux have both. On Windows, run it
# in Git Bash (comes with Git for Windows) or WSL.
#
# Usage:
#   bash @@FILE@@ @@CSV@@
#
# Options:
#   --concurrency N        requests in flight at once (1 to 50)
#   --delay-ms N           pause before each request after the first ones
#   --stop-on-failure      start no new requests after a failure
#   --no-stop-on-failure
#   --http-errors-fail     count 4xx and 5xx responses as failures
#   --no-http-errors-fail
#   --timeout SECONDS      give up on a request after this long (default 120)
#   --out FILE             where to write the results CSV
#   --dry-run              print the requests without sending them
#
# Each row of the CSV becomes one request. {{name}} placeholders take their value
# from the row's column of that name, then from default_value below. A placeholder
# with no value is sent as written, like in the app. The results CSV has the same
# columns as the app's CSV report. The exit code is 1 when any request failed.

# Work byte by byte, so URL encoding and escaping behave the same everywhere.
export LC_ALL=C
NL=$'\n'

# ---------- Settings exported from REST Runner. Edit them freely. ----------

@@SETTINGS@@

# ---------- Helpers ----------

die() {
  printf '%s\n' "$*" >&2
  exit 2
}

# Looks up a placeholder: the CSV row first, then default_value. Sets REPLY.
# Returns 1 and leaves the placeholder as written ($2) when nothing has that name.
v() {
  local i=0
  while [ "$i" -lt "$NCOLS" ]; do
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

# Escapes REPLY for use inside a JSON string.
json_escape() {
  local s=$REPLY out='' c i n
  case $s in
    *[\"\\]* | *[[:cntrl:]]*) ;;
    *) return 0 ;;
  esac
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
      [[:cntrl:]])
        printf -v n '\\u%04x' "'$c"
        out+=$n
        ;;
      *) out+=$c ;;
    esac
  done
  REPLY=$out
}

# Like v, but escapes the value for a JSON string (placeholders inside "..." in a JSON body).
vj() {
  v "$1" "$2" && json_escape
}

# Same characters as JavaScript's encodeURIComponent. Sets REPLY.
urlenc() {
  local s=$1 out='' c i n
  for ((i = 0; i < ${#s}; i++)); do
    c=${s:i:1}
    case $c in
      [a-zA-Z0-9.~_!*\'\(\)-]) out+=$c ;;
      *)
        printf -v n '%d' "'$c"
        [ "$n" -lt 0 ] && n=$((n + 256))
        printf -v c '%%%02X' "$n"
        out+=$c
        ;;
    esac
  done
  REPLY=$out
}

trim() {
  local s=$1
  s=${s#"${s%%[![:space:]]*}"}
  s=${s%"${s##*[![:space:]]}"}
  REPLY=$s
}

b64() {
  REPLY=$(printf '%s' "$1" | base64 | tr -d '\r\n')
}

has_header() {
  local i=0 found=1
  shopt -s nocasematch
  while [ "$i" -lt "${#HK[@]}" ]; do
    if [[ "${HK[$i]}" == "$1" ]]; then
      found=0
      break
    fi
    i=$((i + 1))
  done
  shopt -u nocasematch
  return $found
}

add_header() {
  HK+=("$1")
  HV+=("$2")
}

# Joins key/value arrays named $1 and $2 as a=1&b=2. Sets REPLY.
encode_pairs() {
  local keys_name=$1 values_name=$2 out='' i=0 n k val
  eval "n=\${#$keys_name[@]}"
  while [ "$i" -lt "$n" ]; do
    eval "k=\${$keys_name[$i]}; val=\${$values_name[$i]}"
    urlenc "$k"
    k=$REPLY
    urlenc "$val"
    [ -n "$out" ] && out+='&'
    out+="$k=$REPLY"
    i=$((i + 1))
  done
  REPLY=$out
}

# Adds http:// when there is no scheme and appends the query parameters, like the app.
finish_url() {
  local url base hash sep
  trim "$REQ_URL"
  url=$REPLY
  if [ -n "$url" ] && ! [[ $url =~ ^[a-zA-Z][a-zA-Z0-9+.-]*:// ]]; then
    url="http://$url"
  fi
  if [ "${#QK[@]}" -gt 0 ]; then
    base=${url%%#*}
    hash=${url:${#base}}
    case $base in
      *\?) sep='' ;;
      *\&) [[ $base == *\?* ]] && sep='' || sep='?' ;;
      *\?*) sep='&' ;;
      *) sep='?' ;;
    esac
    encode_pairs QK QV
    url="$base$sep$REPLY$hash"
  fi
  REQ_URL=$url
}

describe_request() {
  local i=0
  REPLY="$REQ_METHOD $REQ_URL"
  while [ "$i" -lt "${#HK[@]}" ]; do
    REPLY+=$'\n'"${HK[$i]}: ${HV[$i]}"
    i=$((i + 1))
  done
  if [ "$REQ_HAS_BODY" = 1 ] && [ -n "$REQ_BODY" ]; then
    REPLY+=$'\n\n'"$REQ_BODY"
  fi
}

# Quotes a value for the results CSV. Sets REPLY.
csvq() {
  REPLY="\"${1//\"/\"\"}\""
}

# The CSV reader: same rules as the app (delimiter detection, quotes, line breaks
# inside quotes, blank lines skipped, header names trimmed and made unique).
# Prints one "F<value>" line per field (backslash, CR and LF escaped) and "E" after each record.
CSV_AWK='
function esc(s,   out, i, c, n) {
  if (index(s, "\\") == 0 && index(s, "\n") == 0 && index(s, "\r") == 0) return s
  out = ""; n = length(s)
  for (i = 1; i <= n; i++) {
    c = substr(s, i, 1)
    if (c == "\\") out = out "\\\\"
    else if (c == "\n") out = out "\\n"
    else if (c == "\r") out = out "\\r"
    else out = out c
  }
  return out
}
function trimws(s) {
  sub(/^[ \t\r\n]+/, "", s)
  sub(/[ \t\r\n]+$/, "", s)
  return s
}
function end_field() { rec[nf++] = field; field = ""; started = 1 }
function end_record(   i, name, k) {
  end_field()
  started = 0
  if (nf == 1 && trimws(rec[0]) == "") { nf = 0; return }
  if (!have_header) {
    have_header = 1
    ncols = nf
    for (i = 0; i < nf; i++) {
      name = trimws(rec[i])
      if (name == "") name = "column" (i + 1)
      k = seen[name]++
      if (k > 0) {
        printf "Warning: Column \"%s\" appears more than once; the copy is named \"%s_%d\".\n", name, name, k + 1 > "/dev/stderr"
        name = name "_" (k + 1)
      }
      print "F" esc(name)
    }
    print "E"
  } else {
    if (nf != ncols) ragged++
    for (i = 0; i < ncols; i++) print "F" ((i < nf) ? esc(rec[i]) : "")
    print "E"
  }
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
  if (c == "\"" && field == "") { in_quotes = 1; started = 1 }
  else if (c == delim) end_field()
  else if (c == "\r") { end_record(); skip_lf = 1 }
  else if (c == "\n") end_record()
  else { field = field c; started = 1 }
}
NR == 1 {
  if (substr($0, 1, 3) == "\357\273\277") $0 = substr($0, 4)
  q = 0; best = ","; bestn = 0
  cnt[","] = 0; cnt[";"] = 0; cnt["\t"] = 0; cnt["|"] = 0
  for (i = 1; i <= length($0); i++) {
    c = substr($0, i, 1)
    if (c == "\"") q = !q
    else if (!q && c == "\r") break
    else if (!q && (c in cnt)) cnt[c]++
  }
  if (cnt[","] > bestn) { best = ","; bestn = cnt[","] }
  if (cnt[";"] > bestn) { best = ";"; bestn = cnt[";"] }
  if (cnt["\t"] > bestn) { best = "\t"; bestn = cnt["\t"] }
  if (cnt["|"] > bestn) { best = "|"; bestn = cnt["|"] }
  delim = best
}
{
  line = $0
  # Fast path: a plain line with no quotes.
  if (!in_quotes && !skip_lf && field == "" && nf == 0 && index(line, "\"") == 0) {
    if (substr(line, length(line), 1) == "\r") line = substr(line, 1, length(line) - 1)
    if (index(line, "\r") == 0) {
      n = split(line, parts, delim == "|" ? "[|]" : delim)
      if (n == 0) { n = 1; parts[1] = "" }
      for (i = 1; i <= n; i++) rec[i - 1] = parts[i]
      nf = n - 1
      field = parts[n]
      end_record()
      next
    }
  }
  for (i = 1; i <= length(line); i++) put(substr(line, i, 1))
  if (pending_quote) { pending_quote = 0; in_quotes = 0 }
  put("\n")
}
END {
  if (pending_quote) { pending_quote = 0; in_quotes = 0 }
  if (field != "" || nf > 0) end_record()
  if (ragged > 0) printf "Warning: %d row(s) have a different number of values than the header. Missing values are left empty and extra values are ignored.\n", ragged > "/dev/stderr"
}
'

# ---------- Sending ----------

# Sends the request built for row $1 and writes its results CSV line. Runs in the background.
run_row() {
  local i=$1 base="$TMP_DIR/r$1" sent_at meta rc status secs size ms frac whole
  local status_text='' resp_headers='' body='' err='' failed=0 result label line k
  local -a args
  local req_body=''
  [ "$REQ_HAS_BODY" = 1 ] && req_body=$REQ_BODY
  sent_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  args=(-sS -L --max-time "$TIMEOUT" -o "$base.body" -D "$base.head" -w '%{http_code} %{time_total} %{size_download}')
  if [ "$REQ_METHOD" = HEAD ]; then
    args+=(--head)
  elif [ "$REQ_METHOD" = GET ] || { [ "$REQ_METHOD" = POST ] && [ "$REQ_HAS_BODY" = 1 ]; }; then
    : # curl picks GET, or POST because of --data-binary, and follows redirects like a browser
  else
    args+=(-X "$REQ_METHOD")
  fi
  k=0
  while [ "$k" -lt "${#HK[@]}" ]; do
    if [ -z "${HV[$k]}" ]; then args+=(-H "${HK[$k]};"); else args+=(-H "${HK[$k]}: ${HV[$k]}"); fi
    k=$((k + 1))
  done
  if [ "$REQ_HAS_BODY" = 1 ]; then
    printf '%s' "$REQ_BODY" >"$base.req"
    args+=(--data-binary "@$base.req")
  fi
  meta=$(curl "${args[@]}" --url "$REQ_URL" 2>"$base.err" </dev/null)
  rc=$?
  read -r status secs size <<<"$meta"
  whole=${secs%%[.,]*}
  frac=000
  [ "$whole" != "$secs" ] && frac="${secs#*[.,]}000"
  ms=$((10#${whole:-0} * 1000 + 10#${frac:0:3}))
  if [ "$rc" -ne 0 ]; then
    IFS= read -r err <"$base.err"
    [ -z "$err" ] && err="curl exited with code $rc"
    failed=1
    status=''
    size=''
  else
    # Keep the last block of headers (after any redirects).
    while IFS= read -r line || [ -n "$line" ]; do
      line=${line%$'\r'}
      case $line in
        HTTP/*)
          status_text=${line#* }
          status_text=${status_text#* }
          [ "$status_text" = "${line#* }" ] && status_text=''
          resp_headers=''
          ;;
        '') ;;
        *) resp_headers+="${resp_headers:+$NL}$line" ;;
      esac
    done <"$base.head"
    [ -f "$base.body" ] && IFS= read -r -d '' body <"$base.body"
    if [ "$HTTP_ERRORS_FAIL" = 1 ] && [ "$status" -ge 400 ]; then failed=1; fi
  fi
  if [ "$failed" = 1 ]; then
    result=FAIL
    [ "$STOP_ON_FAILURE" = 1 ] && : >"$TMP_DIR/stop"
    : >"$base.fail"
  else
    result=PASS
  fi
  label=${status:-ERR}
  printf '%s %3s %6d ms  row %d  %s %s%s\n' "$result" "$label" "$ms" "$((i + 1))" "$REQ_METHOD" "$REQ_URL" "${err:+  $err}"

  local headers_text='' hk=0
  while [ "$hk" -lt "${#HK[@]}" ]; do
    headers_text+="${headers_text:+$NL}${HK[$hk]}: ${HV[$hk]}"
    hk=$((hk + 1))
  done
  line=''
  local cell
  for cell in "$((i + 1))" "$result" "$label" "$status_text" "$ms" "$sent_at" "$REQ_METHOD" "$REQ_URL" \
    "$headers_text" "$req_body" "$resp_headers" "$body" "$size" "$err" \
    ${ROW[@]+"${ROW[@]}"}; do
    csvq "$cell"
    line+="${line:+,}$REPLY"
  done
  printf '%s\r\n' "$line" >"$base.csv"
  rm -f "$base.body" "$base.head" "$base.req" "$base.err"
}

wait_for_slot() {
  local p
  local -a alive
  while :; do
    alive=()
    for p in ${PIDS[@]+"${PIDS[@]}"}; do
      kill -0 "$p" 2>/dev/null && alive+=("$p")
    done
    PIDS=(${alive[@]+"${alive[@]}"})
    [ "${#PIDS[@]}" -lt "$CONCURRENCY" ] && return 0
    sleep 0.05
  done
}

# ---------- Main ----------

CSV_FILE=$DEFAULT_CSV
OUT_FILE=''
DRY_RUN=0
TIMEOUT=120
while [ $# -gt 0 ]; do
  case $1 in
    --concurrency) CONCURRENCY=$2; shift ;;
    --delay-ms) DELAY_MS=$2; shift ;;
    --stop-on-failure) STOP_ON_FAILURE=1 ;;
    --no-stop-on-failure) STOP_ON_FAILURE=0 ;;
    --http-errors-fail) HTTP_ERRORS_FAIL=1 ;;
    --no-http-errors-fail) HTTP_ERRORS_FAIL=0 ;;
    --timeout) TIMEOUT=$2; shift ;;
    --out) OUT_FILE=$2; shift ;;
    --dry-run) DRY_RUN=1 ;;
    -h | --help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*) die "Unknown option: $1 (try --help)" ;;
    *) CSV_FILE=$1 ;;
  esac
  shift
done

[ -n "$CSV_FILE" ] || die "Give the CSV file to read, for example: bash $0 data.csv"
[ -r "$CSV_FILE" ] || die "Could not read $CSV_FILE"
case $CONCURRENCY in '' | *[!0-9]*) die "--concurrency must be a number" ;; esac
case $DELAY_MS in '' | *[!0-9]*) die "--delay-ms must be a number" ;; esac
[ "$CONCURRENCY" -lt 1 ] && CONCURRENCY=1
[ "$CONCURRENCY" -gt 50 ] && CONCURRENCY=50
if [ "$DRY_RUN" = 0 ]; then
  command -v curl >/dev/null 2>&1 || die "curl is needed but was not found."
fi

TMP_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t rest-runner) || die "Could not make a temporary folder."
# curl on Windows is a native program: give it a C:/... style path.
if command -v cygpath >/dev/null 2>&1; then TMP_DIR=$(cygpath -m "$TMP_DIR"); fi
trap 'rm -rf "$TMP_DIR"' EXIT
INTERRUPTED=0
trap 'INTERRUPTED=1' INT

awk "$CSV_AWK" "$CSV_FILE" >"$TMP_DIR/rows" || die "Could not read $CSV_FILE"
TOTAL=-1
while IFS= read -r line; do [ "$line" = E ] && TOTAL=$((TOTAL + 1)); done <"$TMP_DIR/rows"
if [ "$TOTAL" -lt 1 ]; then
  die "No data rows found in $CSV_FILE. The first line must be the column names."
fi
[ "$CONCURRENCY" -gt "$TOTAL" ] && CONCURRENCY=$TOTAL

if [ -z "$OUT_FILE" ]; then
  name=${CSV_FILE##*/}
  OUT_FILE="${name%.*}-results-$(date +%Y%m%d-%H%M%S).csv"
fi
DELAY_S=$(awk -v ms="$DELAY_MS" 'BEGIN { printf "%.3f", ms / 1000 }')

[ "$DRY_RUN" = 0 ] && printf 'Sending %d requests (%d at a time)%s...\n' "$TOTAL" "$CONCURRENCY" "$([ "$DELAY_MS" -gt 0 ] && printf ', %d ms apart' "$DELAY_MS")"
STARTED=$(date +%s)
COLS=()
NCOLS=-1
ROW=()
INDEX=0
PIDS=()
FIELDS=()
nf=0
while IFS= read -r line; do
  [ "$INTERRUPTED" = 1 ] && break
  if [ "$line" != E ]; then
    f=${line#F}
    case $f in *\\*) printf -v f '%b' "$f" ;; esac
    FIELDS[nf]=$f
    nf=$((nf + 1))
    continue
  fi
  if [ "$NCOLS" -lt 0 ]; then
    COLS=(${FIELDS[@]+"${FIELDS[@]}"})
    NCOLS=$nf
  else
    ROW=(${FIELDS[@]+"${FIELDS[@]}"})
    build_request
    if [ "$DRY_RUN" = 1 ]; then
      describe_request
      printf 'Row %d\n%s\n\n' "$((INDEX + 1))" "$REPLY"
    else
      wait_for_slot
      if [ "$INDEX" -ge "$CONCURRENCY" ] && [ "$DELAY_MS" -gt 0 ]; then sleep "$DELAY_S"; fi
      [ -e "$TMP_DIR/stop" ] || [ "$INTERRUPTED" = 1 ] && break
      run_row "$INDEX" &
      PIDS+=($!)
    fi
    INDEX=$((INDEX + 1))
  fi
  FIELDS=()
  nf=0
done <"$TMP_DIR/rows"

[ "$DRY_RUN" = 1 ] && exit 0
[ "$INTERRUPTED" = 1 ] && printf '\nStopping. Requests already sent are kept in the results.\n' >&2
while ! wait; do :; done

{
  line=''
  for cell in row result status status_text duration_ms sent_at method url request_headers request_body \
    response_headers response_body response_size_bytes error; do
    line+="${line:+,}$cell"
  done
  for cell in ${COLS[@]+"${COLS[@]}"}; do
    csvq "var:$cell"
    line+=",$REPLY"
  done
  printf '%s\r\n' "$line"
  SENT=0
  FAILED=0
  i=0
  while [ "$i" -lt "$TOTAL" ]; do
    if [ -f "$TMP_DIR/r$i.csv" ]; then
      cat "$TMP_DIR/r$i.csv"
      SENT=$((SENT + 1))
      [ -f "$TMP_DIR/r$i.fail" ] && FAILED=$((FAILED + 1))
    fi
    i=$((i + 1))
  done
  printf '%s %s\n' "$SENT" "$FAILED" >"$TMP_DIR/counts"
} >"$OUT_FILE"
read -r SENT FAILED <"$TMP_DIR/counts"

if [ "$INTERRUPTED" = 1 ]; then END=Stopped
elif [ -e "$TMP_DIR/stop" ] && [ "$SENT" -lt "$TOTAL" ]; then END='Stopped after a failure'
else END=Finished; fi
printf '%s: %d of %d sent, %d passed, %d failed in %d s. Results: %s\n' \
  "$END" "$SENT" "$TOTAL" "$((SENT - FAILED))" "$FAILED" "$(($(date +%s) - STARTED))" "$OUT_FILE"
if [ "$FAILED" -gt 0 ] || [ "$INTERRUPTED" = 1 ]; then exit 1; fi
exit 0
