import { useEffect, useState } from "react";
import App from "./App";
import { TestingApp } from "./components/testing/TestingApp";
import { load, save } from "./lib/storage";

type Section = "requests" | "testing";
const SECTION_KEY = "rest-runner.section";

/** The left rail switches between Requests and Testing. Both stay mounted so a running batch or suite keeps going. */
export default function Root() {
  const [section, setSection] = useState<Section>(() => load(SECTION_KEY, "requests"));
  useEffect(() => save(SECTION_KEY, section), [section]);

  return (
    <div className="app-shell">
      <nav className="rail" aria-label="Sections">
        <button className={section === "requests" ? "active" : ""} onClick={() => setSection("requests")} title="Requests">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2 3.5h12M2 8h12M2 12.5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
          </svg>
          <span>Requests</span>
        </button>
        <button className={section === "testing" ? "active" : ""} onClick={() => setSection("testing")} title="Testing">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
          <span>Testing</span>
        </button>
      </nav>
      <div className="root-section" hidden={section !== "requests"}>
        <App active={section === "requests"} />
      </div>
      <div className="root-section" hidden={section !== "testing"}>
        <TestingApp active={section === "testing"} />
      </div>
    </div>
  );
}
