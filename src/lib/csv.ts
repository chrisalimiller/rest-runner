export interface CsvData {
  headers: string[];
  rows: Record<string, string>[];
  delimiter: string;
  warnings: string[];
}

const DELIMITERS = [",", ";", "\t", "|"];

/** Picks the delimiter that appears most often in the first line, ignoring quoted text. */
function detectDelimiter(text: string): string {
  const firstLine: string[] = [];
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    else if (!inQuotes) firstLine.push(ch);
  }
  let best = ",";
  let bestCount = 0;
  for (const d of DELIMITERS) {
    const count = firstLine.filter((c) => c === d).length;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** Splits CSV text into records of fields (RFC 4180: quoted fields, "" escapes, newlines inside quotes). */
export function parseRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else {
        field += ch;
      }
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\r") {
      endRecord();
      if (text[i + 1] === "\n") i += 1;
    } else if (ch === "\n") {
      endRecord();
    } else {
      field += ch;
    }
    i += 1;
  }
  if (field !== "" || record.length > 0) endRecord();
  return records;
}

/** Parses CSV text with a header row. Blank lines are skipped; header names are trimmed and made unique. */
export function parseCsv(input: string): CsvData {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const records = parseRecords(text, delimiter).filter((r) => !(r.length === 1 && r[0].trim() === ""));
  const warnings: string[] = [];

  if (records.length === 0) return { headers: [], rows: [], delimiter, warnings: ["The file is empty."] };

  const seen = new Map<string, number>();
  const headers = records[0].map((raw, i) => {
    let name = raw.trim() || `column${i + 1}`;
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    if (n > 0) {
      warnings.push(`Column "${name}" appears more than once; the copy is named "${name}_${n + 1}".`);
      name = `${name}_${n + 1}`;
    }
    return name;
  });

  let ragged = 0;
  const rows = records.slice(1).map((rec) => {
    if (rec.length !== headers.length) ragged += 1;
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = rec[i] ?? ""));
    return row;
  });
  if (ragged > 0) {
    warnings.push(`${ragged} row(s) have a different number of values than the header. Missing values are left empty and extra values are ignored.`);
  }

  return { headers, rows, delimiter, warnings };
}

const CSV_EXTENSIONS = [".csv", ".tsv", ".txt"];

/**
 * Checks that a picked file looks like CSV text. Returns a message saying why not, or null when it is fine.
 * A small mismatch of row lengths is left to parseCsv's warning; only a mostly ragged file is rejected here.
 */
export function checkCsvFile(name: string, input: string): string | null {
  const lower = name.toLowerCase();
  if (!CSV_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return `${name} isn't a CSV file. Choose a .csv, .tsv or .txt file.`;
  }
  const sample = input.slice(0, 65536);
  let bad = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 0) {
      bad = sample.length;
      break;
    }
    if (c === 0xfffd || (c < 32 && c !== 9 && c !== 10 && c !== 13)) bad += 1;
  }
  if (bad > 0 && (sample.includes("\0") || bad / sample.length > 0.01)) {
    return `${name} looks like a binary file, not CSV text. If it came from Excel, use File › Save As › CSV.`;
  }
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const start = text.trimStart();
  if (start.startsWith("{") || start.startsWith("[")) {
    try {
      JSON.parse(text);
      return `${name} is a JSON file, not CSV. Choose a .csv, .tsv or .txt file with a header row.`;
    } catch {
      // Not JSON; a CSV can start with a bracket.
    }
  }
  if (start.startsWith("<")) {
    return `${name} looks like XML or HTML, not CSV. Choose a .csv, .tsv or .txt file with a header row.`;
  }
  const records = parseRecords(text, detectDelimiter(text)).filter((r) => !(r.length === 1 && r[0].trim() === ""));
  if (records.length > 1 && records[0].length >= 2) {
    const width = records[0].length;
    const data = records.slice(1);
    const off = data.filter((r) => r.length !== width).length;
    if (off > data.length / 2) {
      return `Most rows don't match the header's ${width} columns. Check the file is a CSV with a header row.`;
    }
  }
  return null;
}
