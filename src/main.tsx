import React from "react";
import ReactDOM from "react-dom/client";
import Root from "./Root";
import { ErrorBoundary } from "./components/shell/ErrorBoundary";
import { ToastProvider } from "./components/shell/Toast";
import { installStorageRedaction } from "./lib/redactStorage";
import { initSecretStore } from "./lib/secretStore";
import { initTheme } from "./lib/theme";
import { showWindowWhenReady } from "./lib/showWindow";
import { setupWindowChrome } from "./lib/windowChrome";
import "./assets/fonts/red-hat-text/red-hat-text.css";
import "./assets/fonts/red-hat-display/red-hat-display.css";
import "./assets/fonts/jetbrains-mono/jetbrains-mono.css";
import "./styles.css";
import "./components/testing/testing.css";
import "./layout.css";

installStorageRedaction();
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
});
