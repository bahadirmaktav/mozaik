import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// The WebView's own menu (Back, Save as, Print…) never appears; tools open their own menus.
document.addEventListener("contextmenu", (event) => event.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
