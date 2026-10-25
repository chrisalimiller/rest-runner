import React from "react";
import ReactDOM from "react-dom/client";
import Root from "./Root";
import { setupWindowChrome } from "./lib/windowChrome";
import "./assets/fonts/jetbrains-mono/jetbrains-mono.css";
import "./styles.css";
import "./components/testing/testing.css";
import "./layout.css";

setupWindowChrome();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
