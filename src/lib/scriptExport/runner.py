#!/usr/bin/env python3
# @@HEADER@@
#
# Needs Python 3.8 or newer and nothing else (no pip installs).
#
# Usage:
#   python3 @@FILE@@ @@CSV@@              (on Windows: py @@FILE@@ @@CSV@@)
#
# Options:
#   --concurrency N        requests in flight at once (1 to 50)
#   --delay-ms N           pause before each request after the first, per worker
#   --stop-on-failure      start no new requests after a failure
#   --no-stop-on-failure
#   --http-errors-fail     count 4xx and 5xx responses as failures
#   --no-http-errors-fail
#   --timeout SECONDS      give up on a request after this long (default 120)
#   --out FILE             where to write the results CSV
#   --dry-run              print the requests without sending them
#
# Each row of the CSV becomes one request. {{name}} placeholders take their value
# from the row's column of that name, then from DEFAULTS below. A placeholder with
# no value is sent as written, like in the app. The results CSV has the same
# columns as the app's CSV report. The exit code is 1 when any request failed.

import argparse
import base64
import csv
import datetime
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

# ---------- Settings exported from REST Runner. Edit them freely. ----------

@@SETTINGS@@

# ---------- Building the request (same rules as the app) ----------

PLACEHOLDER = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")


def apply_template(text, values):
    def repl(m):
        name = m.group(1)
        return values[name] if name in values else m.group(0)

    return PLACEHOLDER.sub(repl, text)


def json_escape(value):
    out = []
    for ch in value:
        code = ord(ch)
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        elif ch == "\b":
            out.append("\\b")
        elif ch == "\f":
            out.append("\\f")
        elif code < 0x20:
            out.append("\\u%04x" % code)
        else:
            out.append(ch)
    return "".join(out)


def apply_json_template(text, values):
    """Like apply_template, but a placeholder inside a JSON string gets its value escaped."""
    out = []
    in_string = False
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "{" and text[i + 1 : i + 2] == "{":
            close = text.find("}}", i + 2)
            name = "" if close == -1 else text[i + 2 : close].strip()
            if close != -1 and name != "" and "{" not in name and "}" not in name:
                if name in values:
                    out.append(json_escape(values[name]) if in_string else values[name])
                else:
                    out.append(text[i : close + 2])
                i = close + 2
                continue
        if in_string and ch == "\\":
            out.append(text[i : i + 2])
            i += 2
            continue
        if ch == '"':
            in_string = not in_string
        out.append(ch)
        i += 1
    return "".join(out)


def encode_component(text):
    # Same characters as JavaScript's encodeURIComponent.
    return urllib.parse.quote(text, safe="-_.!~*'()")


def encode_pairs(pairs):
    return "&".join(encode_component(k) + "=" + encode_component(v) for k, v in pairs)


def has_header(headers, name):
    return any(k.lower() == name.lower() for k, _ in headers)


def fill_rows(rows, values):
    return [[apply_template(k.strip(), values), apply_template(v, values)] for k, v in rows]


def prepare_request(values):
    req = REQUEST
    query = fill_rows(req["params"], values)
    headers = fill_rows(req["headers"], values)
    auth = req["auth"]
    kind = auth["type"]
    if kind == "bearer" and not has_header(headers, "Authorization"):
        headers.append(["Authorization", "Bearer " + apply_template(auth["token"], values)])
    elif kind == "basic" and not has_header(headers, "Authorization"):
        creds = apply_template(auth["username"], values) + ":" + apply_template(auth["password"], values)
        headers.append(["Authorization", "Basic " + base64.b64encode(creds.encode("utf-8")).decode("ascii")])
    elif kind == "apikey":
        key = apply_template(auth["key"], values).strip()
        if key != "":
            value = apply_template(auth["value"], values)
            if auth["addTo"] == "header":
                if not has_header(headers, key):
                    headers.append([key, value])
            else:
                query.append([key, value])

    body = None
    mode = req["bodyMode"]
    if req["method"] not in ("GET", "HEAD"):
        if mode in ("json", "text"):
            body = apply_json_template(req["body"], values) if mode == "json" else apply_template(req["body"], values)
            if not has_header(headers, "Content-Type"):
                headers.append(["Content-Type", "application/json" if mode == "json" else "text/plain"])
        elif mode == "urlencoded":
            body = encode_pairs(fill_rows(req["form"], values))
            if not has_header(headers, "Content-Type"):
                headers.append(["Content-Type", "application/x-www-form-urlencoded"])

    url = apply_template(req["url"], values).strip()
    if url != "" and not re.match(r"^[a-z][a-z0-9+.-]*://", url, re.I):
        url = "http://" + url
    if query:
        base, hash_mark, fragment = url.partition("#")
        if "?" in base:
            sep = "" if base.endswith("?") or base.endswith("&") else "&"
        else:
            sep = "?"
        url = base + sep + encode_pairs(query) + hash_mark + fragment
    return {"method": req["method"], "url": url, "headers": headers, "body": body}


# ---------- Reading the CSV (same rules as the app) ----------


def detect_delimiter(text):
    counts = {d: 0 for d in [",", ";", "\t", "|"]}
    in_quotes = False
    for ch in text:
        if ch == '"':
            in_quotes = not in_quotes
        elif not in_quotes and ch in "\r\n":
            break
        elif not in_quotes and ch in counts:
            counts[ch] += 1
    best, best_count = ",", 0
    for d in [",", ";", "\t", "|"]:
        if counts[d] > best_count:
            best, best_count = d, counts[d]
    return best


def parse_records(text, delimiter):
    records, record, field = [], [], []
    in_quotes = False
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if in_quotes:
            if ch == '"':
                if text[i + 1 : i + 2] == '"':
                    field.append('"')
                    i += 2
                    continue
                in_quotes = False
            else:
                field.append(ch)
            i += 1
            continue
        if ch == '"' and not field:
            in_quotes = True
        elif ch == delimiter:
            record.append("".join(field))
            field = []
        elif ch == "\r" or ch == "\n":
            record.append("".join(field))
            records.append(record)
            record, field = [], []
            if ch == "\r" and text[i + 1 : i + 2] == "\n":
                i += 1
        else:
            field.append(ch)
        i += 1
    if field or record:
        record.append("".join(field))
        records.append(record)
    return records


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        text = f.read()
    delimiter = detect_delimiter(text)
    records = [r for r in parse_records(text, delimiter) if not (len(r) == 1 and r[0].strip() == "")]
    if not records:
        return [], []
    seen = {}
    headers = []
    for i, raw in enumerate(records[0]):
        name = raw.strip() or "column%d" % (i + 1)
        count = seen.get(name, 0)
        seen[name] = count + 1
        if count > 0:
            warn('Column "%s" appears more than once; the copy is named "%s_%d".' % (name, name, count + 1))
            name = "%s_%d" % (name, count + 1)
        headers.append(name)
    rows = []
    ragged = 0
    for rec in records[1:]:
        if len(rec) != len(headers):
            ragged += 1
        rows.append({h: (rec[i] if i < len(rec) else "") for i, h in enumerate(headers)})
    if ragged:
        warn("%d row(s) have a different number of values than the header. Missing values are left empty and extra values are ignored." % ragged)
    return headers, rows


# ---------- Sending ----------


def make_opener():
    # Follows redirects. 4xx and 5xx responses arrive as HTTPError and are kept as responses in send().
    opener = urllib.request.build_opener()
    opener.addheaders = [("User-Agent", "rest-runner-script")]
    return opener


def send(opener, prepared, timeout):
    sent_at = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    data = prepared["body"].encode("utf-8") if prepared["body"] is not None else None
    start = time.perf_counter()
    try:
        req = urllib.request.Request(prepared["url"], data=data, method=prepared["method"])
        for k, v in prepared["headers"]:
            req.add_header(k, v)
        res = opener.open(req, timeout=timeout)
    except urllib.error.HTTPError as e:  # a 4xx or 5xx response
        res = e
    except Exception as e:  # connection refused, DNS failure, timeout, bad URL...
        reason = getattr(e, "reason", None) or e
        return {"ok": False, "sent_at": sent_at, "duration_ms": round((time.perf_counter() - start) * 1000), "error": str(reason)}
    try:
        raw = res.read()
    except Exception as e:
        return {"ok": False, "sent_at": sent_at, "duration_ms": round((time.perf_counter() - start) * 1000), "error": "Reading the response failed: %s" % e}
    finally:
        res.close()
    status = res.status if hasattr(res, "status") else res.code
    return {
        "ok": True,
        "sent_at": sent_at,
        "duration_ms": round((time.perf_counter() - start) * 1000),
        "status": status,
        "status_text": res.reason or "",
        "headers": list(res.headers.items()),
        "body": raw.decode("utf-8", errors="replace"),
        "size": len(raw),
    }


# ---------- Running the batch ----------


def warn(message):
    print("Warning: " + message, file=sys.stderr)


def header_lines(headers):
    return "\n".join("%s: %s" % (k, v) for k, v in headers)


def describe(prepared):
    lines = ["%s %s" % (prepared["method"], prepared["url"])]
    lines += ["%s: %s" % (k, v) for k, v in prepared["headers"]]
    if prepared["body"]:
        lines += ["", prepared["body"]]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Sends the request once per CSV row.")
    parser.add_argument("csv", nargs="?", default=DEFAULT_CSV, metavar="CSV", help="the CSV file" + (" (default: %s)" % DEFAULT_CSV.replace("%", "%%") if DEFAULT_CSV else ""))
    parser.add_argument("--concurrency", type=int, default=OPTIONS["concurrency"])
    parser.add_argument("--delay-ms", type=int, default=OPTIONS["delay_ms"])
    parser.add_argument("--stop-on-failure", dest="stop_on_failure", action="store_true", default=OPTIONS["stop_on_failure"])
    parser.add_argument("--no-stop-on-failure", dest="stop_on_failure", action="store_false")
    parser.add_argument("--http-errors-fail", dest="http_errors_fail", action="store_true", default=OPTIONS["http_errors_fail"])
    parser.add_argument("--no-http-errors-fail", dest="http_errors_fail", action="store_false")
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--out", help="results CSV (default: <csv name>-results-<time>.csv)")
    parser.add_argument("--dry-run", action="store_true", help="print the requests without sending them")
    args = parser.parse_args()

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
        sys.stderr.reconfigure(errors="replace")

    if not args.csv:
        print("Give the CSV file to read, for example: python3 %s data.csv" % os.path.basename(sys.argv[0]), file=sys.stderr)
        return 2
    try:
        columns, rows = read_csv(args.csv)
    except OSError as e:
        print("Could not read %s: %s" % (args.csv, e), file=sys.stderr)
        return 2
    if not rows:
        print("No data rows found in %s. The first line must be the column names." % args.csv, file=sys.stderr)
        return 2

    if args.dry_run:
        for index, row in enumerate(rows):
            values = dict(DEFAULTS)
            values.update(row)
            print("Row %d\n%s\n" % (index + 1, describe(prepare_request(values))))
        return 0

    concurrency = max(1, min(50, args.concurrency, len(rows)))
    delay = max(0, args.delay_ms) / 1000.0
    out_path = args.out or "%s-results-%s.csv" % (
        os.path.splitext(os.path.basename(args.csv))[0],
        datetime.datetime.now().strftime("%Y%m%d-%H%M%S"),
    )
    opener = make_opener()
    lock = threading.Lock()
    state = {"next": 0, "stop": False, "done": 0, "failed": 0}
    results = {}
    total = len(rows)
    width = len(str(total))

    def worker():
        first = True
        while True:
            if not first and delay:
                time.sleep(delay)
            first = False
            with lock:
                if state["stop"] or state["next"] >= total:
                    return
                index = state["next"]
                state["next"] += 1
            values = dict(DEFAULTS)
            values.update(rows[index])
            prepared = prepare_request(values)
            outcome = send(opener, prepared, args.timeout)
            failed = (not outcome["ok"]) or (args.http_errors_fail and outcome["status"] >= 400)
            with lock:
                results[index] = (prepared, outcome, failed)
                state["done"] += 1
                if failed:
                    state["failed"] += 1
                    if args.stop_on_failure:
                        state["stop"] = True
                label = str(outcome["status"]) if outcome["ok"] else "ERR"
                note = "" if outcome["ok"] else "  " + outcome["error"]
                print(
                    "[%*d/%d] %s %3s %6d ms  row %d  %s %s%s"
                    % (width, state["done"], total, "FAIL" if failed else "PASS", label, outcome["duration_ms"], index + 1, prepared["method"], prepared["url"], note),
                    flush=True,
                )

    print("Sending %d requests (%d at a time)%s..." % (total, concurrency, "" if not delay else ", %d ms apart" % args.delay_ms), flush=True)
    started = time.perf_counter()
    threads = [threading.Thread(target=worker, daemon=True) for _ in range(concurrency)]
    for t in threads:
        t.start()
    cancelled = False
    try:
        for t in threads:
            while t.is_alive():
                t.join(0.2)
    except KeyboardInterrupt:
        cancelled = True
        with lock:
            state["stop"] = True
        print("\nStopping. Requests already sent are kept in the results.", file=sys.stderr)

    with lock:
        finished = sorted(results.items())
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(
            ["row", "result", "status", "status_text", "duration_ms", "sent_at", "method", "url", "request_headers", "request_body",
             "response_headers", "response_body", "response_size_bytes", "error"] + ["var:" + c for c in columns]
        )
        for index, (prepared, outcome, failed) in finished:
            ok = outcome["ok"]
            writer.writerow(
                [index + 1, "FAIL" if failed else "PASS", outcome["status"] if ok else "ERR", outcome.get("status_text", ""),
                 outcome["duration_ms"], outcome["sent_at"], prepared["method"], prepared["url"], header_lines(prepared["headers"]),
                 prepared["body"] or "", header_lines(outcome["headers"]) if ok else "", outcome["body"] if ok else "",
                 outcome["size"] if ok else "", "" if ok else outcome["error"]]
                + [rows[index].get(c, "") for c in columns]
            )

    passed = len(finished) - state["failed"]
    end = "Stopped" if cancelled else ("Stopped after a failure" if state["stop"] and len(finished) < total else "Finished")
    print(
        "%s: %d of %d sent, %d passed, %d failed in %.1f s. Results: %s"
        % (end, len(finished), total, passed, state["failed"], time.perf_counter() - started, out_path)
    )
    return 1 if state["failed"] or cancelled else 0


if __name__ == "__main__":
    sys.exit(main())
