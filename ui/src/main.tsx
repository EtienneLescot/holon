import React from "react";
import ReactDOM from "react-dom/client";

// BrowserBridge is only needed for standalone dev mode, not for VS Code extension
if (import.meta.env?.DEV && !(window as any).acquireVsCodeApi) {
  import("./browserBridge");
}

import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
