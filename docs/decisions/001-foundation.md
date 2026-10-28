# 001 — Foundation

- Start from the official `create-tauri-app` React/TypeScript template, Tauri 2.
- Use an application-owned binary split tree. Pure TypeScript actions allow deterministic
  layout tests without IPC or a native window. Ratios remain in memory only.
- Each process launch starts an empty workspace; the New window command creates another
  isolated renderer. No single-instance plugin or session/layout persistence.
- All built-ins are trusted and bundled. Remove the template's opener plugin; no general
  filesystem, process, shell or external navigation capability is exposed to the renderer.
- Windows NSIS and Linux deb/AppImage are initial packaging candidates. Installation and
  Wayland compatibility remain unverified until tested on those systems.
- Use Vitest for domain tests and Playwright for browser interaction tests. Browser tests
  do not substitute for WebView2/WebKitGTK smoke tests.

References: [Tauri scaffold](https://v2.tauri.app/start/create-project/),
[capabilities](https://v2.tauri.app/security/capabilities/).
