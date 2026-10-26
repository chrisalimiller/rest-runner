import { reinsert, removeById } from "../../lib/listUndo";
import { useToast } from "../shell/Toast";
import { useDeferredDelete } from "../shell/useDeferredDelete";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseCsv } from "../../lib/csv";
import { environmentVars, guardFor, loadEnvironments, type Environment } from "../../lib/environments";
import { sendRequest } from "../../lib/http";
import { newId } from "../../lib/ids";
import { saveTextFile } from "../../lib/saveFile";
import { load, save } from "../../lib/storage";
import { planIterations, runCase, runSuite } from "../../lib/testing/runner";
import { createWorkerScriptRunner } from "../../lib/testing/scriptRunner";
import { cleanSuites, newSuite } from "../../lib/testing/suites";
import { buildTestRun, type TestRunSummary } from "../../lib/testing/testRun";
import { deleteTestRun, listTestRuns, saveTestRun } from "../../lib/testing/testRunStore";
import { importSuitesFile, toSuitesFile } from "../../lib/testing/suiteFile";
import type { CaseResult, TestCase, TestSuite } from "../../lib/testing/types";
import type { QuickItem } from "../../lib/quickOpen";
import { getTestRun } from "../../lib/testing/testRunStore";
import type { TestRun } from "../../lib/testing/testRun";
import type { ShellCommand, ShellProps } from "../../Root";
import { TopBar } from "../shell/TopBar";
import { LastRunPanel } from "./LastRunPanel";
import type { LiveRunState } from "./LiveRun";
import { SuiteEditor } from "./SuiteEditor";
import { MAX_SAVED_CSV, SuiteSettings } from "./SuiteSettings";
import { TestingSidebar } from "./TestingSidebar";
import { TestRunExplorer } from "./TestRunExplorer";

const SUITES_KEY = "rest-runner.test-suites";
const OPEN_SUITE_KEY = "rest-runner.test-open-suite";
const TEST_ENV_KEY = "rest-runner.test-environment";
const FLUSH_MS = 150;

/** Saves suites, leaving out CSV data too large for local storage. Returns false when storage refused. */
function persistSuites(suites: TestSuite[]): boolean {
  const slim = suites.map((s) => (s.data && s.data.text.length > MAX_SAVED_CSV ? { ...s, data: undefined } : s));
  try {
    localStorage.setItem(SUITES_KEY, JSON.stringify(slim));
    return true;
  } catch {
    return false;
  }
}

interface Props {
  /** True when the Testing section is on screen. */
  active: boolean;
  shell: ShellProps;
  command: ShellCommand | null;
}

/** A saved test run to show full width, optionally filtered to one case. */
interface OpenReport {
  id: string;
  caseId?: string;
  index?: number;
  check?: string;
}

/** The Testing section: suites of test cases, running them, and their reports. */
export function TestingApp({ active, shell, command }: Props) {
  const [suites, setSuites] = useState<TestSuite[]>(() => cleanSuites(load(SUITES_KEY, [])));
  const [openSuiteId, setOpenSuiteId] = useState<string | null>(() => load(OPEN_SUITE_KEY, null));
  /** The open case of each suite; null means all collapsed. Missing means the first case. */
  const [openCases, setOpenCases] = useState<Record<string, string | null>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [latestRun, setLatestRun] = useState<TestRun | null>(null);
  const [environments, setEnvironments] = useState<Environment[]>(loadEnvironments);
  const [envId, setEnvId] = useState<string | null>(() => load(TEST_ENV_KEY, null));
  const [runs, setRuns] = useState<TestRunSummary[]>([]);
  const [report, setReport] = useState<OpenReport | null>(null);
  const openRunId = report?.id ?? null;
  const setOpenRunId = (id: string | null) => setReport(id ? { id } : null);
  const [live, setLive] = useState<LiveRunState | null>(null);
  const [tryingCaseId, setTryingCaseId] = useState<string | null>(null);
  const [tryResults, setTryResults] = useState<Record<string, CaseResult>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bufferRef = useRef<CaseResult[]>([]);
  const scripts = useMemo(() => createWorkerScriptRunner(), []);
  useEffect(() => () => scripts.dispose(), [scripts]);

  useEffect(() => {
    if (!persistSuites(suites)) setNotice("Could not save suites: local storage is full. Try removing large CSV files from suites.");
  }, [suites]);
  useEffect(() => {
    save(OPEN_SUITE_KEY, openSuiteId);
  }, [openSuiteId]);
  useEffect(() => {
    save(TEST_ENV_KEY, envId);
  }, [envId]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  // Environments are edited in the Requests section; pick up changes whenever Testing is shown.
  useEffect(() => {
    if (active) setEnvironments(loadEnvironments());
  }, [active]);

  const refreshRuns = useCallback(() => {
    listTestRuns()
      .then(setRuns)
      .catch(() => setRuns([]));
  }, []);
  useEffect(refreshRuns, [refreshRuns]);
  const runDelete = useDeferredDelete(deleteTestRun, refreshRuns);
  const toast = useToast();

  const env = environments.find((e) => e.id === envId) ?? null;
  const envVars = useMemo(() => environmentVars(env), [env]);
  const suite = suites.find((s) => s.id === openSuiteId) ?? null;
  const openCaseId = suite ? (suite.id in openCases ? openCases[suite.id] : (suite.cases[0]?.id ?? null)) : null;
  const latestRunId = suite ? (runs.find((r) => r.suiteId === suite.id)?.id ?? null) : null;

  // Load the latest saved run of the open suite, for the Last run panel and Last result values.
  useEffect(() => {
    let live = true;
    if (!latestRunId) {
      setLatestRun(null);
      return;
    }
    getTestRun(latestRunId)
      .then((r) => live && setLatestRun(r ?? null))
      .catch(() => live && setLatestRun(null));
    return () => {
      live = false;
    };
  }, [latestRunId]);

  const updateSuite = (next: TestSuite) => setSuites((list) => list.map((s) => (s.id === next.id ? next : s)));

  // While running, move buffered results into state a few times a second.
  useEffect(() => {
    if (!live?.running) return;
    const t = setInterval(() => {
      if (!bufferRef.current.length) return;
      const batch = bufferRef.current;
      bufferRef.current = [];
      setLive((l) => (l ? { ...l, results: l.results.concat(batch) } : l));
    }, FLUSH_MS);
    return () => clearInterval(t);
  }, [live?.running]);

  const rowsFor = (s: TestSuite) => {
    if (!s.data) return { rows: null, columns: [] as string[] };
    const csv = parseCsv(s.data.text);
    return { rows: csv.rows, columns: csv.headers };
  };

  const run = async (s: TestSuite) => {
    if (abortRef.current) return;
    const snapshot = structuredClone(s);
    const { rows, columns } = rowsFor(snapshot);
    const iterations = planIterations(rows, snapshot.options.repeat).length;
    const planned = snapshot.cases.filter((c) => c.enabled).length * iterations;
    const controller = new AbortController();
    abortRef.current = controller;
    bufferRef.current = [];
    const startedAt = new Date();
    const all: CaseResult[] = [];
    setLive({ suiteId: s.id, running: true, planned, results: [], startedAt: startedAt.getTime() });
    // Fresh run results replace earlier Try case results for this suite's cases.
    setTryResults((t) => Object.fromEntries(Object.entries(t).filter(([id]) => !s.cases.some((c) => c.id === id))));

    const end = await runSuite(snapshot, {
      rows,
      envVars,
      send: sendRequest,
      scripts: scripts.run,
      signal: controller.signal,
      onResult: (r) => {
        all.push(r);
        bufferRef.current.push(r);
      },
    });
    abortRef.current = null;
    const finishedAt = new Date();
    const buffered = bufferRef.current;
    bufferRef.current = [];
    setLive((l) => (l ? { ...l, running: false, end, finishedAt: finishedAt.getTime(), results: l.results.concat(buffered) } : l));

    const testRun = buildTestRun({
      id: newId(),
      suite: snapshot,
      csvName: snapshot.data?.name,
      columns,
      iterations,
      environmentName: env?.name,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      end,
      results: all,
    });
    try {
      await saveTestRun(testRun);
      setLive((l) => (l && l.suiteId === s.id ? { ...l, runId: testRun.id } : l));
      refreshRuns();
    } catch (e) {
      setLive((l) => (l ? { ...l, saveError: e instanceof Error ? e.message : String(e) } : l));
    }
  };

  const tryCase = async (s: TestSuite, tc: TestCase) => {
    if (tryingCaseId) return;
    setTryingCaseId(tc.id);
    const { rows } = rowsFor(s);
    const iter = planIterations(rows, 1)[0];
    const controller = new AbortController();
    try {
      const result = await runCase(
        { testCase: tc, caseIndex: s.cases.indexOf(tc), iter, runVars: {} },
        s.options,
        { envVars, send: sendRequest, scripts: scripts.run, signal: controller.signal },
      );
      if (result) setTryResults((t) => ({ ...t, [tc.id]: result }));
    } finally {
      setTryingCaseId(null);
    }
  };

  const exportSuites = async () => {
    try {
      const result = await saveTextFile("rest-runner-test-suites.json", toSuitesFile(suites), "REST Runner test suites", "json");
      if (result.saved) setNotice(result.path ? `Exported to ${result.path}` : "Export downloaded.");
    } catch (e) {
      setNotice(`Could not export: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const importSuites = async (file: File) => {
    try {
      const result = importSuitesFile(await file.text(), suites);
      setSuites(result.suites);
      setNotice(`Imported ${file.name}: ${result.added} added, ${result.replaced} updated.`);
    } catch (e) {
      setNotice(`Could not import ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const createSuite = () => {
    const s = newSuite();
    setSuites((list) => [...list, s]);
    setOpenSuiteId(s.id);
    setOpenRunId(null);
  };

  const openItem = (item: QuickItem) => {
    if (item.kind === "suite" || item.kind === "case") {
      const suiteId = item.kind === "suite" ? item.id : item.parentId;
      if (!suiteId || !suites.some((x) => x.id === suiteId)) {
        setNotice("That suite no longer exists.");
        return;
      }
      setOpenSuiteId(suiteId);
      setOpenRunId(null);
      if (item.kind === "case") setOpenCases((o) => ({ ...o, [suiteId]: item.id }));
    } else if (item.kind === "test-run") {
      setOpenRunId(item.id);
    }
  };

  const lastCommand = useRef<number | null>(null);
  useEffect(() => {
    if (!command || lastCommand.current === command.nonce) return;
    lastCommand.current = command.nonce;
    if (command.type === "open") openItem(command.item);
    if (command.type === "reload") setSuites(cleanSuites(load(SUITES_KEY, [])));
  }, [command]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSettingsOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen]);

  const suiteLive = live && suite && live.suiteId === suite.id ? live : null;

  return (
    <div className="mode testing-mode">
      <TopBar
        mode="testing"
        onMode={shell.onMode}
        onQuickOpen={shell.onQuickOpen}
        searchPlaceholder="Jump to a suite, case or test run…"
        switcher={suite && openRunId === null ? <span className="topbar-title" title={suite.name}>{suite.name || "(unnamed)"}</span> : undefined}
        environments={environments}
        activeEnvId={envId}
        onEnvChange={setEnvId}
        envTitle="Environments are edited in Requests mode"
      />
      <div className={`runbook ${openRunId !== null ? "with-report" : ""}`}>
        <TestingSidebar
          suites={suites}
          activeSuiteId={openSuiteId}
          onOpenSuite={(id) => {
            setOpenSuiteId(id);
            setOpenRunId(null);
          }}
          onNewSuite={createSuite}
          onExport={() => void exportSuites()}
          onImport={(f) => void importSuites(f)}
          runs={runs.filter((r) => !runDelete.hidden.has(r.id))}
          activeRunId={openRunId}
          onOpenRun={setOpenRunId}
          runningSuiteId={live?.running ? live.suiteId : null}
        />
        {report !== null ? (
          <main className="workspace full-view">
            <TestRunExplorer
              runId={report.id}
              initialCaseId={report.caseId}
              initialIndex={report.index}
              initialCheck={report.check}
              onBack={() => setOpenRunId(null)}
              onDelete={(id) => {
                runDelete.request(id, "Deleted the test run");
                setOpenRunId(null);
              }}
            />
          </main>
        ) : suite ? (
          <>
            <SuiteEditor
              suite={suite}
              onChange={updateSuite}
              onDelete={() => {
                const taken = removeById(suites, suite.id);
                if (!taken) return;
                setSuites(taken.list);
                setOpenSuiteId(null);
                toast.show({
                  message: `Deleted the suite "${suite.name}"`,
                  onUndo: () => {
                    setSuites((list) => reinsert(list, taken.item, taken.index));
                    setOpenSuiteId(taken.item.id);
                  },
                });
              }}
              onDuplicate={() => {
                const copy = { ...structuredClone(suite), id: newId(), name: `${suite.name} copy` };
                setSuites((list) => [...list, copy]);
                setOpenSuiteId(copy.id);
              }}
              openCaseId={openCaseId}
              onOpenCase={(id) => setOpenCases((o) => ({ ...o, [suite.id]: id }))}
              onOpenSettings={() => setSettingsOpen(true)}
              running={!!suiteLive?.running}
              anyRunning={!!live?.running}
              onRun={() => void run(suite)}
              onStop={() => abortRef.current?.abort()}
              onTryCase={(tc) => void tryCase(suite, tc)}
              tryingCaseId={tryingCaseId}
              tryResults={tryResults}
              latestRun={latestRun && latestRun.suiteId === suite.id ? latestRun : null}
              envVars={envVars}
              envName={env?.name}
              guard={guardFor(env)}
              notice={notice}
            />
            <LastRunPanel
              live={suiteLive}
              run={latestRun && latestRun.suiteId === suite.id ? latestRun : null}
              onOpenReport={(id, caseId, index, check) => setReport({ id, caseId, index, check })}
            />
            {settingsOpen && (
              <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setSettingsOpen(false)}>
                <div className="sheet" role="dialog" aria-label="Run settings and data">
                  <div className="modal-head">
                    <h3>Run settings &amp; data</h3>
                    <button className="icon-btn" onClick={() => setSettingsOpen(false)} aria-label="Close">
                      ×
                    </button>
                  </div>
                  <div className="sheet-body">
                    <SuiteSettings suite={suite} onChange={updateSuite} envVarNames={Object.keys(envVars)} />
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <main className="suite-doc testing-empty">
            <div>
              <h2>Testing</h2>
              <p className="muted">
                Build suites of test cases from your saved requests, add assertions and scripts, and run them in order, in parallel, or once per CSV row.
              </p>
              {notice && <p className="small notice">{notice}</p>}
              <button className="send" onClick={createSuite}>
                Create a test suite
              </button>
            </div>
          </main>
        )}
      </div>
    </div>
  );
}
