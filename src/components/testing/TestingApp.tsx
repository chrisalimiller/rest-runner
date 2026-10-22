import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseCsv } from "../../lib/csv";
import { environmentVars, type Environment } from "../../lib/environments";
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
import type { LiveRunState } from "./LiveRun";
import { SuiteEditor, type SuitePanel } from "./SuiteEditor";
import { MAX_SAVED_CSV } from "./SuiteSettings";
import { TestingSidebar } from "./TestingSidebar";
import { TestRunExplorer } from "./TestRunExplorer";

const SUITES_KEY = "rest-runner.test-suites";
const OPEN_SUITE_KEY = "rest-runner.test-open-suite";
const TEST_ENV_KEY = "rest-runner.test-environment";
const ENVIRONMENTS_KEY = "rest-runner.environments";
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
}

/** The Testing section: suites of test cases, running them, and their reports. */
export function TestingApp({ active }: Props) {
  const [suites, setSuites] = useState<TestSuite[]>(() => cleanSuites(load(SUITES_KEY, [])));
  const [openSuiteId, setOpenSuiteId] = useState<string | null>(() => load(OPEN_SUITE_KEY, null));
  const [panels, setPanels] = useState<Record<string, SuitePanel>>({});
  const [environments, setEnvironments] = useState<Environment[]>(() => load(ENVIRONMENTS_KEY, []));
  const [envId, setEnvId] = useState<string | null>(() => load(TEST_ENV_KEY, null));
  const [runs, setRuns] = useState<TestRunSummary[]>([]);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
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
    if (active) setEnvironments(load(ENVIRONMENTS_KEY, []));
  }, [active]);

  const refreshRuns = useCallback(() => {
    listTestRuns()
      .then(setRuns)
      .catch(() => setRuns([]));
  }, []);
  useEffect(refreshRuns, [refreshRuns]);

  const env = environments.find((e) => e.id === envId) ?? null;
  const envVars = useMemo(() => environmentVars(env), [env]);
  const suite = suites.find((s) => s.id === openSuiteId) ?? null;
  const panel: SuitePanel = (suite && panels[suite.id]) || (suite?.cases[0] ? { kind: "case", id: suite.cases[0].id } : { kind: "settings" });

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
    setPanels((p) => ({ ...p, [s.id]: { kind: "run" } }));

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

  return (
    <div className="app">
      <TestingSidebar
        suites={suites}
        activeSuiteId={openSuiteId}
        onOpenSuite={(id) => {
          setOpenSuiteId(id);
          setOpenRunId(null);
        }}
        onNewSuite={() => {
          const s = newSuite();
          setSuites((list) => [...list, s]);
          setOpenSuiteId(s.id);
          setOpenRunId(null);
        }}
        onExport={() => void exportSuites()}
        onImport={(f) => void importSuites(f)}
        runs={runs}
        activeRunId={openRunId}
        onOpenRun={setOpenRunId}
        runningSuiteId={live?.running ? live.suiteId : null}
      />
      {openRunId !== null ? (
        <main className="workspace">
          <TestRunExplorer
            runId={openRunId}
            onBack={() => setOpenRunId(null)}
            onDelete={(id) => {
              void deleteTestRun(id).finally(refreshRuns);
              setOpenRunId(null);
            }}
          />
        </main>
      ) : suite ? (
        <SuiteEditor
          suite={suite}
          onChange={updateSuite}
          onDelete={() => {
            setSuites((list) => list.filter((s) => s.id !== suite.id));
            setOpenSuiteId(null);
          }}
          onDuplicate={() => {
            const copy = { ...structuredClone(suite), id: newId(), name: `${suite.name} copy` };
            setSuites((list) => [...list, copy]);
            setOpenSuiteId(copy.id);
          }}
          panel={panel}
          onPanel={(p) => setPanels((all) => ({ ...all, [suite.id]: p }))}
          environments={environments}
          envId={envId}
          onEnvChange={setEnvId}
          envVarNames={Object.keys(envVars)}
          live={live}
          anyRunning={!!live?.running}
          onRun={() => void run(suite)}
          onStop={() => abortRef.current?.abort()}
          onOpenReport={setOpenRunId}
          onTryCase={(tc) => void tryCase(suite, tc)}
          tryingCaseId={tryingCaseId}
          tryResults={tryResults}
          notice={notice}
        />
      ) : (
        <main className="workspace testing-empty">
          <div>
            <h2>Testing</h2>
            <p className="muted">
              Build suites of test cases from your saved requests, add assertions and scripts, and run them in order, in parallel, or once per CSV row.
            </p>
            {notice && <p className="small notice">{notice}</p>}
            <button
              className="send"
              onClick={() => {
                const s = newSuite();
                setSuites((list) => [...list, s]);
                setOpenSuiteId(s.id);
              }}
            >
              Create a test suite
            </button>
          </div>
        </main>
      )}
    </div>
  );
}
