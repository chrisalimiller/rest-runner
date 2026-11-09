import React from "react";
import ReactDOM from "react-dom/client";
import Root from "./Root";
import { ErrorBoundary } from "./components/shell/ErrorBoundary";
import { ToastProvider } from "./components/shell/Toast";
import { initSecretStore } from "./lib/secretStore";
import { runSecretsMigration } from "./lib/secretsMigration";
import { initTheme } from "./lib/theme";
import { showWindowWhenReady } from "./lib/showWindow";
import { setupWindowChrome } from "./lib/windowChrome";
import "./assets/fonts/red-hat-text/red-hat-text.css";
import "./assets/fonts/red-hat-display/red-hat-display.css";
import "./assets/fonts/jetbrains-mono/jetbrains-mono.css";
import "./styles.css";
import "./components/testing/testing.css";
import "./layout.css";

initTheme();
setupWindowChrome();
showWindowWhenReady();

// Load secrets from the keychain first (bounded by an internal timeout) so the first render has them.
void initSecretStore().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <ToastProvider>
          <Root />
        </ToastProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
  // After the first render: moves any plain-text secrets from local storage into the keychain (retried next launch on failure).
  void runSecretsMigration();
});
