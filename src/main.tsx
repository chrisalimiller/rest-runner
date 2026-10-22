import React from "react";
import ReactDOM from "react-dom/client";
import Root from "./Root";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";
import "./components/testing/testing.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
