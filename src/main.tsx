import React from "react";
import ReactDOM from "react-dom/client";
import Root from "./Root";
import { ErrorBoundary } from "./components/shell/ErrorBoundary";
import { ToastProvider } from "./components/shell/Toast";
import { setupWindowChrome } from "./lib/windowChrome";
import "./assets/fonts/red-hat-text/red-hat-text.css";
import "./assets/fonts/red-hat-display/red-hat-display.css";
import "./assets/fonts/jetbrains-mono/jetbrains-mono.css";
import "./styles.css";
import "./components/testing/testing.css";
import "./layout.css";

setupWindowChrome();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <Root />
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
