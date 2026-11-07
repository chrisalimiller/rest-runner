#!/usr/bin/env python3
# @@HEADER@@
#
# Needs Python 3.8 or newer, nothing to install.
# Run it:  python3 @@FILE@@ @@CSV@@     (on Windows: py @@FILE@@ @@CSV@@)
#
# Each CSV row becomes one request, sent one at a time. {{name}} placeholders take
# the value of the row's column with that name, then of VALUES below. A placeholder
# with no value is sent as written. The exit code is 1 when any request failed.

import base64
import csv
import datetime
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# ---------- Settings. Edit them freely. ----------

@@SETTINGS@@

# ---------- The request ----------

@@REQUEST@@

# ---------- Helpers ----------


def fill(text, v):
    """Replaces {{name}} with v[name]. Unknown names stay as written."""
    return re.sub(r"\{\{\s*([^{}]+?)\s*\}\}", lambda m: v.get(m.group(1), m.group(0)), text)

#@if json

def fill_json(text, v):
    """Like fill, but a value inside a JSON string is escaped so the JSON stays valid."""
    out, in_string, i = [], False, 0
    while i < len(text):
        close = text.find("}}", i + 2) if text.startswith("{{", i) else -1
        name = text[i + 2 : close].strip() if close != -1 else ""
        if name and "{" not in name and "}" not in name:
            if name in v:
                out.append(json.dumps(v[name], ensure_ascii=False)[1:-1] if in_string else v[name])
            else:
                out.append(text[i : close + 2])
            i = close + 2
            continue
        step = 2 if in_string and text[i] == "\\" else 1
        if text[i] == '"':
            in_string = not in_string
        out.append(text[i : i + step])
        i += step
    return "".join(out)
#@end


def encode(pairs):
    return "&".join(urllib.parse.quote(k, safe="-_.!~*'()") + "=" + urllib.parse.quote(val, safe="-_.!~*'()") for k, val in pairs)


def full_url(url, query):
    """Adds http:// when there is no scheme and appends the query parameters."""
    url = url.strip()
    if url and not re.match(r"^[a-z][a-z0-9+.-]*://", url, re.I):
        url = "http://" + url
    if not query:
        return url
    base, hash_mark, fragment = url.partition("#")
    sep = "?" if "?" not in base else "" if base.endswith(("?", "&")) else "&"
    return base + sep + encode(query) + hash_mark + fragment


def read_csv(path):
    """Reads the CSV like the app: the separator is whichever of , ; tab | the first line has most of."""
    with open(path, encoding="utf-8-sig", newline="") as f:
        text = f.read()
    first_line = re.split(r"[\r\n]", re.sub(r'"[^"]*"?', "", text), maxsplit=1)[0]
    delimiter = max(",;\t|", key=first_line.count) if first_line else ","
    records = [r for r in csv.reader(io.StringIO(text), delimiter=delimiter) if r and not (len(r) == 1 and not r[0].strip())]
    if not records:
        return []
    columns = []
    for i, name in enumerate(records[0]):
        name = name.strip() or "column%d" % (i + 1)
        copies = sum(1 for c in records[0][:i] if c.strip() == name)
        columns.append("%s_%d" % (name, copies + 1) if copies else name)
    return [dict(zip(columns, r + [""] * (len(columns) - len(r)))) for r in records[1:]]

#@if cert

def ssl_context():
    import ssl

    ctx = ssl.create_default_context(cafile=CA_CERT or None) if CA_ONLY else ssl.create_default_context()
    if CA_CERT and not CA_ONLY:
        ctx.load_verify_locations(cafile=CA_CERT)
    if CLIENT_CERT:
        if CLIENT_CERT.lower().endswith((".p12", ".pfx")):
            sys.exit("Python cannot read .p12/.pfx files. Convert it first with\n  openssl pkcs12 -in %s -out client.pem -nodes\nthen set CLIENT_CERT = \"client.pem\"." % CLIENT_CERT)
        ctx.load_cert_chain(CLIENT_CERT, CLIENT_KEY or None, os.environ.get("REST_RUNNER_CERT_PASSPHRASE") or None)
    return ctx

OPENER = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl_context()))
#@end
#@if !cert
OPENER = urllib.request.build_opener()
#@end


def send(method, url, headers, body):
    """Sends the request. Returns (status, response message, error)."""
    req = urllib.request.Request(url, data=None if body is None else body.encode("utf-8"), method=method)
    req.add_header("User-Agent", "rest-runner-script")
    for k, val in headers:
        req.add_header(k, val)
    try:
        try:
            res = OPENER.open(req, timeout=TIMEOUT)
        except urllib.error.HTTPError as e:  # a 4xx or 5xx response is still a response
            res = e
        with res:
            text = res.read().decode("utf-8", errors="replace")
    except Exception as e:  # no response: connection refused, DNS failure, timeout...
        return None, "", str(getattr(e, "reason", None) or e)
    status = res.status if hasattr(res, "status") else res.code
    return status, message(("HTTP %d %s" % (status, res.reason or "")).strip(), list(res.headers.items()), text), ""


def message(first_line, headers, body):
    """A request or response as text: first line, headers, a blank line and the body."""
    lines = [first_line] + ["%s: %s" % (k, val) for k, val in headers]
    return "\n".join(lines + ["", body] if body else lines)


def cell(text):
    """Stops spreadsheets running a cell as a formula and keeps it under Excel's 32,767 characters."""
    text = str(text)
    if re.match(r"^[\s\x00-\x1f\x7f]*[=+@-]", text):
        text = "'" + text
    return text if len(text) <= 32000 else text[:32000] + "... [cut]"


def main():
    csv_file = sys.argv[1] if len(sys.argv) > 1 else CSV_FILE
    if not csv_file or csv_file.startswith("-"):
        print("Give the CSV file to read, for example: python3 %s data.csv\nOther settings are at the top of the script." % os.path.basename(sys.argv[0]), file=sys.stderr)
        return 2
    try:
        rows = read_csv(csv_file)
    except OSError as e:
        print("Could not read %s: %s" % (csv_file, e), file=sys.stderr)
        return 2
    if not rows:
        print("No data rows found in %s. The first line must be the column names." % csv_file, file=sys.stderr)
        return 2

    if DRY_RUN:
        for i, row in enumerate(rows):
            method, url, headers, body = build_request({**VALUES, **row})
            print("Row %d\n%s\n" % (i + 1, message(method + " " + url, headers, body)))
        return 0

    out_path = RESULTS_FILE or "%s-results-%s.csv" % (os.path.splitext(os.path.basename(csv_file))[0], datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
    sent = failed = 0
    end = "Finished"
    started = time.perf_counter()
    print("Sending %d requests..." % len(rows), flush=True)
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        out = csv.writer(f)
        out.writerow(["row", "result", "status", "duration_ms", "url", "request", "response", "error"])
        try:
            for i, row in enumerate(rows):
                if i and DELAY_MS:
                    time.sleep(DELAY_MS / 1000)
                method, url, headers, body = build_request({**VALUES, **row})
                start = time.perf_counter()
                status, response, error = send(method, url, headers, body)
                ms = round((time.perf_counter() - start) * 1000)
                ok = status is not None and not (HTTP_ERRORS_FAIL and status >= 400)
                sent += 1
                failed += not ok
                result = "PASS" if ok else "FAIL"
                print("%s %3s %6d ms  row %d  %s %s  %s" % (result, status or "ERR", ms, i + 1, method, url, error), flush=True)
                out.writerow(map(cell, [i + 1, result, status or "ERR", ms, url, message(method + " " + url, headers, body), response, error]))
                if not ok and STOP_ON_FAILURE and i + 1 < len(rows):
                    end = "Stopped after a failure"
                    break
        except KeyboardInterrupt:
            end = "Stopped"
    print("%s: %d of %d sent, %d passed, %d failed in %.1f s. Results: %s" % (end, sent, len(rows), sent - failed, failed, time.perf_counter() - started, out_path))
    return 1 if failed or end == "Stopped" else 0


if __name__ == "__main__":
    sys.exit(main())
