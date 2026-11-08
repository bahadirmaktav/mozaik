import { test, expect, type Page } from "@playwright/test";
import { closeSettings } from "./settings";

// Browser runs have no native backend. This replaces the typed IDE, CMake and filesystem
// adapters with an in-memory C++ project, a fake Git status, a scripted CMake and a small
// fake language server that speaks LSP JSON-RPC, so it covers the IDE panels and the client
// wiring, not native processes, CMake, clangd itself or disk writes.
async function start(
  page: Page,
  options: { server?: boolean; recent?: boolean } = {},
) {
  await page.goto("/");
  await expect(page.locator(".titlebar")).toBeVisible();
  await page.evaluate(async ({ server, recent }) => {
    const loaded = (path: string) =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((url) => new URL(url).pathname === path) ?? path;
    const ide = (await import(loaded("/src/services/ide.ts"))).ideBackend;
    const cmake = (await import(loaded("/src/services/cmake.ts"))).cmakeBackend;
    const fs = (await import(loaded("/src/services/filesystem.ts"))).fileSystem;
    const dbg = (await import(loaded("/src/services/debug.ts"))).debugBackend;
    // clang-tidy: one finding with a fix in main.cpp, as Rust reports it.
    const analysis = (await import(loaded("/src/services/analysis.ts")))
      .analysisBackend;
    const analyses: { file: string | null }[] = [];
    analysis.info = async () => ({
      settings: {
        clangTidyEnabled: true,
        maxParallelJobs: 2,
        autoAnalysis: "off",
      },
      program: "/usr/bin/clang-tidy",
      configured: false,
      version: "LLVM version 21.1.4",
    });
    analysis.changed = async () => [];
    analysis.run = async (
      _root: string,
      file: string | null,
      onEvent: (event: unknown) => void,
    ) => {
      analyses.push({ file });
      const main = "/proj/src/main.cpp";
      onEvent({ kind: "started", total: 1, build: "/proj/build/gcc-15-Debug" });
      onEvent({
        kind: "output",
        text: `[clang-tidy] clang-tidy -p /proj/build/gcc-15-Debug ${main}
1 warning generated.
`,
      });
      onEvent({
        kind: "file",
        result: {
          path: main,
          code: 0,
          hashes: { [main]: "h" },
          findings: [
            {
              path: main,
              position: { line: 3, character: 6 },
              severity: 2,
              level: "Warning",
              rule: "misc-const-correctness",
              message: "variable 'total' can be declared 'const'",
              related: [],
              fix: [
                {
                  path: main,
                  start: { line: 3, character: 2 },
                  end: { line: 3, character: 2 },
                  newText: "const ",
                },
              ],
            },
          ],
        },
      });
      return { files: 1, cancelled: false };
    };
    (window as any).__analyses = analyses;
    // SonarQube: a server whose merge request analysis read main.cpp and util.cpp as they
    // are on disk; the second refresh, after CI ran again, has one issue fixed and one new.
    const sonar = (await import(loaded("/src/services/sonar.ts"))).sonarBackend;
    const sonarState = {
      connected: null as null | { url: string; projectKey: string },
      connects: [] as unknown[],
      fetches: [] as { branch: string | null; mainOnly: boolean }[],
      round: 0,
    };
    (window as any).__sonar = sonarState;
    const properties = {
      file: "/proj/sonar-project.properties",
      hostUrl: "https://sonar.example.com",
      projectKey: "demo",
      baseDir: null,
      hasToken: false,
    };
    const sonarInfo = () => ({
      binding: sonarState.connected,
      hasToken: !!sonarState.connected,
      insecure: false,
      properties,
    });
    const sonarIssue = (
      key: string,
      file: string,
      line: number,
      message: string,
      severity = 2,
    ) => ({
      key,
      rule: "cpp:S" + key.charCodeAt(0),
      severity,
      level: severity === 1 ? "HIGH (reliability)" : "MEDIUM (maintainability)",
      kind: "CODE_SMELL",
      message,
      path: `/proj/src/${file}`,
      relative: `src/${file}`,
      range: { startLine: line, endLine: line, startOffset: 2, endOffset: 11 },
      effort: "5min",
      created: null,
    });
    sonar.info = async () => sonarInfo();
    sonar.connect = async (
      _root: string,
      url: string,
      projectKey: string,
      token: string | null,
    ) => {
      sonarState.connects.push({ url, projectKey, token });
      sonarState.connected = { url, projectKey };
      return sonarInfo();
    };
    sonar.disconnect = async () => {
      sonarState.connected = null;
      return sonarInfo();
    };
    sonar.fetch = async (
      _root: string,
      branch: string | null,
      mainOnly: boolean,
    ) => {
      sonarState.fetches.push({ branch, mainOnly });
      const second = sonarState.round++ > 0;
      return {
        target: {
          kind: "pullRequest",
          key: "42",
          title: "Count totals",
          branch: branch ?? "main",
          url: "https://git.example.com/demo/-/merge_requests/42",
        },
        revision: "60f6d77f3097c80c87891616cc32d7b447335961",
        analysisDate: new Date().toISOString(),
        qualityGate: {
          status: "ERROR",
          failing: [
            {
              metric: "new_code_smells",
              comparator: "GT",
              threshold: "0",
              actual: "2",
            },
          ],
        },
        issues: [
          ...(second
            ? []
            : [sonarIssue("A", "main.cpp", 4, "Make 'total' const")]),
          sonarIssue("B", "main.cpp", 5, "Return the call directly", 1),
          sonarIssue("C", "util.cpp", 3, "Mark 'twice' static"),
          ...(second
            ? [sonarIssue("D", "util.cpp", 1, "Include what you use")]
            : []),
        ],
        total: second ? 3 : 3,
        truncated: false,
        skipped: 0,
        log: [
          "GET /api/project_pull_requests/list?project=demo",
          "GET /api/issues/search?componentKeys=demo",
        ],
      };
    };
    sonar.hasCommit = async () => true;
    sonar.changedSince = async () => [];
    let revision = 0;
    const disk = new Map<string, { text: string; revision: string }>();
    const folders = new Set(["/proj", "/proj/src", "/proj/inc", "/proj/build"]);
    const write = (path: string, text: string) =>
      disk.set(path, { text, revision: `r${revision++}` });
    write(
      "/proj/src/main.cpp",
      '#include "foo.h"\n\nint main() {\n  int total = foo(1);\n  return total;\n}\n',
    );
    write(
      "/proj/src/util.cpp",
      '#include "foo.h"\n\nint twice() { return foo(2); }\n',
    );
    write("/proj/inc/foo.h", "int foo(int value);\n");
    write("/proj/README.md", "# Demo\n");
    const fake = {
      disk,
      saves: [] as string[],
      sent: [] as string[],
      head: new Map([["/proj/src/main.cpp", "int main() {\n  return 0;\n}\n"]]),
    };
    (window as any).__ide = fake;
    const parent = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";
    const name = (p: string) => p.slice(p.lastIndexOf("/") + 1);
    const data = (path: string) => {
      const file = disk.get(path);
      if (!file) throw new Error("File is missing or inaccessible");
      return {
        path,
        name: name(path),
        text: file.text,
        revision: file.revision,
        bom: false,
        ending: "lf",
      };
    };
    fs.list = async (directory: string) => ({
      directory,
      parent: parent(directory),
      crumbs: [],
      separator: "/",
      unreadable: 0,
      fallbackFrom: null,
      entries: [...folders, ...disk.keys()]
        .filter((p) => p !== directory && parent(p) === directory)
        .map((p) => ({
          path: p,
          name: name(p),
          kind: folders.has(p) ? "directory" : "file",
          targetKind: null,
          hidden: false,
          size: 1,
          modified: 1,
          broken: false,
          unsupported: false,
        })),
    });
    fs.watch = async () => {};
    fs.create = async (dir: string, file: string, directory: boolean) => {
      const path = `${dir}/${file}`;
      if (directory) folders.add(path);
      else write(path, "");
      return { path, name: file, kind: directory ? "directory" : "file" };
    };
    fs.rename = async (path: string, newName: string) => {
      const target = `${parent(path)}/${newName}`;
      disk.set(target, disk.get(path)!);
      disk.delete(path);
      return { path: target, name: newName, kind: "file" };
    };
    // The Trash keeps what it got, so Undo can restore it.
    const trash = new Map<string, any>();
    fs.trash = async (paths: string[]) => {
      paths.forEach((p) => {
        trash.set(p, disk.get(p));
        disk.delete(p);
      });
      return [];
    };
    fs.restore = async (paths: string[]) => {
      paths.forEach((p) => {
        disk.set(p, trash.get(p));
        trash.delete(p);
      });
      return [];
    };
    fs.plan = async (sources: string[], destination: string) => ({
      conflicts: sources
        .filter((s) => disk.has(`${destination}/${name(s)}`))
        .map((s) => ({ source: s, name: name(s) })),
    });
    fs.transfer = async (request: any) => {
      for (const source of request.sources) {
        disk.set(`${request.destination}/${name(source)}`, disk.get(source)!);
        if (request.mode === "move") disk.delete(source);
      }
      // As in Rust, the completed items are named at their destination.
      return {
        completed: request.sources.map(
          (s: string) => `${request.destination}/${name(s)}`,
        ),
        sources: request.sources,
        skipped: 0,
        failed: [],
        cancelled: false,
      };
    };
    ide.open = async () => ({
      root: "/proj",
      name: "proj",
      settings: {
        formatOnSave: false,
        tabSize: 4,
        insertSpaces: true,
        exclude: [],
      },
    });
    ide.read = async (path: string) => data(path);
    ide.save = async (request: any) => {
      const current = disk.get(request.path);
      if (current?.revision !== request.revision)
        throw new Error("The file changed on disk.");
      fake.saves.push(request.path);
      write(request.path, request.text);
      return data(request.path);
    };
    ide.files = async () => ({
      files: [...disk.keys()].map((p) => p.slice(6)).sort(),
      truncated: false,
    });
    const find = (text: string, query: any) => {
      const matches = [];
      const lines = text.split("\n");
      // The TODOs view searches with a regular expression.
      if (query.regex) {
        const pattern = new RegExp(query.text, query.matchCase ? "g" : "gi");
        lines.forEach((line, i) => {
          for (const m of line.matchAll(pattern))
            matches.push({
              line: i + 1,
              column: m.index!,
              length: m[0].length,
              preview: line,
              offset: m.index!,
            });
        });
        return matches;
      }
      for (let i = 0; i < lines.length; i++) {
        let from = 0;
        for (;;) {
          const hay = query.matchCase ? lines[i] : lines[i].toLowerCase();
          const needle = query.matchCase
            ? query.text
            : query.text.toLowerCase();
          const at = hay.indexOf(needle, from);
          if (at < 0) break;
          matches.push({
            line: i + 1,
            column: at,
            length: needle.length,
            preview: lines[i],
            offset: at,
          });
          from = at + needle.length;
        }
      }
      return matches;
    };
    ide.search = async (_root: string, query: any) => ({
      files: [...disk]
        .map(([path, file]) => ({
          path,
          relative: path.slice(6),
          revision: file.revision,
          matches: find(file.text, query),
        }))
        .filter((f) => f.matches.length),
      truncated: false,
      skipped: 0,
    });
    const replaceText = (text: string, query: any, replacement: string) =>
      text.split(query.text).join(replacement);
    ide.replaceText = async (text: string, query: any, replacement: string) =>
      replaceText(text, query, replacement);
    ide.replace = async (
      _root: string,
      query: any,
      replacement: string,
      targets: any[],
    ) =>
      targets.map((t) => {
        const file = disk.get(t.path)!;
        if (file.revision !== t.revision)
          return { path: t.path, error: "changed", file: null };
        write(t.path, replaceText(file.text, query, replacement));
        fake.saves.push(t.path);
        return { path: t.path, error: null, file: data(t.path) };
      });
    ide.setSettings = async (_root: string, settings: any) => settings;
    // Git: each changed file's index and working tree side; stage, unstage and discard
    // move changes between them.
    const git = new Map<
      string,
      { staged: string | null; unstaged: string | null }
    >([
      ["/proj/src/main.cpp", { staged: null, unstaged: "M" }],
      ["/proj/README.md", { staged: null, unstaged: "U" }],
    ]);
    (fake as any).git = git;
    // A merge in history, for the Source Control graph.
    ide.gitLog = async () => [
      {
        hash: "m1",
        parents: ["a1", "b1"],
        author: "Ada",
        date: 1700000000,
        refs: ["HEAD -> main", "tag: v1"],
        subject: "Merge feature",
      },
      {
        hash: "a1",
        parents: ["r1"],
        author: "Ada",
        date: 1699990000,
        refs: [],
        subject: "Fix the build",
      },
      {
        hash: "b1",
        parents: ["r1"],
        author: "Bob",
        date: 1699980000,
        refs: ["origin/feature"],
        subject: "Add feature",
      },
      {
        hash: "r1",
        parents: [],
        author: "Ada",
        date: 1699970000,
        refs: [],
        subject: "First commit",
      },
    ];
    ide.gitStatus = async () => ({
      root: "/proj",
      branch: "main",
      changes: [...git]
        .filter(([, c]) => c.staged || c.unstaged)
        .map(([path, c]) => ({
          path,
          status: (c.unstaged ?? c.staged)!,
          staged: c.staged,
          unstaged: c.unstaged,
        })),
      ignored: ["/proj/build"],
    });
    ide.stage = async (_root: string, paths: string[]) => {
      for (const path of paths) {
        const c = git.get(path)!;
        git.set(path, {
          staged: c.unstaged === "U" ? "A" : c.unstaged,
          unstaged: null,
        });
      }
    };
    ide.unstage = async (_root: string, paths: string[]) => {
      for (const path of paths) {
        const c = git.get(path)!;
        git.set(path, {
          staged: null,
          unstaged: c.staged === "A" ? "U" : c.staged,
        });
      }
    };
    ide.discard = async (_root: string, paths: string[]) => {
      for (const path of paths)
        git.set(path, { ...git.get(path)!, unstaged: null });
    };
    ide.indexText = async (path: string) => fake.head.get(path) ?? null;
    ide.recent = async () => (recent ? "/proj" : null);
    ide.recents = async () => (recent ? ["/proj", "/work/other"] : []);
    // CMake: a project with CMakeLists.txt, two kits, targets after the first configure;
    // building "all" reports a compiler error, building "app" succeeds.
    const builds = { configured: false, steps: [] as string[] };
    (fake as any).cmake = builds;
    const cmakeSettings = {
      settings: {
        generator: "",
        buildDirectory: "${sourceDir}/build/${kit}-${variant}",
        buildBeforeRun: true,
        parallelJobs: 0,
      },
      program: "/usr/bin/cmake",
      configured: false,
      generators: ["Ninja", "Unix Makefiles"],
    };
    const info = () => ({
      cmake: true,
      source: "/proj",
      presets: false,
      configurePresets: [],
      buildPresets: [],
      buildDir: "/proj/build/gcc-15-Debug",
      generator: "Ninja",
      targets: builds.configured
        ? [
            { name: "app", kind: "EXECUTABLE", artifact: "/proj/build/app" },
            { name: "core", kind: "STATIC_LIBRARY", artifact: null },
          ]
        : null,
      compileCommands: builds.configured,
      error: null,
    });
    (fake as any).cmakeSettings = cmakeSettings;
    cmake.settings = async () => cmakeSettings;
    cmake.setSettings = async (settings: any) => {
      cmakeSettings.settings = settings;
      return cmakeSettings;
    };
    cmake.kits = async () => [
      {
        id: "gcc",
        name: "GCC 15.2.0 x86_64-linux-gnu",
        slug: "gcc-15",
        kind: "gcc",
        cxx: "/usr/bin/g++",
        version: "15.2.0",
        target: "x86_64-linux-gnu",
      },
      {
        id: "clang",
        name: "Clang 21.1.4 x86_64-linux-gnu",
        slug: "clang-21",
        kind: "clang",
        cxx: "/usr/bin/clang++",
        version: "21.1.4",
        target: "x86_64-linux-gnu",
      },
    ];
    cmake.project = async () => info();
    cmake.run = async (
      _root: string,
      step: string,
      target: string | null,
      onOutput: (text: string) => void,
    ) => {
      builds.steps.push(`${step}:${target ?? "all"}`);
      let code = 0;
      if (step === "configure") {
        builds.configured = true;
        onOutput(
          "[configure] cmake -S /proj -B /proj/build/gcc-15-Debug\n-- Configuring done\nCMake Warning at CMakeLists.txt:5 (message):\n  Old policy\n\n",
        );
      } else if (step === "build" && target !== "app") {
        code = 1;
        onOutput(
          "[1/2] Building CXX object\n/proj/src/main.cpp:4:3: error: boom\n",
        );
      } else onOutput("[2/2] Linking CXX executable app\n");
      return { finished: { code, cancelled: false }, info: info() };
    };
    cmake.cancel = async () => {};
    // CTest: two GoogleTest suites of `app`, a disabled test and a script; Math.Fails fails.
    const tests = [
      ["Math.Adds", "app"],
      ["Math.Fails", "app"],
      ["Math.Skipped", "app"],
      ["Fixture.Works", "app"],
      ["lint", null],
    ].map(([name, target]) => ({
      name,
      target,
      args: target
        ? [`--gtest_filter=${name}`, "--gtest_also_run_disabled_tests"]
        : [],
      disabled: name === "Math.Skipped",
    }));
    (fake as any).tests = [] as (string[] | null)[];
    cmake.tests = async () => {
      if (!builds.configured) throw new Error("Configure the project first");
      return tests;
    };
    cmake.test = async (
      _root: string,
      names: string[] | null,
      onOutput: (text: string) => void,
    ) => {
      (fake as any).tests.push(names);
      const chosen = tests.filter((t) => !names || names.includes(t.name));
      onOutput("Test project /proj/build/gcc-15-Debug\n");
      chosen.forEach((t, i) => {
        const status = t.disabled
          ? "***Not Run (Disabled)"
          : t.name === "Math.Fails"
            ? "***Failed"
            : "  Passed";
        onOutput(
          `    Start ${i + 1}: ${t.name}\n${i + 1}/${chosen.length} Test #${i + 1}: ${t.name} .....${status}    0.01 sec\n`,
        );
        if (t.name === "Math.Fails")
          onOutput("math_test.cpp:9: Failure\nExpected equality of 2 and 3\n");
      });
      onOutput("\n80% tests passed, 1 tests failed out of 5\n");
      return { code: 8, cancelled: false };
    };
    // Debugging: GDB is "found"; a scripted adapter speaks DAP like GDB's interpreter. The
    // program pauses at the first breakpoint of main.cpp, steps one line, and on continue
    // prints its output and exits.
    const debug = {
      debuggers: {
        choice: "auto",
        compiler: "GNU 15.2.0",
        adapters: [
          {
            adapter: "gdb",
            label: "GDB",
            path: "/usr/bin/gdb",
            chosen: false,
            problem: null,
          },
          {
            adapter: "lldb",
            label: "LLDB",
            path: null,
            chosen: false,
            problem:
              "lldb-dap was not found. Install it or choose its program.",
          },
        ],
        selected: "gdb" as string | null,
        error: null as string | null,
      },
      saved: null as any,
      requests: [] as any[],
      config: null as any,
      launches: [] as any[],
    };
    (fake as any).debug = debug;
    let emitDap: ((event: any) => void) | null = null;
    let launchSeq = 0;
    let line = 0;
    let total = "3";
    const dapSend = (body: any) =>
      setTimeout(() =>
        emitDap?.({ kind: "message", data: JSON.stringify(body) }),
      );
    const respond = (request: any, body: any = undefined, success = true) =>
      dapSend({
        type: "response",
        request_seq: request.seq,
        command: request.command,
        success,
        ...(success ? { body } : { message: body }),
      });
    const event = (name: string, body: any = {}) =>
      dapSend({ type: "event", event: name, body });
    dbg.debuggers = async () => debug.debuggers;
    dbg.state = async () =>
      debug.saved ?? { breakpoints: [], breakpointsActive: true, watches: [] };
    dbg.setState = async (_root: string, state: any) => {
      debug.saved = state;
    };
    dbg.config = async () => ({
      path: "/proj/.mozaik/debug.json",
      exists: !!debug.config,
      file: debug.config,
      error: null,
    });
    dbg.setConfig = async (_root: string, target: string, config: any) => {
      debug.config = {
        version: 1,
        targets: { ...debug.config?.targets, [target]: config },
      };
      return dbg.config("/proj");
    };
    dbg.start = async (_id: string, _root: string, onEvent: any) => {
      emitDap = onEvent;
      return { adapter: "gdb", label: "GDB", program: "/usr/bin/gdb" };
    };
    dbg.launch = async (
      _id: string,
      seq: number,
      _root: string,
      target: string,
      args: string[] | null,
    ) => {
      launchSeq = seq;
      debug.launches.push({ target, args });
      return { program: "/proj/build/app", args: [], cwd: "/proj/build" };
    };
    dbg.stop = async () => {
      emitDap = null;
    };
    dbg.send = async (_id: string, text: string) => {
      const request = JSON.parse(text);
      debug.requests.push(request);
      const args = request.arguments ?? {};
      switch (request.command) {
        case "initialize":
          respond(request, {
            supportsConfigurationDoneRequest: true,
            supportsConditionalBreakpoints: true,
            supportsHitConditionalBreakpoints: true,
            supportsLogPoints: true,
            supportsSetVariable: true,
            supportsEvaluateForHovers: true,
          });
          event("initialized");
          break;
        case "setBreakpoints":
          if (args.source.path.endsWith("main.cpp") && args.breakpoints.length)
            line = args.breakpoints[0].line;
          respond(request, {
            breakpoints: args.breakpoints.map((b: any, i: number) => ({
              id: i + 1,
              verified: true,
              line: b.line,
            })),
          });
          break;
        case "configurationDone":
          respond(request);
          dapSend({
            type: "response",
            request_seq: launchSeq,
            command: "launch",
            success: true,
          });
          event("thread", { reason: "started", threadId: 1 });
          if (line)
            event("stopped", {
              reason: "breakpoint",
              threadId: 1,
              allThreadsStopped: true,
            });
          break;
        case "threads":
          respond(request, { threads: [{ id: 1, name: "main" }] });
          break;
        case "stackTrace":
          respond(request, {
            stackFrames: [
              {
                id: 7,
                name: "main",
                line,
                column: 1,
                source: { name: "main.cpp", path: "/proj/src/main.cpp" },
              },
              { id: 8, name: "__libc_start_main", line: 0, column: 0 },
            ],
          });
          break;
        case "scopes":
          respond(request, {
            scopes: [
              { name: "Locals", variablesReference: 10, expensive: false },
            ],
          });
          break;
        case "variables":
          respond(request, {
            variables:
              args.variablesReference === 10
                ? [
                    {
                      name: "total",
                      value: total,
                      type: "int",
                      variablesReference: 0,
                    },
                    {
                      name: "values",
                      value: "std::vector of length 3",
                      variablesReference: 11,
                      indexedVariables: 3,
                    },
                  ]
                : [0, 1, 2].map((i) => ({
                    name: `[${i}]`,
                    value: String(i + 1),
                    variablesReference: 0,
                  })),
          });
          break;
        case "setVariable":
          total = args.value;
          respond(request, { value: args.value, type: "int" });
          break;
        case "evaluate":
          if (args.expression === "total")
            respond(request, {
              result: total,
              type: "int",
              variablesReference: 0,
            });
          else
            respond(
              request,
              `No symbol "${args.expression}" in current context.`,
              false,
            );
          break;
        case "next":
          respond(request);
          line += 1;
          event("stopped", {
            reason: "step",
            threadId: 1,
            allThreadsStopped: true,
          });
          break;
        case "continue":
          respond(request, { allThreadsContinued: true });
          event("output", { category: "stdout", output: `total ${total}\n` });
          event("exited", { exitCode: 0 });
          event("terminated");
          break;
        case "disconnect":
          respond(request);
          break;
        default:
          respond(request);
      }
    };
    ide.headText = async (path: string) => fake.head.get(path) ?? null;
    ide.servers = async () => [
      {
        id: "clangd",
        languages: "C/C++",
        path: server ? "/usr/bin/clangd" : null,
        configured: false,
      },
    ];

    // A tiny language server over the same JSON-RPC messages clangd would exchange.
    const texts = new Map<string, string>();
    let emit: (event: any) => void = () => {};
    const send = (message: any) =>
      setTimeout(
        () =>
          emit({
            kind: "message",
            data: JSON.stringify({ jsonrpc: "2.0", ...message }),
          }),
        5,
      );
    const uri = (path: string) => `file://${path}`;
    const range = (line: number, start: number, end: number) => ({
      start: { line, character: start },
      end: { line, character: end },
    });
    const at = (text: string, word: string) => {
      const lines = text.split("\n");
      const line = lines.findIndex((l) => l.includes(word));
      return range(
        line,
        lines[line].indexOf(word),
        lines[line].indexOf(word) + word.length,
      );
    };
    // The symbol foo where it is called or declared (not in the include line).
    const symbol = (text: string) => {
      const found = at(text, "foo(");
      return {
        ...found,
        end: { ...found.end, character: found.end.character - 1 },
      };
    };
    const diagnose = (doc: string) => {
      const text = texts.get(doc)!;
      send({
        method: "textDocument/publishDiagnostics",
        params: {
          uri: doc,
          diagnostics: text.includes("bogus")
            ? [
                {
                  range: at(text, "bogus"),
                  severity: 1,
                  message: "use of undeclared identifier 'bogus'",
                  source: "clang",
                },
              ]
            : text.includes("many warnings")
              ? Array.from({ length: 500 }, (_, i) => ({
                  range: at(text, "many warnings"),
                  severity: 2,
                  message: `warning number ${i}`,
                  source: "clang",
                }))
              : [],
        },
      });
    };
    const textOf = (doc: string) =>
      texts.get(doc) ?? disk.get(doc.slice(7))?.text ?? "";
    ide.lspStart = async (
      _id: string,
      _server: string,
      _root: string,
      onEvent: any,
    ) => {
      emit = onEvent;
      return "/usr/bin/clangd";
    };
    ide.lspStop = async () => {};
    ide.lspSend = async (_id: string, raw: string) => {
      const message = JSON.parse(raw);
      fake.sent.push(message.method ?? "response");
      const { id, method, params } = message;
      const reply = (result: unknown) => send({ id, result });
      if (method === "initialize")
        reply({
          capabilities: {
            textDocumentSync: 1,
            completionProvider: { triggerCharacters: ["."] },
            hoverProvider: true,
            definitionProvider: true,
            implementationProvider: true,
            referencesProvider: true,
            renameProvider: { prepareProvider: true },
            codeActionProvider: true,
            documentFormattingProvider: true,
            documentSymbolProvider: true,
          },
        });
      else if (method === "textDocument/didOpen") {
        texts.set(params.textDocument.uri, params.textDocument.text);
        diagnose(params.textDocument.uri);
      } else if (method === "textDocument/didChange") {
        texts.set(params.textDocument.uri, params.contentChanges.at(-1).text);
        diagnose(params.textDocument.uri);
      } else if (method === "textDocument/completion")
        reply({
          isIncomplete: false,
          items: [{ label: "fooBarBaz", kind: 3, insertText: "fooBarBaz" }],
        });
      else if (method === "textDocument/hover")
        reply({
          contents: {
            kind: "markdown",
            value: "### function `foo`\n\n```cpp\nint foo(int value)\n```",
          },
        });
      else if (method === "textDocument/switchSourceHeader")
        reply(
          params.uri === uri("/proj/src/main.cpp")
            ? uri("/proj/inc/foo.h")
            : null,
        );
      else if (method === "textDocument/definition")
        reply([
          {
            uri: uri("/proj/inc/foo.h"),
            range: symbol(textOf(uri("/proj/inc/foo.h"))),
          },
        ]);
      else if (method === "textDocument/references")
        reply(
          ["/proj/src/main.cpp", "/proj/src/util.cpp", "/proj/inc/foo.h"].map(
            (p) => ({
              uri: uri(p),
              range: symbol(textOf(uri(p))),
            }),
          ),
        );
      else if (method === "textDocument/implementation") reply([]);
      else if (method === "textDocument/documentSymbol")
        reply([
          {
            name: "main",
            detail: "int ()",
            kind: 12,
            range: range(2, 0, 5),
            selectionRange: range(2, 4, 8),
            children: [],
          },
          {
            name: "Widget",
            kind: 23,
            range: range(6, 0, 6),
            selectionRange: range(6, 0, 6),
            children: [
              {
                name: "draw",
                kind: 6,
                range: range(6, 0, 6),
                selectionRange: range(6, 0, 6),
              },
            ],
          },
        ]);
      else if (method === "textDocument/prepareRename") {
        const text = textOf(params.textDocument.uri);
        reply({ range: symbol(text), placeholder: "foo" });
      } else if (method === "textDocument/rename")
        reply({
          changes: Object.fromEntries(
            ["/proj/src/main.cpp", "/proj/src/util.cpp", "/proj/inc/foo.h"].map(
              (p) => [
                uri(p),
                [{ range: symbol(textOf(uri(p))), newText: params.newName }],
              ],
            ),
          ),
        });
      else if (method === "textDocument/codeAction") {
        const doc = params.textDocument.uri;
        reply(
          params.context.diagnostics.length
            ? [
                {
                  title: "Replace 'bogus' with 'total'",
                  kind: "quickfix",
                  isPreferred: true,
                  edit: {
                    changes: {
                      [doc]: [
                        { range: at(textOf(doc), "bogus"), newText: "total" },
                      ],
                    },
                  },
                },
              ]
            : [],
        );
      } else if (method === "textDocument/formatting") {
        const text = textOf(params.textDocument.uri);
        reply(
          text.includes("int  ")
            ? [{ range: at(text, "int  "), newText: "int " }]
            : [],
        );
      } else if (method === "shutdown") reply(null);
      else if (id !== undefined && method) reply(null);
    };
  }, options);
}
const fake = (page: Page) => page.evaluate(() => (window as any).__ide);
const onDisk = (page: Page, path: string) =>
  page.evaluate((p) => (window as any).__ide.disk.has(p), path);
const diskText = (page: Page, path: string) =>
  page.evaluate((p) => (window as any).__ide.disk.get(p)?.text, path);
async function openProject(page: Page) {
  await page.keyboard.press("Control+Shift+Quote");
  await page.getByRole("combobox", { name: "Search tools" }).fill("ide");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Open Folder…" }).click();
  await expect(tree(page).getByRole("treeitem", { name: /src/ })).toBeVisible();
}
const tree = (page: Page) => page.getByRole("tree", { name: "Project files" });
const code = (page: Page, name: string) =>
  page.getByRole("textbox", { name: `Code ${name}` });
async function openFile(page: Page, folder: string, file: string) {
  const row = tree(page).getByRole("treeitem", {
    name: new RegExp(`^${folder}`),
  });
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
  await tree(page)
    .getByRole("treeitem", { name: new RegExp(`^${file}`) })
    .click();
  await expect(code(page, file)).toBeVisible();
}
/** A Code Editor action, through the command palette (its menu is the context menu). */
async function codeMenu(page: Page, item: string) {
  await page.keyboard.press("Control+Shift+p");
  await page.keyboard.type(`Code Editor: ${item}`);
  await page
    .getByRole("dialog", { name: "Command palette" })
    .getByRole("option", { name: `Code Editor: ${item}`, exact: true })
    .click();
}

test("the launcher offers the IDE as one module with Problems and Terminal views", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("Control+Shift+Quote");
  const search = page.getByRole("combobox", { name: "Search tools" });
  await search.fill("code");
  await expect(page.getByRole("option")).toHaveCount(0);
  await search.fill("problems");
  await expect(page.getByRole("option")).toHaveCount(0);
  await search.fill("ide");
  await expect(page.getByRole("option")).toHaveText(["IDE"]);
  await page.keyboard.press("Enter");
  // Sidebar, an empty code editor, the bottom panel and the status bar.
  await expect(page.locator("[data-panel]")).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "Open Folder…" }),
  ).toBeFocused();
  await expect(page.locator(".code-editor")).toBeVisible();
  await expect(page.locator(".ide-status-problems")).toContainText("⊗ 0");
  // The docked parts have their own bars: no tab strip, no close or maximize.
  await expect(page.locator(".panel.docked")).toHaveCount(3);
  await expect(page.locator(".panel.docked .panel-header")).toHaveCount(0);
  await expect(page.locator(".project-header")).toHaveText(/Explorer/);
  const bottom = (await page.locator(".ide-status").boundingBox())!;
  const area = (await page.locator(".workspace-area").boundingBox())!;
  expect(bottom.height).toBeLessThan(30);
  expect(bottom.x).toBeLessThan(area.x + 2);
  expect(bottom.y + bottom.height).toBeGreaterThan(area.y + area.height - 2);
  // Minimized, the bottom panel keeps its bar and the sidebar its activity bar.
  await page.getByRole("button", { name: "Minimize panel" }).click();
  await expect(page.locator(".ide-panel")).toHaveCSS("height", "30px");
  await page.getByRole("button", { name: "Minimize sidebar" }).click();
  expect((await page.locator(".project").boundingBox())!.width).toBe(40);
  await expect(page.locator(".project-main")).toHaveCount(0);
  await page.getByRole("tab", { name: "Search" }).click();
  await expect(page.locator(".project-header")).toHaveText(/Search/);
  // The shown view's icon minimizes again; another view's restores.
  await page.getByRole("tab", { name: "Search" }).click();
  await expect(page.locator(".project-main")).toHaveCount(0);
  await page.getByRole("tab", { name: "Explorer" }).click();
  await page.getByRole("tab", { name: "Terminal" }).click();
  await expect(page.locator(".ide-panel .terminal-wrapper")).toBeVisible();
  // Outside the desktop app the shell cannot start; the panel offers a new one.
  await expect(
    page.getByRole("button", { name: "Restart Terminal" }),
  ).toBeVisible();
  // More terminals, as in VS Code: listed beside the shown one, each can be ended there.
  const terminals = page.getByRole("list", { name: "Terminals" });
  await expect(terminals.getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "New Terminal", exact: true }).click();
  await expect(terminals.getByRole("listitem")).toHaveCount(2);
  await expect(terminals.locator("[aria-current=true]")).toContainText("2:");
  await terminals.getByRole("button", { name: /^1:/ }).click();
  await expect(terminals.locator("[aria-current=true]")).toContainText("1:");
  // Split shows a second shell beside the first, in the same group.
  await terminals.getByRole("button", { name: "Split terminal 1" }).click();
  await expect(page.locator(".ide-panel .terminal-wrapper")).toHaveCount(2);
  await expect(terminals.getByRole("listitem")).toHaveCount(3);
  await expect(terminals.locator("[aria-current=true]")).toContainText("2:");
  await terminals.getByRole("button", { name: "Kill terminal 2" }).click();
  await expect(page.locator(".ide-panel .terminal-wrapper")).toHaveCount(1);
  await terminals.getByRole("button", { name: "Kill terminal 1" }).click();
  await expect(terminals.getByRole("listitem")).toHaveCount(1);
  await expect(page.locator(".ide-panel .terminal-wrapper")).toHaveCount(1);
  await page.getByRole("tab", { name: "Problems" }).click();
  await expect(page.locator(".problems")).toBeVisible();
  // Closing any part closes the whole IDE; the last one takes its code editors along.
  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Close IDE" }).click();
  await expect(page.locator(".panel.docked")).toHaveCount(0);
  await expect(page.locator(".code-editor")).toHaveCount(0);
  // Without an IDE the command control no longer names its project.
  await expect(
    page.getByRole("button", { name: "Open command palette" }),
  ).toHaveText("Command Palette");
  await expect(page).toHaveTitle("Mozaik");
});

test("a second IDE opens right of the whole first one, and a third is refused", async ({
  page,
}) => {
  await start(page);
  await openProject(page);
  const first = await page.locator(".code-editor").first().boundingBox();
  const sidebar = await tree(page).boundingBox();
  const addIde = async () => {
    await page.keyboard.press("Control+Shift+Quote");
    await page.getByRole("combobox", { name: "Search tools" }).fill("ide");
    await page.keyboard.press("Enter");
  };
  // Focus in the first IDE's code area does not matter: the window splits as a whole.
  await page.locator(".code-editor").first().click();
  await addIde();
  const open = page.getByRole("button", { name: "Open Folder…" });
  await expect(open).toBeVisible();
  const second = await open.boundingBox();
  const firstNow = await page.locator(".code-editor").first().boundingBox();
  expect(second!.x).toBeGreaterThan(firstNow!.x + firstNow!.width);
  expect(firstNow!.width).toBeLessThan(first!.width);
  // The first sidebar keeps its width in its half.
  const sidebarNow = await tree(page).boundingBox();
  expect(Math.abs(sidebarNow!.width - sidebar!.width)).toBeLessThan(24);
  // Each IDE has its own status bar under it.
  await expect(page.locator(".ide-status")).toHaveCount(2);
  await addIde();
  await expect(page.getByText(/at most 2 IDEs/)).toBeVisible();
  await expect(page.locator(".ide-status")).toHaveCount(2);
  // Ctrl+Shift+C in the first IDE's code closes that IDE whole, its code editors too.
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await page.locator(".code-editor").first().click();
  await page.keyboard.press("Control+Shift+C");
  await page
    .getByRole("dialog", { name: "Close IDE" })
    .getByRole("button", { name: "Close IDE" })
    .click();
  await expect(page.locator(".ide-status")).toHaveCount(1);
  await expect(tree(page)).toHaveCount(0);
  await expect(page.locator(".code-editor")).toHaveCount(1);
  // What stays is the second IDE, now over the whole window.
  await expect(open).toBeVisible();
  // The last IDE, closed from its code, leaves nothing behind.
  await page.locator(".code-editor").click();
  await page.keyboard.press("Control+Shift+C");
  await page
    .getByRole("dialog", { name: "Close IDE" })
    .getByRole("button", { name: "Close IDE" })
    .click();
  await expect(page.locator("[data-panel]")).toHaveCount(0);
});

test("Add to Workspace: IDE offers Empty Project, then the folders opened last", async ({
  page,
}) => {
  await start(page, { recent: true });
  const palette = page.getByRole("combobox", { name: "Type a command" });
  const add = async () => {
    await page.keyboard.press("Control+Shift+p");
    await palette.fill(">Add to Workspace: IDE");
    await page.keyboard.press("Enter");
  };
  await add();
  const options = page.getByRole("listbox").getByRole("option");
  await expect(options).toHaveCount(3);
  await expect(options.nth(0)).toContainText("Empty Project");
  await expect(options.nth(1)).toContainText("proj");
  await expect(options.nth(2)).toContainText("other");
  await expect(options.nth(2)).toContainText("/work/other");
  // A recent folder opens at once.
  await options.nth(1).click();
  await expect(tree(page).getByRole("treeitem", { name: /src/ })).toBeVisible();
  await expect(page.locator(".project-root")).toHaveText(/proj$/);

  // Empty Project stays empty, even as the window's first IDE.
  await start(page, { recent: true });
  await add();
  await expect(options.nth(0)).toContainText("Empty Project");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Open Folder…" }),
  ).toBeVisible();
  await expect(tree(page)).toHaveCount(0);
});

test("a floating IDE beside an open one opens its project in a new window", async ({
  page,
}) => {
  await start(page, { recent: true });
  await page.evaluate(async () => {
    const loaded = (path: string) =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((url) => new URL(url).pathname === path) ?? path;
    const { windowBackend } = await import(loaded("/src/services/windows.ts"));
    const opened: (string | null)[] = [];
    (window as any).__windows = opened;
    windowBackend.open = async (ide: string | null = null) => {
      opened.push(ide);
    };
  });
  const palette = page.getByRole("combobox", { name: "Type a command" });
  const options = page.getByRole("listbox").getByRole("option");
  await page.keyboard.press("Control+Shift+p");
  await palette.fill(">Add to Workspace: IDE");
  await page.keyboard.press("Enter");
  await options.nth(1).click();
  await expect(page.locator(".project-root")).toHaveText(/proj$/);
  const sidebars = page.locator(".project");
  await expect(sidebars).toHaveCount(1);
  // Ctrl+Shift+Enter: the chosen folder opens in a window of its own, not here.
  await page.keyboard.press("Control+Shift+p");
  await palette.fill(">Add to Workspace: IDE");
  await page.keyboard.press("Control+Shift+Enter");
  await expect(options.nth(0)).toContainText("Open Folder…");
  await expect(options.nth(2)).toContainText("/work/other");
  await options.nth(2).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__windows))
    .toEqual(["/work/other"]);
  await expect(sidebars).toHaveCount(1);
});

test("the first IDE reopens the last folder; Source Control lists changes", async ({
  page,
}) => {
  await start(page, { recent: true });
  await page.keyboard.press("Control+Shift+Quote");
  await page.getByRole("combobox", { name: "Search tools" }).fill("ide");
  await page.keyboard.press("Enter");
  await expect(tree(page).getByRole("treeitem", { name: /src/ })).toBeVisible();
  await expect(page.locator(".project-root")).toHaveText(/proj$/);
  // What Git ignores is dimmed.
  await expect(
    tree(page).getByRole("treeitem", { name: /^build/ }),
  ).toHaveClass(/git-ignored/);
  await expect(
    tree(page).getByRole("treeitem", { name: /^src/ }),
  ).not.toHaveClass(/git-ignored/);
  // Changed files color their folders too.
  await expect(tree(page).getByRole("treeitem", { name: /^src/ })).toHaveClass(
    /git-M/,
  );
  // The activity bar counts the changes.
  const scm = page.getByRole("tab", { name: "Source Control" });
  await expect(scm.locator(".activity-badge")).toHaveText("2");
  await scm.click();
  const changes = page.getByRole("list", { name: "Changes", exact: true });
  await expect(changes.locator(".project-row")).toHaveCount(2);
  // A change opens as a tab among the code editors.
  await changes.getByRole("button", { name: /^main\.cpp/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Staged version" }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "main.cpp (changes)" }),
  ).toBeVisible();
  // An untracked file has nothing to compare with: it opens, replacing the empty editor.
  await changes.getByRole("button", { name: /^README/ }).click();
  await expect(code(page, "README.md")).toBeVisible();
  await expect(page.getByRole("tab", { name: /Untitled/ })).toHaveCount(0);
  // Code and comparison tabs share one panel.
  const codePanel = page.locator("[data-panel]", {
    has: page.getByRole("tab", { name: "README.md" }),
  });
  await expect(
    codePanel.getByRole("tab", { name: "main.cpp (changes)" }),
  ).toBeVisible();

  // A row's buttons show while it is hovered, so the folder sits against the status letter.
  const rowAction = async (name: string) => {
    await page
      .locator(".scm-row", {
        has: page.getByRole("button", { name, includeHidden: true }),
      })
      .hover();
    await page.getByRole("button", { name }).click();
  };
  // Stage moves a change to Staged Changes; unstage moves it back.
  await rowAction("Stage main.cpp");
  const staged = page.getByRole("list", { name: "Staged Changes" });
  await expect(staged.locator(".project-row")).toHaveText([/main\.cpp/]);
  await expect(changes.locator(".project-row")).toHaveText([/README/]);
  await rowAction("Unstage main.cpp");
  await expect(staged).toHaveCount(0);
  await page.getByRole("button", { name: "Stage All Changes" }).click();
  await expect(staged.locator(".project-row")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Unstage All Staged Changes" })
    .click();
  // Discard asks first; an untracked file goes to the Trash.
  await rowAction("Discard main.cpp");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(changes.locator(".project-row")).toHaveCount(2);
  await rowAction("Discard main.cpp");
  await expect(
    page.getByRole("dialog", { name: "Discard changes" }),
  ).toContainText("not staged are lost");
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(changes.locator(".project-row")).toHaveText([/README/]);
  await expect(scm.locator(".activity-badge")).toHaveText("1");
});

test("a project opens beside its code editor with the editing basics", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  await openProject(page);
  await expect(
    page.getByRole("button", { name: "Open command palette" }),
  ).toHaveText("proj");
  await expect(page).toHaveTitle("proj — Mozaik");
  // The branch is in the status bar only.
  await expect(page.locator(".project")).not.toContainText("main");
  // Git states: a modified file inside src, and an untracked file.
  await expect(
    tree(page).getByRole("treeitem", { name: /^src/ }),
  ).toContainText("•");
  await expect(
    tree(page).getByRole("treeitem", { name: /README/ }),
  ).toHaveClass(/git-U/);
  await openFile(page, "src", "main.cpp");
  await expect(
    tree(page).getByRole("treeitem", { name: /main.cpp/ }),
  ).toHaveClass(/git-M/);
  const sidebar = await page.locator(".project").boundingBox();
  const editor = await page.locator(".code-editor").boundingBox();
  expect(sidebar!.x).toBeLessThan(editor!.x);
  expect(sidebar!.width).toBeLessThan(editor!.width / 2);
  // The bottom panel sits under the code, not under the sidebar; the status bar under all.
  const panel = (await page.locator(".ide-panel").boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(sidebar!.x + sidebar!.width);
  expect(panel.y).toBeGreaterThan(editor!.y + editor!.height - 1);
  const status = (await page.locator(".ide-status").boundingBox())!;
  expect(status.y).toBeGreaterThan(panel.y + panel.height - 1);
  expect(status.x).toBeLessThanOrEqual(sidebar!.x);
  await expect(page.locator(".ide-status-branch")).toHaveText("main");
  // The file took the place of the empty editor the IDE opened with.
  await expect(page.getByRole("tab", { name: /Untitled/ })).toHaveCount(0);
  await expect(page.locator(".code-editor .cm-foldGutter")).toBeVisible();
  await expect(
    page
      .locator(
        ".code-editor .cm-content .ͼ1, .code-editor .cm-content span[class^='ͼ']",
      )
      .first(),
  ).toBeVisible();

  // Multiple cursors: select the word, add its next occurrence, type over both.
  const view = code(page, "main.cpp");
  await view.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Control+ArrowLeft");
  await page.keyboard.press("Control+ArrowLeft");
  await page.keyboard.press("Control+ArrowLeft");
  await page.keyboard.press("Control+d");
  await page.keyboard.press("Control+d");
  await page.keyboard.type("sum");
  // The word at the cursor and its next occurrence (in the include) changed together.
  await expect(view).toContainText("int total = sum(1);");
  await expect(view).toContainText('#include "sum.h"');
  // Unsaved changes show on the tab and in the explorer.
  await expect(page.getByRole("tab", { name: "main.cpp •" })).toBeVisible();
  await expect(tree(page).getByLabel("Unsaved changes")).toBeVisible();
  // Bracket matching and folding.
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await expect(page.locator(".code-editor .cm-matchingBracket")).toHaveCount(2);
  await page
    .locator(".code-editor .cm-foldGutter [title='Fold line']")
    .nth(0)
    .click();
  await expect(view).not.toContainText("return total;");
  await page.locator(".code-editor .cm-foldPlaceholder").click();
  await expect(view).toContainText("return total;");
  // Closing asks before discarding.
  await page.keyboard.press("Control+w");
  await expect(
    page.getByRole("dialog", { name: "Unsaved changes" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(view).toBeVisible();
  expect(errors).toEqual([]);
});

test("files open to the side, and quick open finds files", async ({ page }) => {
  await start(page);
  await openProject(page);
  await openFile(page, "src", "main.cpp");
  await tree(page)
    .getByRole("treeitem", { name: /^util.cpp/ })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open to the Side" }).click();
  await expect(code(page, "util.cpp")).toBeVisible();
  await expect(code(page, "main.cpp")).toBeVisible();
  const left = await code(page, "main.cpp").boundingBox(),
    right = await code(page, "util.cpp").boundingBox();
  expect(left!.x).toBeLessThan(right!.x);

  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Go to File…" }).click();
  await page
    .getByRole("combobox", { name: /^Search files by name/ })
    .fill("fooh");
  await expect(
    page
      .getByRole("dialog", { name: "Command palette" })
      .getByRole("option")
      .first(),
  ).toContainText("inc/foo.h");
  await page.keyboard.press("Enter");
  await expect(code(page, "foo.h")).toBeVisible();
  await expect(
    tree(page).getByRole("treeitem", { name: /^foo.h/ }),
  ).toHaveAttribute("aria-selected", "true");
});

test("a file shows where it was left: tabs, explorer, closing and an explicit jump", async ({
  page,
}) => {
  await start(page);
  const long = Array.from({ length: 400 }, (_, i) => `// line ${i + 1}`).join(
    "\n",
  );
  await page.evaluate((text) => {
    const disk = (window as any).__ide.disk;
    for (const path of ["/proj/src/main.cpp", "/proj/src/util.cpp"])
      disk.set(path, { text, revision: "long" });
  }, long);
  await openProject(page);
  await openFile(page, "src", "main.cpp");

  const scroller = page.locator(".cm-scroller");
  const scrollTop = () => scroller.evaluate((e) => Math.round(e.scrollTop));
  await scroller.evaluate((e) => (e.scrollTop = 4000));
  await page.locator(".cm-line", { hasText: /^\/\/ line 200$/ }).click();
  const left = await scrollTop();
  expect(left).toBeGreaterThan(2000);
  const shown = () => page.locator(".cm-content .cm-activeLine").textContent();
  await expect.poll(shown).toBe("// line 200");

  // Tabs: the other file starts at its top, and the first comes back where it was.
  await tree(page)
    .getByRole("treeitem", { name: /^util.cpp/ })
    .click();
  await expect(code(page, "util.cpp")).toBeVisible();
  await expect.poll(scrollTop).toBe(0);
  await page.getByRole("tab", { name: "main.cpp" }).click();
  await expect(code(page, "main.cpp")).toBeVisible();
  await expect.poll(scrollTop).toBe(left);
  await expect.poll(shown).toBe("// line 200");

  // The explorer, on a file already open: neither the cursor nor the scroll move.
  await page.getByRole("tab", { name: "util.cpp" }).click();
  await expect(code(page, "util.cpp")).toBeVisible();
  await tree(page)
    .getByRole("treeitem", { name: /^main.cpp/ })
    .click();
  await expect(code(page, "main.cpp")).toBeVisible();
  await expect.poll(scrollTop).toBe(left);
  await expect.poll(shown).toBe("// line 200");

  // Closed and opened again in this window.
  await page.getByRole("tab", { name: "main.cpp" }).click({ button: "middle" });
  await expect(page.getByRole("tab", { name: "main.cpp" })).toHaveCount(0);
  await tree(page)
    .getByRole("treeitem", { name: /^main.cpp/ })
    .click();
  await expect(code(page, "main.cpp")).toBeVisible();
  await expect.poll(scrollTop).toBe(left);
  await expect.poll(shown).toBe("// line 200");

  // A jump to a location still wins over the remembered place.
  await page.getByRole("tab", { name: "util.cpp" }).click();
  await expect(code(page, "util.cpp")).toBeVisible();
  await page.evaluate(async () => {
    const editors = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .find((url) => new URL(url).pathname === "/src/plugins/ide/editors.ts");
    await (
      await import(editors!)
    ).reveal("/proj/src/main.cpp", { line: 5, column: 0 });
  });
  await expect(code(page, "main.cpp")).toBeVisible();
  await expect.poll(shown).toBe("// line 5");
  await expect.poll(scrollTop).toBeLessThan(left);
});

test("project search finds matches and replace keeps open files unsaved", async ({
  page,
}) => {
  await start(page);
  await openProject(page);
  await openFile(page, "src", "main.cpp");
  await page.getByRole("tab", { name: "Search" }).click();
  await page.getByRole("textbox", { name: "Search in project" }).fill("foo(");
  await page.keyboard.press("Enter");
  await expect(page.locator(".results-title").first()).toContainText(
    "3 results in 3 files",
  );
  await page.locator(".results-match", { hasText: "twice" }).click();
  await expect(code(page, "util.cpp")).toBeFocused();

  await page.getByRole("button", { name: "Toggle Replace" }).click();
  await page.getByRole("textbox", { name: "Replace with" }).fill("bar(");
  await page.getByRole("button", { name: "Replace All" }).click();
  await expect(
    page.getByRole("dialog", { name: "Replace in project" }),
  ).toContainText("1 closed file is saved directly; 2 open files");
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(code(page, "util.cpp")).toContainText("return bar(2)");
  // Only the closed header was written; open files wait for an explicit save.
  expect((await fake(page)).saves).toEqual(["/proj/inc/foo.h"]);
  expect(await diskText(page, "/proj/inc/foo.h")).toContain(
    "int bar(int value);",
  );
  expect(await diskText(page, "/proj/src/util.cpp")).toContain("foo(2)");
  await expect(page.getByRole("tab", { name: "util.cpp •" })).toBeVisible();
});

test("CMake files are highlighted and complete commands, keywords and their targets", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() =>
    (window as any).__ide.disk.set("/proj/CMakeLists.txt", {
      text: 'project(demo)\nadd_library(core STATIC src/util.cpp)\nmessage(STATUS "${CMAKE_BUILD_TYPE}")\n',
      revision: "c1",
    }),
  );
  await openProject(page);
  await tree(page)
    .getByRole("treeitem", { name: /^CMakeLists.txt/ })
    .dblclick();
  const view = code(page, "CMakeLists.txt");
  await expect(view).toBeVisible();
  // The variable reference is colored apart from the string around it.
  const variable = view.locator("span", {
    hasText: /^\$\{CMAKE_BUILD_TYPE\}$/,
  });
  await expect(variable).toHaveCount(1);
  await page.keyboard.press("Control+End");
  await page.keyboard.type("add_exe");
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText(
    "add_executable",
  );
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await page.keyboard.type("(app main.cpp)\ntarget_link_libraries(app PRI");
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText(
    "PRIVATE",
  );
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await page.keyboard.type(" co");
  await expect(
    page.locator(".cm-tooltip-autocomplete li").first(),
  ).toContainText("core");
  await page.keyboard.press("Escape");
  await expect(view).toContainText(
    "add_executable(app main.cpp)target_link_libraries(app PRIVATE co",
  );
});

test("language features: completion, diagnostics, outline, navigation and back", async ({
  page,
}) => {
  await start(page, { server: true });
  await openProject(page);
  await openFile(page, "src", "main.cpp");
  await expect(page.locator(".code-status")).toHaveText("clangd");
  const view = code(page, "main.cpp");

  // Outline from document symbols; clicking jumps.
  await expect(
    page.locator(".outline-symbol", { hasText: "Widget" }),
  ).toBeVisible();
  await page.locator(".outline-symbol", { hasText: "main" }).click();
  await expect(view).toBeFocused();

  // Completion from the server.
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nfooB");
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText(
    "fooBarBaz",
  );
  // CodeMirror ignores Enter in the first 75 ms after the list opens (accidental accepts).
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await expect(view).toContainText("fooBarBaz");

  // A diagnostic is marked in the editor and listed in Problems; a quick fix repairs it.
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nint x = bogus;");
  await expect(page.locator(".code-editor .cm-lintRange-error")).toBeVisible();
  await expect(page.locator(".ide-status-problems")).toContainText("⊗ 1");
  await page.locator(".ide-status-problems").click();
  const problem = page.locator(".problem", {
    hasText: "undeclared identifier",
  });
  await expect(problem).toBeVisible();
  // The bottom panel sits under the code editor, never under the project sidebar.
  const problems = (await page.locator(".problems").boundingBox())!,
    sidebar = (await page.locator(".project").boundingBox())!,
    editor = (await page.locator(".code-editor").boundingBox())!;
  expect(problems.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width);
  expect(problems.y).toBeGreaterThan(editor.y + editor.height - 1);
  await problem.click();
  await expect(view).toBeFocused();
  await codeMenu(page, "Quick Fix…");
  await page
    .getByRole("menuitem", { name: "Replace 'bogus' with 'total'" })
    .click();
  await expect(view).toContainText("int x = total;");
  await expect(page.locator(".problem")).toHaveCount(0);

  // Go to definition opens the header and highlights the target; Alt+Left returns to the
  // call and Alt+Right goes forward again.
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Control+ArrowLeft");
  await page.keyboard.press("Control+ArrowLeft");
  await page.keyboard.press("F12");
  await expect(code(page, "foo.h")).toBeFocused();
  await expect(page.locator(".code-editor .cm-jump-flash")).toBeVisible();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(view).toBeFocused();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(code(page, "foo.h")).toBeFocused();

  // References are listed in the sidebar, including files that are not open.
  await page.getByRole("tab", { name: /main.cpp/ }).click();
  await view.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Control+ArrowLeft");
  await page.keyboard.press("Control+ArrowLeft");
  await page.keyboard.press("Shift+F12");
  await expect(page.locator(".results-title")).toContainText("References to");
  await expect(page.locator(".results-file")).toHaveCount(3);
  await page.locator(".results-match", { hasText: "twice" }).click();
  await expect(code(page, "util.cpp")).toBeFocused();
});

test("rename asks before changing closed files and format applies server edits", async ({
  page,
}) => {
  await start(page, { server: true });
  await openProject(page);
  await openFile(page, "src", "main.cpp");
  await expect(page.locator(".code-status")).toHaveText("clangd");
  const view = code(page, "main.cpp");
  await view.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Control+ArrowLeft");
  await page.keyboard.press("Control+ArrowLeft");
  await page.keyboard.press("F2");
  const name = page.getByRole("textbox", { name: "New name" });
  await expect(name).toHaveValue("foo");
  await name.fill("compute");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Rename to compute" });
  await expect(dialog).toContainText(
    "2 files that are not open (util.cpp, foo.h)",
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(view).toContainText("foo(1)");
  expect((await fake(page)).saves).toEqual([]);

  await page.keyboard.press("F2");
  await name.fill("compute");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(view).toContainText("compute(1)");
  await expect(page.getByRole("tab", { name: "main.cpp •" })).toBeVisible();
  expect((await fake(page)).saves.sort()).toEqual([
    "/proj/inc/foo.h",
    "/proj/src/util.cpp",
  ]);
  expect(await diskText(page, "/proj/src/util.cpp")).toContain("compute(2)");

  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nint  spaced = 1;");
  await codeMenu(page, "Format Document");
  await expect(view).toContainText("int spaced = 1;");

  // Format on save is a project setting; it formats before the (here unavailable) write.
  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Project Settings…" }).click();
  await page.getByRole("checkbox", { name: /Format on save/ }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await view.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nint  again = 2;");
  await page.keyboard.press("Control+s");
  await expect(view).toContainText("int again = 2;");
});

test("sidebar sections fold and resize and keep that; TODOs, Ctrl+D and Ctrl+` work", async ({
  page,
}) => {
  await start(page, { server: false });
  await page.evaluate(() =>
    (window as any).__ide.disk.set("/proj/src/util.cpp", {
      text: '#include "foo.h"\n\n// TODO: cache it\nint twice() { return foo(2); } // FIXME overflow\n',
      revision: "todo",
    }),
  );
  await openProject(page);

  // A folded section stays folded after visiting another view.
  const outline = () => page.getByRole("button", { name: "Outline" });
  await outline().click();
  await expect(outline()).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("tab", { name: "Search" }).click();
  await page.getByRole("tab", { name: "Explorer" }).click();
  await expect(outline()).toHaveAttribute("aria-expanded", "false");
  // The edge between two open sections drags to resize them.
  await outline().click();
  const files = page.getByRole("region", { name: "proj" });
  const before = (await files.boundingBox())!.height;
  const edge = (await page
    .getByRole("region", { name: "Outline" })
    .getByRole("separator")
    .boundingBox())!;
  await page.mouse.move(edge.x + 40, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + 40, edge.y - 60, { steps: 4 });
  await page.mouse.up();
  const after = (await files.boundingBox())!.height;
  expect(after).toBeLessThan(before - 40);
  await page.getByRole("tab", { name: "Search" }).click();
  await page.getByRole("tab", { name: "Explorer" }).click();
  expect((await files.boundingBox())!.height).toBeCloseTo(after, 0);

  // TODOs lists tagged comments by file or by tag; a row opens its line.
  await page.getByRole("tab", { name: "TODOs" }).click();
  const todos = page.getByRole("list", { name: "TODOs" });
  await expect(todos.locator(".todo-item")).toHaveText([
    /^TODO\s*cache it\s*3$/,
    /^FIXME\s*overflow\s*4$/,
  ]);
  await todos.locator(".todo-item", { hasText: "cache it" }).click();
  await expect(code(page, "util.cpp")).toBeFocused();
  await expect(page.locator(".code-editor .cm-todo-tag")).toHaveText([
    "TODO",
    "FIXME",
  ]);
  await page.getByRole("button", { name: "Group by Tag" }).click();
  await expect(todos.locator(".todo-group-name")).toHaveText(["TODO", "FIXME"]);

  // Ctrl+D adds the next match of the word to the selection.
  await page.locator(".cm-line", { hasText: "twice" }).click();
  await page.keyboard.press("Home");
  for (let i = 0; i < 22; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Control+d");
  await page.keyboard.press("Control+d");
  await page.keyboard.type("bar");
  await expect(code(page, "util.cpp")).toContainText('#include "bar.h"');
  await expect(code(page, "util.cpp")).toContainText("return bar(2);");

  // Ctrl+` shows and focuses the IDE terminal; again, it hides it and returns to the code.
  await page.keyboard.press("Control+Backquote");
  await expect(
    page.getByRole("tab", { name: "Terminal", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".ide-panel .terminal-wrapper")).toBeVisible();
  await page.keyboard.press("Control+Backquote");
  await expect(page.locator(".ide-panel")).toHaveCSS("height", "30px");
  await expect(code(page, "util.cpp")).toBeFocused();
});

test("changes open as a diff of the open document and editing works without a language server", async ({
  page,
}) => {
  await start(page, { server: false });
  await openProject(page);
  await openFile(page, "src", "main.cpp");
  await expect(page.locator(".code-status")).toHaveText("clangd unavailable");
  const view = code(page, "main.cpp");
  await view.click();
  await page.keyboard.type("// still editable\n");
  await expect(view).toContainText("// still editable");
  await codeMenu(page, "Open Changes");
  await expect(
    page.getByRole("tab", { name: "main.cpp (changes)" }),
  ).toBeVisible();
  // The working tree change: the staged text against the current one.
  await expect(
    page.getByRole("textbox", { name: "Staged version" }),
  ).toContainText("return 0;");
  await expect(
    page.getByRole("textbox", { name: "Current version" }),
  ).toContainText("// still editable");
  // The staged side is read only; the current one is the document.
  await expect(
    page.getByRole("textbox", { name: "Staged version" }),
  ).toHaveAttribute("contenteditable", "false");
  await expect(
    page.getByRole("textbox", { name: "Current version" }),
  ).toHaveAttribute("contenteditable", "true");
});

test("explorer creates, renames and trashes files after confirmation", async ({
  page,
}) => {
  await start(page);
  await openProject(page);
  // Creating a file in a folder goes through the folder's context menu.
  await tree(page)
    .getByRole("treeitem", { name: /^src/ })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "New File…" }).click();
  // The name is typed in a row of the tree, as in VS Code, not in the palette.
  const created = tree(page).getByRole("textbox", { name: "New file name" });
  await created.fill("extra.cpp");
  await created.press("Enter");
  await expect(code(page, "extra.cpp")).toBeVisible();
  expect(await onDisk(page, "/proj/src/extra.cpp")).toBe(true);

  await tree(page)
    .getByRole("treeitem", { name: /^extra.cpp/ })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  // The name is edited in its row, preselected without its extension.
  const name = tree(page).getByRole("textbox", { name: "Rename extra.cpp" });
  await expect(name).toHaveValue("extra.cpp");
  await page.keyboard.type("renamed");
  await expect(name).toHaveValue("renamed.cpp");
  await name.press("Enter");
  await expect(
    tree(page).getByRole("treeitem", { name: /^renamed.cpp/ }),
  ).toBeVisible();
  // The open tab follows the file.
  await expect(page.getByRole("tab", { name: /renamed.cpp/ })).toBeVisible();

  await tree(page)
    .getByRole("treeitem", { name: /^renamed.cpp/ })
    .click();
  await tree(page)
    .getByRole("treeitem", { name: /^renamed.cpp/ })
    .press("Delete");
  await expect(
    page.getByRole("dialog", { name: "Move to Trash" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(await onDisk(page, "/proj/src/renamed.cpp")).toBe(true);
  await tree(page)
    .getByRole("treeitem", { name: /^renamed.cpp/ })
    .press("Delete");
  await page.getByRole("button", { name: "Move to Trash" }).click();
  await expect(
    tree(page).getByRole("treeitem", { name: /^renamed.cpp/ }),
  ).toHaveCount(0);
  // Ctrl+Z restores it from the Trash, Ctrl+Y trashes it again.
  await tree(page).focus();
  await page.keyboard.press("Control+z");
  await expect(
    tree(page).getByRole("treeitem", { name: /^renamed.cpp/ }),
  ).toBeVisible();
  expect(await onDisk(page, "/proj/src/renamed.cpp")).toBe(true);
  await page.keyboard.press("Control+y");
  await expect(
    tree(page).getByRole("treeitem", { name: /^renamed.cpp/ }),
  ).toHaveCount(0);
  // A click on the empty space below the rows clears the selection.
  await tree(page).getByRole("treeitem", { name: /^inc/ }).click();
  await expect(
    tree(page).locator('[role=treeitem][aria-selected="true"]'),
  ).toHaveCount(1);
  const box = await tree(page).boundingBox();
  await page.mouse.click(box!.x + 40, box!.y + box!.height - 6);
  await expect(
    tree(page).locator('[role=treeitem][aria-selected="true"]'),
  ).toHaveCount(0);

  // Dragging a file onto a folder moves it; its open tab follows.
  await tree(page)
    .getByRole("treeitem", { name: /^util.cpp/ })
    .click();
  await expect(code(page, "util.cpp")).toBeVisible();
  await tree(page).getByRole("treeitem", { name: /^inc/ }).click();
  const source = await tree(page)
    .getByRole("treeitem", { name: /^util.cpp/ })
    .boundingBox();
  const target = await tree(page)
    .getByRole("treeitem", { name: /^inc/ })
    .boundingBox();
  await page.mouse.move(source!.x + 30, source!.y + 10);
  await page.mouse.down();
  await page.mouse.move(target!.x + 30, target!.y + 12, { steps: 6 });
  await expect(tree(page).getByRole("treeitem", { name: /^inc/ })).toHaveClass(
    /drop-target/,
  );
  // The dragged file follows the pointer.
  await expect(page.locator(".project-drag-name")).toHaveText("util.cpp");
  await page.mouse.up();
  await expect.poll(() => onDisk(page, "/proj/inc/util.cpp")).toBe(true);
  expect(await onDisk(page, "/proj/src/util.cpp")).toBe(false);
  await code(page, "util.cpp").click();
  expect(
    await page.evaluate(async () => {
      const loaded = (path: string) =>
        performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((url) => new URL(url).pathname === path) ?? path;
      const docs = await import(
        loaded("/src/plugins/text-editor/documents.ts")
      );
      return docs.allDocuments().map((d: { path: string }) => d.path);
    }),
  ).toContain("/proj/inc/util.cpp");
});

test("explorer marks rows with Ctrl and Shift, copies and pastes, and has title buttons", async ({
  page,
}) => {
  await start(page);
  await openProject(page);
  await tree(page).getByRole("treeitem", { name: /^src/ }).click();
  const main = tree(page).getByRole("treeitem", { name: /^main.cpp/ });
  const util = tree(page).getByRole("treeitem", { name: /^util.cpp/ });
  await main.click();
  // Ctrl+click marks a second file without opening it.
  await util.click({ modifiers: ["Control"] });
  await expect(main).toHaveAttribute("aria-selected", "true");
  await expect(util).toHaveAttribute("aria-selected", "true");
  await expect(code(page, "util.cpp")).toHaveCount(0);
  await page.keyboard.press("Control+c");
  await tree(page).getByRole("treeitem", { name: /^inc/ }).click();
  await page.keyboard.press("Control+v");
  await expect.poll(() => onDisk(page, "/proj/inc/main.cpp")).toBe(true);
  expect(await onDisk(page, "/proj/inc/util.cpp")).toBe(true);
  expect(await onDisk(page, "/proj/src/main.cpp")).toBe(true);
  // Shift+click marks the range between two rows.
  await tree(page)
    .getByRole("treeitem", { name: /^foo.h/ })
    .click();
  await tree(page)
    .getByRole("treeitem", { name: /^util.cpp/ })
    .first()
    .click({ modifiers: ["Shift"] });
  await expect(
    tree(page).locator('[role=treeitem][aria-selected="true"]'),
  ).toHaveCount(3);

  // The title's buttons show on hover: Collapse Folders folds every folder.
  const files = page.getByRole("region", { name: "proj" });
  await files.hover();
  await page.screenshot({ path: "test-results/ide-explorer.png" });
  await page
    .getByRole("button", { name: "Collapse Folders in Explorer" })
    .click();
  await expect(
    tree(page).getByRole("treeitem", { name: /^main.cpp/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "New Folder…" }).click();
  await expect(
    tree(page).getByRole("textbox", { name: "New folder name" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  // Ctrl+Z undoes the paste: the copies leave, the originals stay.
  await tree(page).focus();
  await page.keyboard.press("Control+z");
  await expect.poll(() => onDisk(page, "/proj/inc/main.cpp")).toBe(false);
  expect(await onDisk(page, "/proj/inc/util.cpp")).toBe(false);
  expect(await onDisk(page, "/proj/src/main.cpp")).toBe(true);
});

test("code shortcuts: line selection, cursors above and below, Ctrl+click and header/source", async ({
  page,
}) => {
  await start(page, { server: true });
  await openProject(page);
  await openFile(page, "src", "main.cpp");
  await expect(page.locator(".code-status")).toHaveText("clangd");
  const view = code(page, "main.cpp");
  await view.click();
  // Ctrl+L selects the line, then grows by one line each time.
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Control+l");
  await page.keyboard.press("Control+l");
  await page.keyboard.type("// ");
  await expect(view).toContainText("// int main() {");
  await expect(view).not.toContainText("#include");
  await page.keyboard.press("Control+z");
  // Ctrl+K Ctrl+C comments the selected lines, Ctrl+K Ctrl+U uncomments them.
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Control+l");
  await page.keyboard.press("Control+k");
  await page.keyboard.press("Control+c");
  await expect(view).toContainText('// #include "foo.h"');
  await page.keyboard.press("Control+k");
  await page.keyboard.press("Control+u");
  await expect(view).not.toContainText("// #include");
  // Another key after Ctrl+K ends the chord without typing.
  await page.keyboard.press("Control+k");
  await page.keyboard.press("x");
  await expect(view).not.toContainText("x#include");
  await expect(view).toContainText('#include "foo.h"');
  // Ctrl+Alt+Down adds a cursor on the next line: typing writes on both.
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Control+Alt+ArrowDown");
  await page.keyboard.press("Control+Alt+ArrowDown");
  await page.keyboard.type("@");
  await expect(view).toContainText('@#include "foo.h"');
  await expect(view).toContainText("@int main() {");
  await expect(page.locator(".code-editor .cm-cursor")).toHaveCount(3);
  await page.keyboard.press("Control+z");
  // Alt+click adds a cursor; Ctrl+click goes to the definition.
  await page.keyboard.press("Escape");
  const call = page.locator(".code-editor .cm-line", { hasText: "foo(1)" });
  await call
    .getByText("total")
    .first()
    .click({ modifiers: ["Alt"] });
  await expect(page.locator(".code-editor .cm-cursor")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await call.getByText("foo(1)").click({ modifiers: ["Control"] });
  await expect(code(page, "foo.h")).toBeFocused();
  // Alt+O switches between a source file and its header.
  await page.getByRole("tab", { name: "main.cpp" }).click();
  await code(page, "main.cpp").click();
  await page.keyboard.press("Alt+o");
  await expect(code(page, "foo.h")).toBeFocused();
});

test("CMake: kit, configure, build problems, targets, run and settings", async ({
  page,
}) => {
  await start(page);
  await openProject(page);
  const status = page.locator(".ide-status-cmake");
  await expect(status.getByRole("button")).toHaveText([
    "No kit",
    "Debug",
    "Configure",
    "Build",
    "[all]",
    "▶",
    "⛭",
    "[no target]",
  ]);
  // Nothing has run: configure is the user's decision.
  expect((await fake(page)).cmake.steps).toEqual([]);
  // Configure asks for a kit first, in the palette's pick list.
  await status.getByRole("button", { name: "Configure" }).click();
  const pick = page.getByRole("dialog", { name: "Select a kit" });
  await expect(pick.getByRole("option")).toHaveCount(4);
  await pick.getByRole("combobox").fill("gcc");
  await page.keyboard.press("Enter");
  await expect(status.getByRole("button").first()).toHaveText(
    "GCC 15.2.0 x86_64-linux-gnu",
  );
  await expect(page.getByRole("log", { name: "CMake output" })).toContainText(
    "Configuring done",
  );
  // CMake's own warning is a problem at its CMakeLists.txt line.
  await expect(page.locator(".ide-status-problems")).toContainText("⚠ 1");
  await status.getByRole("button", { name: "Build", exact: true }).click();
  await expect(page.locator(".ide-status-problems")).toContainText("⊗ 1");
  const panel = page.locator(".ide-panel");
  await panel.getByRole("tab", { name: "Problems" }).click();
  await expect(page.getByRole("list", { name: "Problems" })).toContainText(
    "boom",
  );
  // A compiler line in Output opens its file.
  await panel.getByRole("tab", { name: "Output" }).click();
  await page.locator(".output-line.link", { hasText: "boom" }).click();
  await expect(code(page, "main.cpp")).toBeVisible();
  // Targets come from the last configure; the build target is chosen apart from run.
  await status.getByRole("button", { name: "[all]" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Select a build target" })
      .getByRole("option"),
  ).toHaveText([/^all/, /^app\s*Executable/, /^core\s*Static library/]);
  await page.keyboard.press("Escape");
  // Run builds its target first, then starts it in the panel's Run view.
  await status.getByRole("button", { name: "Run", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Select a run target" })
    .getByRole("option", { name: /app/ })
    .click();
  await expect(panel.getByRole("tab", { name: "Run: app" })).toBeVisible();
  expect((await fake(page)).cmake.steps).toEqual([
    "configure:all",
    "build:all",
    "build:app",
  ]);
  await expect(status.getByRole("button", { name: "[app]" })).toBeVisible();
  // Every CMake action is a palette command too.
  await page.keyboard.press("Control+Shift+p");
  await page
    .getByRole("combobox", { name: "Type a command" })
    .fill(">cmake variant");
  await page.keyboard.press("Enter");
  await page
    .getByRole("dialog", { name: "Select a variant" })
    .getByRole("option", { name: "Release" })
    .click();
  await expect(status.getByRole("button", { name: "Release" })).toBeVisible();
  // Application-wide CMake settings live in Workspace Settings → IDE.
  await page.keyboard.press("Control+Shift+Comma");
  const settings = page.getByRole("dialog", { name: "Workspace settings" });
  await settings.getByRole("tab", { name: "IDE" }).click();
  await expect(settings.getByRole("list", { name: "Kits" })).toContainText(
    "Clang 21.1.4",
  );
  const before = settings.getByRole("checkbox", {
    name: "Build the target before Run",
  });
  await before.uncheck();
  await expect(before).not.toBeChecked();
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await closeSettings(page);
  expect((await fake(page)).cmakeSettings.settings.buildBeforeRun).toBe(false);
});

test("IDE features turned off in Settings leave the sidebar, status bar, panel and palette", async ({
  page,
}) => {
  await start(page);
  await openProject(page);
  await openFile(page, "src", "main.cpp");
  const views = page.getByRole("tablist", { name: "Project views" });
  await expect(
    views.getByRole("tab", { name: "Source Control" }),
  ).toBeVisible();
  await expect(page.locator(".ide-status-branch")).toHaveText("main");
  await page.keyboard.press("Control+Shift+Comma");
  const settings = page.getByRole("dialog", { name: "Workspace settings" });
  await settings.getByRole("tab", { name: "IDE" }).click();
  await settings
    .getByRole("checkbox", { name: "Source Control (Git)" })
    .uncheck();
  await settings.getByRole("checkbox", { name: "CMake" }).uncheck();
  // Run and Debug and Testing need CMake.
  await expect(
    settings.getByRole("checkbox", { name: "Run and Debug" }),
  ).toBeDisabled();
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await closeSettings(page);
  await expect(settings).toBeHidden();

  for (const name of ["Source Control", "Run and Debug", "Testing"])
    await expect(views.getByRole("tab", { name })).toHaveCount(0);
  await expect(views.getByRole("tab", { name: "Explorer" })).toBeVisible();
  await expect(page.locator(".ide-status-branch")).toHaveCount(0);
  await expect(page.locator(".ide-status-cmake")).toHaveCount(0);
  await expect(
    page.locator(".ide-panel").getByRole("tab", { name: "Debug Console" }),
  ).toHaveCount(0);
  await expect(page.locator(".cm-breakpoint-gutter")).toBeHidden();
  await page.keyboard.press("Control+Shift+p");
  await page
    .getByRole("combobox", { name: "Type a command" })
    .fill(">debug: start");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await expect(
    palette.getByRole("option", { name: /Debug: Start/ }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Turned on again, they come back.
  await page.keyboard.press("Control+Shift+Comma");
  await settings.getByRole("tab", { name: "IDE" }).click();
  await settings
    .getByRole("checkbox", { name: "Source Control (Git)" })
    .check();
  await settings.getByRole("checkbox", { name: "CMake" }).check();
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await closeSettings(page);
  await expect(
    views.getByRole("tab", { name: "Source Control" }),
  ).toBeVisible();
  await expect(views.getByRole("tab", { name: "Run and Debug" })).toBeVisible();
  await expect(page.locator(".ide-status-branch")).toHaveText("main");
  await page.keyboard.press("Control+Shift+p");
  await page
    .getByRole("combobox", { name: "Type a command" })
    .fill(">debug: start");
  await expect(
    palette.getByRole("option", { name: /Debug: Start/ }).first(),
  ).toBeVisible();
});

test("code gutter: problem markers, breakpoints, line numbers, then fold chevrons; Ctrl+hover marks a definition link", async ({
  page,
}) => {
  await start(page, { server: true });
  await openProject(page);
  await openFile(page, "src", "main.cpp");
  await expect(page.locator(".code-status")).toHaveText("clangd");
  const gutters = page.locator(".code-editor .cm-gutter");
  expect(
    await gutters.evaluateAll((list) =>
      list.map((g) =>
        [
          "cm-breakpoint-gutter",
          "cm-gutter-lint",
          "cm-lineNumbers",
          "cm-git-gutter",
          "cm-foldGutter",
        ].find((c) => g.classList.contains(c)),
      ),
    ),
  ).toEqual([
    "cm-gutter-lint",
    "cm-breakpoint-gutter",
    "cm-lineNumbers",
    "cm-git-gutter",
    "cm-foldGutter",
    undefined,
  ]);
  // An open fold chevron shows only while the pointer is over the gutter.
  const marker = page.locator(".code-editor .cm-fold-marker.open").first();
  await expect(marker).toHaveCSS("opacity", "0");
  await page.locator(".code-editor .cm-lineNumbers").hover();
  await expect(marker).toHaveCSS("opacity", "1");
  await marker.click();
  // (The gutter's hidden spacer holds a folded marker too.)
  const folded = page.locator(
    ".code-editor .cm-fold-marker.folded >> visible=true",
  );
  await expect(folded).toHaveCount(1);
  await expect(page.locator(".code-editor .cm-foldPlaceholder")).toBeVisible();
  await folded.click();
  await expect(page.locator(".code-editor .cm-foldPlaceholder")).toHaveCount(0);
  // With Ctrl held, the word under the pointer looks like a link.
  const at = await page.evaluate(() => {
    const line = [...document.querySelectorAll(".code-editor .cm-line")].find(
      (l) => l.textContent!.includes("foo(1)"),
    )!;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const index = node.data.indexOf("foo");
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index + 1);
      range.setEnd(node, index + 2);
      const rect = range.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }
    return null;
  });
  await page.mouse.move(at!.x, at!.y);
  await page.keyboard.down("Control");
  await expect(page.locator(".code-editor .cm-definition-link")).toHaveText(
    "foo",
  );
  await page.keyboard.up("Control");
  await expect(page.locator(".code-editor .cm-definition-link")).toHaveCount(0);
  // Without Ctrl the server's hover shows, its code highlighted as in the editor.
  const hover = page.locator(".cm-lsp-hover-tooltip");
  await expect(hover).toContainText("int foo(int value)");
  const colors = await hover
    .locator("span[class]")
    .evaluateAll((spans) => spans.map((s) => getComputedStyle(s).color));
  expect(new Set(colors).size).toBeGreaterThan(1);

  // The breakpoint gutter has an element on every line, not only the cursor's, so it keeps
  // its width when the cursor line scrolls out of view and the numbers never slide over it.
  const lines = await page
    .locator(".code-editor .cm-lineNumbers .cm-gutterElement >> visible=true")
    .count();
  await expect(
    page.locator(".code-editor .cm-breakpoint-gutter .cm-gutterElement"),
  ).toHaveCount(lines);
  const width = await page
    .locator(".code-editor .cm-breakpoint-gutter")
    .evaluate((g) => g.getBoundingClientRect().width);
  expect(width).toBe(14);
});

test("a comparison edits its file: the code tab opens behind it and arrows revert changes", async ({
  page,
}) => {
  await start(page, { server: false });
  await openProject(page);
  await page.getByRole("tab", { name: "Source Control" }).click();
  await page
    .getByRole("list", { name: "Changes", exact: true })
    .getByRole("button", { name: /^main\.cpp/ })
    .click();
  const current = page.getByRole("textbox", { name: "Current version" });
  await expect(current).toHaveAttribute("contenteditable", "true");
  await expect(
    page.getByRole("tab", { name: "main.cpp", exact: true }),
  ).toHaveCount(0);
  await current.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("// edited here");
  // The edit is the file's document: its code tab opens behind the comparison, unsaved.
  await expect(page.getByRole("tab", { name: "main.cpp •" })).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "main.cpp (changes) •" }),
  ).toHaveAttribute("aria-selected", "true");
  // The arrow beside a change puts the staged lines back.
  const arrows = page.locator(".cm-merge-revert button");
  const before = await arrows.count();
  expect(before).toBeGreaterThan(1);
  await arrows.last().click();
  await expect.poll(() => arrows.count()).toBeLessThan(before);
  await expect(current).not.toContainText("// edited here");
  await expect(
    page.getByRole("tab", { name: "main.cpp", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "main.cpp", exact: true }).click();
  await expect(code(page, "main.cpp")).not.toContainText("// edited here");
  await expect(code(page, "main.cpp")).toContainText("return total;");
});

test("the IDE keeps its code editor; Ctrl+Shift+C closes the whole IDE after asking", async ({
  page,
}) => {
  await start(page, { server: false });
  await openProject(page);
  await openFile(page, "src", "main.cpp");
  // Closing the last code tab leaves an empty code area, without a tab.
  await page.getByRole("button", { name: "Close main.cpp" }).click();
  const empty = page.locator(".code-empty");
  const code = page.locator(".panel", { has: empty });
  await expect(empty).toContainText("double-click the tab bar");
  await expect(code.getByRole("tab")).toHaveCount(0);
  // A double click on its tab bar adds a new file there, as in the Text Editor.
  await code.locator(".panel-header").dblclick({ position: { x: 120, y: 10 } });
  const untitled = page.getByRole("tab", { name: "Untitled" });
  await expect(untitled).toBeVisible();
  await expect(empty).toHaveCount(0);
  await page.getByRole("button", { name: "Close Untitled" }).click();
  await expect(empty).toBeVisible();
  await expect(untitled).toHaveCount(0);
  await empty.click();
  await page.keyboard.press("Control+Shift+C");
  await expect(page.getByRole("dialog", { name: "Close IDE" })).toContainText(
    "and its code editors",
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(tree(page)).toBeVisible();
  await empty.click();
  await page.keyboard.press("Control+Shift+C");
  await page.getByRole("button", { name: "Close IDE" }).click();
  await expect(tree(page)).toHaveCount(0);
  await expect(empty).toHaveCount(0);
  await expect(page.locator(".panel")).toHaveCount(0);
});

/** Clicks the breakpoint gutter beside a line number of the open code editor. */
async function gutterClick(
  page: Page,
  line: number,
  button: "left" | "right" = "left",
) {
  const number = page
    .locator(".code-editor .cm-lineNumbers .cm-gutterElement")
    .filter({ hasText: new RegExp(`^${line}$`) });
  const row = (await number.boundingBox())!;
  const gutter = (await page
    .locator(".code-editor .cm-breakpoint-gutter")
    .boundingBox())!;
  await page.mouse.click(gutter.x + gutter.width / 2, row.y + row.height / 2, {
    button,
  });
}
async function configureWithGcc(page: Page) {
  const status = page.locator(".ide-status-cmake");
  await status.getByRole("button", { name: "Configure" }).click();
  await page
    .getByRole("dialog", { name: "Select a kit" })
    .getByRole("combobox")
    .fill("gcc");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("log", { name: "CMake output" })).toContainText(
    "Configuring done",
  );
  return status;
}

test("Run and Debug: build, pause at a breakpoint, inspect, step, set a value and end", async ({
  page,
}) => {
  await start(page);
  await openProject(page);
  await configureWithGcc(page);
  await openFile(page, "src", "main.cpp");
  // A click left of the line numbers sets a breakpoint; a right-click edits one.
  await gutterClick(page, 4);
  await expect(page.locator(".code-editor .cm-breakpoint.line")).toHaveCount(1);
  await gutterClick(page, 5, "right");
  await page
    .getByRole("menuitem", { name: "Add Hit Count Breakpoint…" })
    .click();
  const dialog = page.getByRole("dialog", {
    name: /Add breakpoint · main.cpp:5/,
  });
  await dialog.getByRole("textbox", { name: "Hit count" }).fill("x");
  await expect(dialog.getByRole("alert")).toContainText(
    "positive whole number",
  );
  await dialog.getByRole("textbox", { name: "Hit count" }).fill("2");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(
    page.locator(".code-editor .cm-breakpoint.hitCount"),
  ).toHaveCount(1);

  // Run and Debug lists them; watch expressions are kept with them.
  await page.getByRole("tab", { name: "Run and Debug" }).click();
  const view = page.locator(".debug-view");
  await expect(view.locator(".debug-breakpoint")).toHaveText([
    /main\.cpp\s*4/,
    /main\.cpp\s*5\s*from hit 2/,
  ]);
  await view.getByRole("button", { name: "Add Expression" }).click();
  await page
    .getByRole("textbox", { name: "Expression to watch" })
    .fill("total");
  await page.keyboard.press("Enter");
  await expect(view.locator(".debug-watch")).toContainText(
    "total: not available",
  );
  await expect
    .poll(async () => (await fake(page)).debug.saved?.watches)
    .toEqual(["total"]);
  expect((await fake(page)).debug.saved.breakpoints).toMatchObject([
    { path: "/proj/src/main.cpp", line: 4, enabled: true },
    { path: "/proj/src/main.cpp", line: 5, hitCondition: "2" },
  ]);

  // Debug builds the run target first (never configures), then pauses at the breakpoint.
  await view.getByRole("button", { name: "▶ Start Debugging" }).click();
  await page
    .getByRole("dialog", { name: "Select a run target" })
    .getByRole("option", { name: /app/ })
    .click();
  const toolbar = page.getByRole("toolbar", { name: "Debug" });
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Continue" })).toBeVisible();
  expect((await fake(page)).cmake.steps).toEqual([
    "configure:all",
    "build:app",
  ]);
  // GDB counts ignored hits: "from the 2nd hit" is sent as 1.
  const sent = (await fake(page)).debug.requests.find(
    (r: any) => r.command === "setBreakpoints",
  );
  expect(sent.arguments.breakpoints).toEqual([
    { line: 4 },
    { line: 5, hitCondition: "1" },
  ]);
  await expect(view.locator(".debug-frame")).toHaveText([
    /main\s*main\.cpp:4/,
    /__libc_start_main\s*no source/,
  ]);
  await expect(page.locator(".code-editor .cm-debug-paused")).toContainText(
    "int total = foo(1);",
  );
  await expect(page.locator(".code-editor .cm-debug-arrow")).toHaveCount(1);
  const variables = page.getByRole("tree", { name: "Variables" });
  await expect(variables.getByRole("treeitem")).toHaveText([
    "Locals",
    "total: 3",
    "values: std::vector of length 3",
  ]);
  // Debug Hover shows a value under the pointer while paused.
  const word = await page.evaluate(() => {
    const line = document.querySelector(".code-editor .cm-debug-paused")!;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const index = node.data.indexOf("total");
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index + 1);
      range.setEnd(node, index + 2);
      const rect = range.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }
    return null;
  });
  await page.mouse.move(word!.x, word!.y);
  await expect(page.locator(".debug-hover")).toContainText("total: 3");
  await page.mouse.move(5, 5);
  await variables.getByRole("treeitem", { name: /values/ }).click();
  await expect(variables.getByRole("treeitem")).toHaveCount(6);
  await expect(view.locator(".debug-watch")).toContainText("total: 3");
  // Set Value: double-click a value.
  await variables
    .locator(".debug-value", { hasText: /^3$/ })
    .first()
    .dblclick();
  await page.getByRole("textbox", { name: "New value of total" }).fill("5");
  await page.keyboard.press("Enter");
  await expect(variables.getByRole("treeitem", { name: /total/ })).toHaveText(
    "total: 5",
  );
  await expect(view.locator(".debug-watch")).toContainText("total: 5");
  // The Debug Console evaluates expressions, and shows the errors too.
  const panel = page.locator(".ide-panel");
  await expect(
    panel.getByRole("tab", { name: "Debug Console" }),
  ).toHaveAttribute("aria-selected", "true");
  const input = page.getByRole("textbox", { name: "Evaluate expression" });
  await input.fill("total");
  await page.keyboard.press("Enter");
  await input.fill("nothing");
  await page.keyboard.press("Enter");
  const log = page.getByRole("log", { name: "Debug Console" });
  await expect(log).toContainText("› total");
  await expect(log.locator(".debug-console-line.result")).toHaveText("5");
  await expect(log.locator(".debug-console-line.error")).toContainText(
    'No symbol "nothing"',
  );
  // Step Over moves the paused line; Continue runs to the end.
  await toolbar.getByRole("button", { name: "Step Over" }).click();
  await expect(page.locator(".code-editor .cm-debug-paused")).toContainText(
    "return total;",
  );
  await toolbar.getByRole("button", { name: "Continue" }).click();
  await expect(toolbar).toHaveCount(0);
  // The program's output is in the console, which keeps the session's history; there is
  // no separate output tab.
  await expect(log.locator(".debug-console-line.program")).toContainText([
    "total 5",
  ]);
  await expect(log).toContainText("The program exited with code 0.");
  await expect(panel.getByRole("tab", { name: /^Debug: / })).toHaveCount(0);
  // Afterwards: no paused line or runtime data; breakpoints and watches stay.
  await expect(page.locator(".code-editor .cm-debug-paused")).toHaveCount(0);
  await expect(
    view.getByText("Variables appear while the program is paused."),
  ).toBeVisible();
  await expect(view.locator(".debug-watch")).toContainText(
    "total: not available",
  );
  await expect(page.locator(".code-editor .cm-breakpoint")).toHaveCount(2);
  await expect(
    page.getByRole("tab", { name: "Run and Debug" }),
  ).toHaveAttribute("aria-selected", "true");
});

test("Debug explains a missing debugger before building; the configuration is saved per target", async ({
  page,
}) => {
  await start(page);
  await openProject(page);
  await page.evaluate(() => {
    const debug = (window as any).__ide.debug;
    debug.debuggers = {
      ...debug.debuggers,
      selected: null,
      error:
        "Debugging programs built with MSVC is not supported. Build with a GCC or Clang (GNU) kit to debug; MSVC builds still work.",
    };
  });
  const status = await configureWithGcc(page);
  await page.getByRole("tab", { name: "Run and Debug" }).click();
  const view = page.locator(".debug-view");
  await expect(view.getByRole("alert")).toContainText("MSVC is not supported");
  await status.getByRole("button", { name: "[no target]" }).click();
  await page
    .getByRole("dialog", { name: "Select a run target" })
    .getByRole("option", { name: /app/ })
    .click();
  await view.getByRole("button", { name: "▶ Start Debugging" }).click();
  await expect(page.locator(".ide-status-message")).toContainText(
    "MSVC is not supported",
  );
  // Nothing was built and no session started.
  expect((await fake(page)).cmake.steps).toEqual(["configure:all"]);
  await expect(page.getByRole("toolbar", { name: "Debug" })).toHaveCount(0);
  // The visual configuration writes the target's entry of .mozaik/debug.json.
  await view.getByRole("button", { name: "Debug configuration" }).click();
  const dialog = page.getByRole("dialog", { name: "Debug configuration" });
  await expect(dialog.getByRole("combobox", { name: "Target" })).toHaveValue(
    "app",
  );
  await dialog
    .getByRole("textbox", { name: "Program arguments" })
    .fill("--config\nconfig.json");
  await dialog
    .getByRole("textbox", { name: "Working folder" })
    .fill("${workspaceFolder}");
  await dialog
    .getByRole("textbox", { name: "Environment variables" })
    .fill("APP_MODE=development");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  expect((await fake(page)).debug.config).toEqual({
    version: 1,
    targets: {
      app: {
        args: ["--config", "config.json"],
        cwd: "${workspaceFolder}",
        env: { APP_MODE: "development" },
      },
    },
  });
});

test("Testing: tests listed when shown, by suite, run alone or together, a failure's output, debug and go to code", async ({
  page,
}) => {
  await start(page);
  await openProject(page);
  await page.getByRole("tab", { name: "Testing" }).click();
  const view = page.locator(".testing-view");
  // Showing the view lists the tests; without a configure there is nothing to list.
  await expect(view.getByRole("alert")).toContainText("Configure the project");
  await configureWithGcc(page);
  // Shown again, it lists them; suites are not split by test program.
  await page.getByRole("tab", { name: "Explorer" }).click();
  await page.getByRole("tab", { name: "Testing" }).click();
  const tests = view.getByRole("list", { name: "Tests" });
  await expect(tests.locator(".todo-group")).toHaveText([
    /Math\s*3/,
    /Fixture\s*1/,
  ]);
  await expect(tests.locator(".testing-test")).toHaveText([
    /Adds/,
    /Fails/,
    /Skipped/,
    /Works/,
    /lint/,
  ]);
  expect((await fake(page)).tests).toEqual([]);
  // A suite runs its tests, after building their program.
  const suite = tests.locator(".testing-row", { hasText: "Math" }).first();
  await suite.hover();
  await suite.getByRole("button", { name: "Run Math", exact: true }).click();
  await expect(view).toContainText("5 tests · 1 passed · 1 failed · 1 skipped");
  expect((await fake(page)).tests).toEqual([
    ["Math.Adds", "Math.Fails", "Math.Skipped"],
  ]);
  expect((await fake(page)).cmake.steps).toEqual([
    "configure:all",
    "build:app",
  ]);
  await expect(tests.getByRole("img", { name: "Failed" })).toHaveCount(2);
  await expect(tests.getByRole("img", { name: "Skipped" })).toHaveCount(1);
  await expect(page.getByRole("log", { name: "Tests output" })).toContainText(
    "Expected equality of 2 and 3",
  );
  // A failed test shows its output under the list.
  await tests.locator(".testing-test", { hasText: "Fails" }).click();
  await expect(view.getByLabel("Test output")).toHaveText(
    "math_test.cpp:9: Failure\nExpected equality of 2 and 3",
  );
  // Run All runs every test without a filter.
  await view.getByRole("button", { name: "Run All Tests" }).click();
  // Three tests, and the Fixture suite whose tests all passed.
  await expect(tests.getByRole("img", { name: "Passed" })).toHaveCount(4);
  expect((await fake(page)).tests.at(-1)).toBeNull();
  // Debug runs the program alone with the arguments that select the test.
  const row = tests.locator(".testing-row", { hasText: "Works" });
  await row.hover();
  await row.getByRole("button", { name: "Debug Fixture.Works" }).click();
  await expect
    .poll(async () => (await fake(page)).debug.launches)
    .toEqual([
      {
        target: "app",
        args: [
          "--gtest_filter=Fixture.Works",
          "--gtest_also_run_disabled_tests",
        ],
      },
    ]);
  const lint = tests.locator(".testing-row", { hasText: "lint" });
  await lint.hover();
  await expect(lint.getByRole("button", { name: "Debug lint" })).toBeDisabled();
  // Double-click opens the test's TEST line.
  await page.evaluate(() =>
    (window as any).__ide.disk.set("/proj/src/math_test.cpp", {
      text: "#include <gtest/gtest.h>\n\nTEST(Math, Adds) {\n  EXPECT_EQ(1 + 1, 2);\n}\n",
      revision: "t1",
    }),
  );
  await tests.locator(".testing-test", { hasText: "Adds" }).dblclick();
  await expect(code(page, "math_test.cpp")).toBeVisible();
  // Clear All Results forgets the results; the tests stay listed.
  await view.getByRole("button", { name: "Clear All Results" }).click();
  await expect(tests.getByRole("img", { name: "Passed" })).toHaveCount(0);
  await expect(
    tests.getByRole("img", { name: "Not run" }).first(),
  ).toBeVisible();
  await expect(
    view.getByRole("button", { name: "Clear All Results" }),
  ).toBeDisabled();
});

test("Coverage: a chosen LCOV report by folder, a file's lines read only, then its code", async ({
  page,
}) => {
  await start(page);
  await openProject(page);
  await page.evaluate(async () => {
    const loaded = (path: string) =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((url) => new URL(url).pathname === path) ?? path;
    const backend = (await import(loaded("/src/services/coverage.ts")))
      .coverageBackend;
    const text = [
      "SF:src/main.cpp",
      "FN:3,main",
      "FNDA:1,main",
      "DA:3,1",
      "DA:4,1",
      "DA:5,0",
      "BRDA:4,0,0,1",
      "BRDA:4,0,1,0",
      "end_of_record",
      "SF:/proj/src/util.cpp",
      "FN:3,_Z5twicev",
      "DA:3,0",
      "end_of_record",
      "SF:/usr/include/vector",
      "DA:10,4",
      "end_of_record",
    ].join("\n");
    const fake = { chosen: null as string | null, forgot: 0 };
    (window as any).__coverage = fake;
    const file = () => ({
      path: "/proj/build/coverage.info",
      text,
      modified: 10,
    });
    backend.report = async () => (fake.chosen ? file() : null);
    backend.choose = async () => {
      fake.chosen = "/proj/build/coverage.info";
      return file();
    };
    backend.forget = async () => {
      fake.chosen = null;
      fake.forgot++;
    };
    // util.cpp changed after the report.
    backend.modified = async (paths: string[]) =>
      paths.map((p) => (p.endsWith("util.cpp") ? 20 : 5));
  });
  await page.getByRole("tab", { name: "Coverage" }).click();
  const view = page.locator(".coverage-view");
  await expect(view.locator(".project-hint")).toContainText(
    "Open a coverage report",
  );
  await view.getByRole("button", { name: "Open Coverage Report…" }).click();
  await expect(view.locator(".todo-bar")).toContainText(
    "Lines 60% · Functions 50% · Branches 50%",
  );
  await expect(view.locator(".coverage-source")).toContainText(
    "build/coverage.info",
  );
  const files = view.getByRole("list", { name: "Covered files" });
  await expect(files.locator(".todo-group")).toHaveText([
    /\/usr\/include\s*100%/,
    /src\s*50%/,
  ]);
  await expect(files.locator(".coverage-file")).toHaveText([
    /vector.*100%/,
    /main\.cpp.*66\.7%/,
    /util\.cpp.*0%/,
  ]);
  await expect(
    files
      .locator(".coverage-file", { hasText: "util.cpp" })
      .getByRole("img", { name: "Changed since the report" }),
  ).toBeVisible();
  // A file opens read only among the code editors, its lines coloured by coverage.
  await files.locator(".coverage-file", { hasText: "main.cpp" }).click();
  await expect(
    page.getByRole("tab", { name: "main.cpp (coverage)" }),
  ).toBeVisible();
  const lines = page.getByRole("textbox", { name: "Coverage of main.cpp" });
  await expect(lines).toBeVisible();
  const tab = page.locator(".coverage-file-view");
  await expect(tab.locator(".cm-coverage-covered")).toHaveCount(1);
  await expect(tab.locator(".cm-coverage-partial")).toHaveCount(1);
  await expect(tab.locator(".cm-coverage-uncovered")).toHaveCount(1);
  await expect(tab.locator(".cm-coverage-hits")).toHaveText(["1×", "1×", "0×"]);
  await expect(tab.locator(".code-status")).toHaveText(
    "Lines 66.7% (2/3) · Functions 1/1 · Branches 1/2",
  );
  await lines.click();
  await page.keyboard.type("x");
  await expect(lines).not.toContainText("x");
  // The next uncovered (or partly covered) line, then its code in the editor.
  await page.keyboard.press("Control+Home");
  await tab.getByRole("button", { name: "Next Uncovered Line" }).click();
  await tab.getByRole("button", { name: "Next Uncovered Line" }).click();
  await tab.getByRole("button", { name: "Open in Editor" }).click();
  await expect(code(page, "main.cpp")).toBeFocused();
  await expect(page.locator(".code-editor .cm-line").nth(4)).toHaveText(
    "  return total;",
  );
  // Closing the report forgets it; the file stays.
  await view.getByRole("button", { name: "Close Coverage Report" }).click();
  await expect(view.locator(".project-hint")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__coverage.forgot)).toBe(1);
});

test("Analysis: clang-tidy on the current file, filtered Problems, a previewed fix, then stale", async ({
  page,
}) => {
  await start(page, { server: false });
  await openProject(page);
  await openFile(page, "src", "main.cpp");
  await page.keyboard.press("Control+Shift+p");
  await page.keyboard.type("analysis run current");
  await page.keyboard.press("Enter");
  const problems = page.getByRole("list", { name: "Problems" });
  const row = problems.getByRole("button", { name: /can be declared 'const'/ });
  await expect(row).toContainText("misc-const-correctness");
  await expect(row).toContainText("clang-tidy (run)");
  expect(await page.evaluate(() => (window as any).__analyses)).toEqual([
    { file: "/proj/src/main.cpp" },
  ]);
  await expect(page.locator(".ide-status-analysis")).toHaveText(
    "clang-tidy: current",
  );
  // The filter, in the panel's bar, keeps its problems by word, source and severity.
  const filter = page
    .locator(".ide-panel-bar")
    .getByRole("searchbox", { name: "Filter problems" });
  await filter.fill("braces");
  await expect(page.getByText("No problems match the filter.")).toBeVisible();
  await filter.fill("const total");
  await expect(row).toBeVisible();
  await page
    .getByRole("combobox", { name: "Problem severity" })
    .selectOption("1");
  await expect(row).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Problem severity" })
    .selectOption("4");

  // A fix is previewed as a diff and changes the open editor, unsaved and undoable.
  await page.getByRole("button", { name: "Fix…" }).click();
  const preview = page.getByRole("dialog", { name: /Fix: misc-const/ });
  await expect(preview).toContainText("-   int total = foo(1);");
  await expect(preview).toContainText("+   const int total = foo(1);");
  await preview.getByRole("button", { name: "Apply" }).click();
  await expect(code(page, "main.cpp")).toContainText("const int total");
  expect(await diskText(page, "/proj/src/main.cpp")).not.toContain("const");
  // The text changed since the run: the finding is stale and offers no fix.
  await expect(row).toContainText("stale");
  await expect(page.getByRole("button", { name: "Fix…" })).toHaveCount(0);
  await expect(page.locator(".ide-status-analysis")).toHaveText(
    "clang-tidy: stale",
  );
  await page.locator(".ide-status-analysis").click();
  await expect(
    page.getByRole("log", { name: "Analysis output" }),
  ).toContainText("1 warning generated.");
});

test("SonarQube: connect from the view, issues in Problems and the editor, tracked while editing, compared on refresh", async ({
  page,
}) => {
  await start(page, { server: false });
  await openProject(page);
  // The analyzed text is the file on disk, so the base of main.cpp is what is there now.
  await page.evaluate(async () => {
    const loaded = (path: string) =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((url) => new URL(url).pathname === path) ?? path;
    const sonar = (await import(loaded("/src/services/sonar.ts"))).sonarBackend;
    const disk = (window as any).__ide.disk;
    sonar.revisionText = async (path: string) => disk.get(path)?.text ?? null;
  });
  await page.getByRole("tab", { name: "SonarQube" }).click();
  // The form starts from the project's sonar-project.properties; the token is typed.
  const url = page.getByRole("textbox", { name: "Server URL" });
  await expect(url).toHaveValue("https://sonar.example.com");
  await expect(page.getByRole("textbox", { name: "Project key" })).toHaveValue(
    "demo",
  );
  await page.getByLabel("Token").fill("squ_secret");
  await page.getByRole("button", { name: "Connect" }).click();

  const issues = page.getByRole("list", { name: "SonarQube issues" });
  await expect(page.locator(".sonar-target")).toContainText(
    "Merge request !42 · main",
  );
  await expect(page.locator(".sonar-gate")).toHaveText(
    "Quality Gate: Failed · 1 condition failed",
  );
  await expect(
    issues.getByRole("button", { name: /Make 'total' const/ }),
  ).toContainText("4:3");
  expect(await page.evaluate(() => (window as any).__sonar.connects)).toEqual([
    {
      url: "https://sonar.example.com",
      projectKey: "demo",
      token: "squ_secret",
    },
  ]);
  // The local branch went with the request.
  expect(await page.evaluate(() => (window as any).__sonar.fetches)).toEqual([
    { branch: "main", mainOnly: false },
  ]);

  // In Problems with the other providers, and drawn in the editor.
  await page.keyboard.press("Control+Shift+p");
  await page.keyboard.type("analysis show problems");
  await page.keyboard.press("Enter");
  const problems = page.getByRole("list", { name: "Problems" });
  await expect(
    problems.getByRole("button", { name: /Make 'total' const/ }),
  ).toContainText("SonarQube");
  // A click on an issue opens its file at its place.
  await issues.getByRole("button", { name: /Make 'total' const/ }).click();
  const editor = code(page, "main.cpp");
  await expect(editor).toBeVisible();
  await expect(page.locator(".cm-editor .cm-lintRange")).toHaveCount(2);

  // A line added at the top moves the issues below it.
  await editor.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.type("// note");
  await page.keyboard.press("Enter");
  // The view stays open beside the editor.
  await expect(
    issues.getByRole("button", { name: /Make 'total' const/ }),
  ).toContainText("5:3");
  // Editing an issue's own line puts it under Changed; the other issue stays tracked.
  await editor.click();
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.type(" // changed");
  await expect(
    page.getByRole("button", { name: /^Changed, awaiting CI/ }),
  ).toContainText("1");
  await expect(
    issues.getByRole("button", { name: /Return the call directly/ }),
  ).toContainText("6:3");
  await expect(page.locator(".cm-editor .cm-lintRange")).toHaveCount(1);
  await expect(page.locator(".sonar-view .sonar-stale")).toContainText(
    "Make 'total' const",
  );

  // CI analyzed again: one issue fixed, one new, said so and marked.
  await page.getByRole("button", { name: "Refresh SonarQube Results" }).click();
  await expect(page.locator(".sonar-summary")).toHaveText(
    "Since the last refresh: 1 fixed, 1 new",
  );
  await expect(
    issues.getByRole("button", { name: /Include what you use/ }),
  ).toContainText("new");
});

test("the activity bar's gear opens IDE settings and file icon themes preview from the palette", async ({
  page,
}) => {
  await start(page);
  await openProject(page);
  await page.getByRole("button", { name: "IDE Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Workspace settings" });
  await expect(settings.getByRole("tab", { name: "IDE" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    settings.getByRole("combobox", { name: "File icon theme" }),
  ).toHaveValue("seti");
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  // Seti draws no folder icons; the theme under the cursor shows at once.
  const folder = tree(page).getByRole("treeitem", { name: /^src/ });
  await expect(folder.locator("svg.entry-icon")).toHaveCount(0);
  const openPicker = async () => {
    await page.keyboard.press("Control+Shift+p");
    await page
      .getByRole("combobox", { name: "Type a command" })
      .fill(">file icon theme");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Select File Icon Theme" }),
    ).toBeVisible();
  };
  await openPicker();
  await page.keyboard.press("ArrowDown");
  await expect(folder.locator("svg.entry-icon")).toHaveCount(1);
  // Escape puts the saved theme back.
  await page.keyboard.press("Escape");
  await expect(folder.locator("svg.entry-icon")).toHaveCount(0);
  await openPicker();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(folder.locator("svg.entry-icon")).toHaveCount(1);
  await page.screenshot({ path: "test-results/ide-icons.png" });
});

test("IDE zoom scales the whole IDE, as in VS Code", async ({ page }) => {
  await start(page);
  await openProject(page);
  await openFile(page, "src", "main.cpp");
  const measure = () =>
    page.evaluate(() => {
      const box = (selector: string) =>
        document.querySelector(selector)!.getBoundingClientRect();
      const font = (selector: string) =>
        parseFloat(
          getComputedStyle(document.querySelector(selector)!).fontSize,
        );
      return {
        code: font(".code-editor .cm-editor"),
        row: font('.project [role="treeitem"]'),
        tab: font('.panel[data-plugin="code"] .tabs [role="tab"]'),
        status: font(".ide-status"),
        statusHeight: box(".ide-status").height,
        activity: box(".project-activity").width,
        bar: box(".ide-panel .ide-bar").height,
      };
    });
  const before = await measure();
  const zoom = async (command: string) => {
    await page.keyboard.press("Control+Shift+p");
    await page.getByRole("combobox", { name: "Type a command" }).fill(command);
    await page.keyboard.press("Enter");
  };
  for (let i = 0; i < 4; i++) {
    await zoom(">IDE: Zoom In");
    await expect
      .poll(async () => (await measure()).code)
      .toBe(before.code + i + 1);
  }
  const after = await measure();
  // 17px of 13px: everything grows by the same factor, docked bars with it.
  const factor = after.code / before.code;
  for (const key of ["row", "tab", "status", "activity", "bar"] as const)
    expect(after[key] / before[key]).toBeCloseTo(factor, 1);
  expect(after.statusHeight).toBeGreaterThan(before.statusHeight + 4);
  await page.screenshot({ path: "test-results/ide-zoom.png" });
  await zoom(">IDE: Reset Zoom");
  await expect.poll(async () => (await measure()).code).toBe(before.code);
  expect((await measure()).activity).toBe(before.activity);
});

test("a click in the Explorer keeps the focus there: F2, Escape on a cut and the path items", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await start(page);
  await openProject(page);
  await tree(page).getByRole("treeitem", { name: /^src/ }).click();
  const main = tree(page).getByRole("treeitem", { name: /^main.cpp/ });
  await main.click();
  await expect(code(page, "main.cpp")).toBeVisible();
  await expect(main).toBeFocused();
  // The clipboard keys act on the row; Escape calls off a cut.
  await page.keyboard.press("Control+x");
  await expect(main).toHaveClass(/cut/);
  await page.keyboard.press("Escape");
  await expect(main).not.toHaveClass(/cut/);
  // F2 renames the clicked file.
  await main.click();
  await page.keyboard.press("F2");
  await expect(
    tree(page).getByRole("textbox", { name: "Rename main.cpp" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  // The menu copies its full and its project-relative path.
  await main.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy Path", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "/proj/src/main.cpp",
  );
  await main.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy Relative Path" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "src/main.cpp",
  );
  // A double click goes on to the editor.
  await main.dblclick();
  await expect(code(page, "main.cpp")).toBeFocused();
});

test("the code menu cuts, copies and pastes; a jump lands in the middle of the view; F5 does not reload", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await start(page);
  await page.evaluate(() =>
    (window as any).__ide.disk.set("/proj/long.cpp", {
      text: Array.from({ length: 400 }, (_, i) => `// line ${i + 1}`).join(
        "\n",
      ),
      revision: "l1",
    }),
  );
  await openProject(page);
  await tree(page)
    .getByRole("treeitem", { name: /^long.cpp/ })
    .dblclick();
  const view = code(page, "long.cpp");
  await expect(view).toBeFocused();
  await page.evaluate(() => ((window as any).__alive = true));
  await page.keyboard.press("F5");
  await page.keyboard.press("Control+r");
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as any).__alive)).toBe(true);

  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Shift+End");
  const menu = async (item: string) => {
    await view
      .locator(".cm-line")
      .first()
      .click({ button: "right", position: { x: 8, y: 4 } });
    await page.getByRole("menuitem", { name: new RegExp(`^${item}`) }).click();
  };
  await menu("Copy");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "// line 1",
  );
  await menu("Cut");
  await expect(view.locator(".cm-line").first()).toHaveText("");
  await menu("Paste");
  await expect(view.locator(".cm-line").first()).toHaveText("// line 1");

  // A search result far below lands near the middle, not at the edge.
  await page.getByRole("tab", { name: "Search" }).click();
  await page
    .getByRole("textbox", { name: "Search in project" })
    .fill("line 300");
  await page.keyboard.press("Enter");
  await page.locator(".results-match").first().click();
  const line = page.locator(".cm-line", { hasText: "// line 300" });
  await expect(line).toBeVisible();
  const box = (await line.boundingBox())!;
  const shown = (await page
    .locator(".code-editor .cm-scroller")
    .boundingBox())!;
  const middle = shown.y + shown.height / 2;
  expect(Math.abs(box.y - middle)).toBeLessThan(shown.height / 4);
});

test("Source Control marks rows with Ctrl and Shift, stages them together, refreshes and shows the graph", async ({
  page,
}) => {
  await start(page);
  await openProject(page);
  const status: unknown[] = [];
  await page.exposeFunction("__statusAsked", () => status.push(1));
  await page.evaluate(async () => {
    const loaded = (path: string) =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((url) => new URL(url).pathname === path) ?? path;
    const { ideBackend } = await import(loaded("/src/services/ide.ts"));
    const staged = new Set<string>();
    ideBackend.gitStatus = async () => {
      (window as any).__statusAsked();
      return {
        root: "/proj",
        branch: "main",
        head: "m1",
        ignored: [],
        changes: ["a", "b", "c"]
          .map((n) => `/proj/${n}.txt`)
          .map((path) =>
            staged.has(path)
              ? { path, status: "M", staged: "M", unstaged: null }
              : { path, status: "M", staged: null, unstaged: "M" },
          ),
      };
    };
    ideBackend.stage = async (_root: string, paths: string[]) => {
      paths.forEach((p: string) => staged.add(p));
    };
  });
  await page.getByRole("tab", { name: "Source Control" }).click();
  // Opening the view asks Git again.
  await expect.poll(() => status.length).toBeGreaterThan(0);
  const before = status.length;
  await page.getByRole("button", { name: "Refresh Source Control" }).click();
  await expect.poll(() => status.length).toBeGreaterThan(before);

  const changes = page.getByRole("list", { name: "Changes", exact: true });
  const row = (name: string) => changes.locator(".scm-row", { hasText: name });
  await row("a.txt").locator(".project-row").click();
  await row("c.txt")
    .locator(".project-row")
    .click({ modifiers: ["Shift"] });
  await expect(changes.locator(".scm-row.selected")).toHaveCount(3);
  await row("b.txt")
    .locator(".project-row")
    .click({ modifiers: ["Control"] });
  await expect(changes.locator(".scm-row.selected")).toHaveCount(2);
  await expect(row("b.txt")).not.toHaveClass(/selected/);
  // The menu of a marked row stages every marked row.
  await row("a.txt").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Stage 2 Files" }).click();
  const staged = page.getByRole("list", { name: "Staged Changes" });
  await expect(staged.locator(".scm-row")).toHaveCount(2);
  await expect(row("b.txt")).toBeVisible();

  // The graph lists the history with its references.
  const commits = page.getByRole("list", { name: "Commits" });
  await expect(commits.locator(".git-graph-row")).toHaveCount(4);
  await expect(commits.locator(".git-graph-subject").first()).toHaveText(
    "Merge feature",
  );
  await expect(commits.locator(".ref-head")).toHaveText("main");
  await expect(commits.locator(".ref-tag")).toHaveText("v1");
  await page.screenshot({ path: "test-results/ide-source-control.png" });
});

test("Search looks like VS Code: folding files, Replace behind a twisty, ignored files on request", async ({
  page,
}) => {
  await start(page);
  await openProject(page);
  const asked: unknown[] = [];
  await page.exposeFunction("__searchAsked", (q: unknown) => asked.push(q));
  await page.evaluate(async () => {
    const loaded = (path: string) =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((url) => new URL(url).pathname === path) ?? path;
    const { ideBackend } = await import(loaded("/src/services/ide.ts"));
    const real = ideBackend.search;
    ideBackend.search = (root: string, query: any) => {
      (window as any).__searchAsked(query);
      return real(root, query);
    };
  });
  await page.getByRole("tab", { name: "Search" }).click();
  await expect(page.getByRole("textbox", { name: "Replace with" })).toHaveCount(
    0,
  );
  const input = page.getByRole("textbox", { name: "Search in project" });
  await input.fill("int");
  await page
    .getByRole("button", { name: "Search Files Ignored by Git" })
    .click();
  await input.press("Enter");
  await expect.poll(() => (asked.at(-1) as any)?.ignored).toBe(true);
  const file = page.locator(".results-file").first();
  await expect(file.locator(".results-count")).not.toHaveText("");
  const matches = page.locator(".results-match");
  const count = await matches.count();
  expect(count).toBeGreaterThan(0);
  await file.click();
  await expect.poll(() => matches.count()).toBeLessThan(count);
  await page.screenshot({ path: "test-results/ide-search.png" });
  await page.getByRole("button", { name: "Clear results" }).click();
  await expect(page.locator(".results-file")).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle Replace" }).click();
  await expect(
    page.getByRole("textbox", { name: "Replace with" }),
  ).toBeVisible();
});

test("the gutter and the minimap show changed lines, and the minimap has a setting", async ({
  page,
}) => {
  await start(page);
  await openProject(page);
  await page.evaluate(() => {
    const fake = (window as any).__ide;
    const text = fake.disk.get("/proj/src/main.cpp").text;
    // Git's staged text lacks the file's first line and has one more at its end.
    fake.head.set(
      "/proj/src/main.cpp",
      `${text.split("\n").slice(1).join("\n")}// only in Git\n`,
    );
  });
  await tree(page).getByRole("treeitem", { name: /^src/ }).click();
  await tree(page)
    .getByRole("treeitem", { name: /^main.cpp/ })
    .dblclick();
  const view = code(page, "main.cpp");
  await expect(view).toBeFocused();
  const editor = page.locator(".code-editor .cm-editor");
  await expect(editor.locator(".cm-git-gutter .cm-git-added")).toHaveCount(1);
  // Typing is followed; Git's text itself does not change.
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("// new line");
  await expect
    .poll(() => editor.locator(".cm-git-gutter .cm-git-added").count())
    .toBeGreaterThan(1);
  // The gutter lies between the line numbers and the fold chevrons.
  const order = await page.evaluate(() =>
    [...document.querySelectorAll(".code-editor .cm-gutter")].map(
      (g) => g.className,
    ),
  );
  const numbers = order.findIndex((c) => c.includes("cm-lineNumbers"));
  expect(order[numbers + 1]).toContain("cm-git-gutter");

  // The minimap draws the code at the right, leaving the scroller room.
  const minimap = editor.locator(".cm-minimap");
  await expect(minimap.locator("canvas")).toBeVisible();
  const drawn = await minimap.locator("canvas").evaluate((c) => {
    const canvas = c as HTMLCanvasElement;
    const data = canvas
      .getContext("2d")!
      .getImageData(0, 0, canvas.width, Math.min(canvas.height, 90)).data;
    return data.some((v) => v !== 0);
  });
  expect(drawn).toBe(true);
  const mapBox = (await minimap.boundingBox())!;
  const scroller = (await editor.locator(".cm-scroller").boundingBox())!;
  expect(scroller.x + scroller.width).toBeLessThanOrEqual(mapBox.x + 1);
  // The scrollbar lies right of the minimap, at the editor's edge.
  const barBox = (await editor.locator(".cm-code-scrollbar").boundingBox())!;
  const editorBox = (await editor.boundingBox())!;
  expect(barBox.x).toBeGreaterThanOrEqual(mapBox.x + mapBox.width - 1);
  expect(barBox.x + barBox.width).toBeCloseTo(editorBox.x + editorBox.width, 0);
  await page.screenshot({ path: "test-results/ide-minimap.png" });

  // Off in Settings, it leaves.
  await page.keyboard.press("Control+Shift+Comma");
  await page.getByRole("tab", { name: "IDE" }).click();
  await page.getByRole("checkbox", { name: "Minimap" }).uncheck();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await closeSettings(page);
  await expect(editor.locator(".cm-minimap")).toHaveCount(0);
});

test("the minimap marks the lines with errors, not those with warnings", async ({
  page,
}) => {
  await start(page, { server: true });
  await openProject(page);
  await openFile(page, "src", "main.cpp");
  await expect(page.locator(".code-status")).toHaveText("clangd");
  const view = code(page, "main.cpp");
  await view.click();
  const canvas = page.locator(".code-editor .cm-minimap canvas");
  // The rows of the canvas with the errors' solid mark at its right edge.
  const marked = () =>
    canvas.evaluate((c) => {
      const element = c as HTMLCanvasElement;
      const { data } = element
        .getContext("2d")!
        .getImageData(element.width - 1, 0, 1, element.height);
      let rows = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] === 255) rows++;
      return rows / devicePixelRatio;
    });
  await expect.poll(marked).toBe(0);
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nint x = bogus;");
  await expect(page.locator(".ide-status-problems")).toContainText("⊗ 1");
  await expect.poll(marked).toBe(3);
  await page.screenshot({ path: "test-results/ide-minimap-error.png" });
  await page.keyboard.press("Shift+Home");
  await page.keyboard.type("// many warnings");
  await expect(page.locator(".ide-status-problems")).toContainText("⚠ 500");
  await expect.poll(marked).toBe(0);
});

test("a long Problems list renders the rows in view and scrolls through all of them", async ({
  page,
}) => {
  await start(page, { server: true });
  await openProject(page);
  await openFile(page, "src", "main.cpp");
  await expect(page.locator(".code-status")).toHaveText("clangd");
  await code(page, "main.cpp").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n// many warnings");
  await expect(page.locator(".ide-status-problems")).toContainText("⚠ 500");
  await page.locator(".ide-status-problems").click();
  const list = page.getByRole("list", { name: "Problems" });
  const rows = list.locator(".problem");
  await expect(rows.first()).toContainText("warning number 0");
  expect(await rows.count()).toBeLessThan(100);
  await page.screenshot({ path: "test-results/ide-problems-long.png" });
  await page
    .locator(".problems")
    .evaluate((scroller) => (scroller.scrollTop = scroller.scrollHeight));
  await expect(list.getByText("warning number 499")).toBeVisible();
  // The filter looks through every problem; scrolled far down, the shorter list still shows.
  await page
    .getByRole("searchbox", { name: "Filter problems" })
    .fill("number 7");
  await expect(list.getByText("warning number 497")).toBeVisible();
  await expect(page.locator(".problems-filter")).toContainText("95 of 500");
});

test("a click on the minimap scrolls the code", async ({ page }) => {
  await start(page);
  await page.evaluate(() =>
    (window as any).__ide.disk.set("/proj/long.cpp", {
      text: Array.from({ length: 2000 }, (_, i) => `// line ${i + 1}`).join(
        "\n",
      ),
      revision: "l1",
    }),
  );
  await openProject(page);
  await tree(page)
    .getByRole("treeitem", { name: /^long.cpp/ })
    .dblclick();
  const editor = page.locator(".code-editor .cm-editor");
  const minimap = editor.locator(".cm-minimap");
  await expect(minimap.locator("canvas")).toBeVisible();
  const before = await editor
    .locator(".cm-scroller")
    .evaluate((s) => s.scrollTop);
  const box = (await minimap.boundingBox())!;
  await page.mouse.click(box.x + 20, box.y + box.height - 20);
  await expect
    .poll(() => editor.locator(".cm-scroller").evaluate((s) => s.scrollTop))
    .toBeGreaterThan(before + 200);
});

test("the code's scrollbar lies right of the minimap and scrolls by drag, track and wheel", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    const fake = (window as any).__ide;
    const lines = Array.from({ length: 2000 }, (_, i) =>
      i % 7 === 0
        ? `int value_${i} = compute(${i}); // ${"a long comment ".repeat(20)}`
        : `    // line ${i + 1}`,
    );
    fake.disk.set("/proj/long.cpp", {
      text: lines.join("\n"),
      revision: "l1",
    });
    // Git's staged text lacks twenty lines and differs in ten more.
    fake.head.set(
      "/proj/long.cpp",
      [
        ...lines.slice(0, 20),
        ...lines.slice(40, 60),
        ...lines.slice(60, 70).map((line) => `${line} old`),
        ...lines.slice(70),
      ].join("\n"),
    );
  });
  await openProject(page);
  await tree(page)
    .getByRole("treeitem", { name: /^long.cpp/ })
    .dblclick();
  const editor = page.locator(".code-editor .cm-editor");
  await expect(editor.locator(".cm-git-gutter .cm-git-added")).not.toHaveCount(
    0,
  );
  const scroller = editor.locator(".cm-scroller");
  const top = () => scroller.evaluate((s) => s.scrollTop);
  const thumb = editor.locator(".cm-code-scrollbar-thumb");
  await expect(thumb).toBeVisible();
  // The native vertical scrollbar takes no room beside the code; the horizontal one stays.
  const room = await scroller.evaluate((s) => {
    const element = s as HTMLElement;
    return {
      beside: element.offsetWidth - element.clientWidth,
      under: element.offsetHeight - element.clientHeight,
      wide: element.scrollWidth - element.clientWidth,
    };
  });
  expect(room.beside).toBe(0);
  expect(room.wide).toBeGreaterThan(0);
  expect(room.under).toBe(10);
  await page.screenshot({ path: "test-results/ide-scrollbar.png" });

  // A drag of the thumb scrolls, and the thumb follows the code.
  const box = (await thumb.boundingBox())!;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, box.y + box.height / 2 + 100, { steps: 4 });
  await page.mouse.up();
  await expect.poll(top).toBeGreaterThan(500);
  await expect
    .poll(async () => Math.round((await thumb.boundingBox())!.y))
    .toBe(Math.round(box.y + 100));

  // A press on the track brings the thumb there.
  const bar = (await editor.locator(".cm-code-scrollbar").boundingBox())!;
  const dragged = await top();
  await page.mouse.click(x, bar.y + bar.height - 5);
  await expect.poll(top).toBeGreaterThan(dragged + 500);

  // The wheel over the scrollbar scrolls too.
  const pressed = await top();
  await page.mouse.move(x, bar.y + 40);
  await page.mouse.wheel(0, -300);
  await expect.poll(top).toBeLessThan(pressed);
});

test("Markdown files preview beside or instead of their source, from the bar or the shortcut", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() =>
    (window as any).__ide.disk.set("/proj/notes.md", {
      text: "# Title\n\nSome *text*.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n[link](https://example.com)\n",
      revision: "m1",
    }),
  );
  await openProject(page);
  await tree(page)
    .getByRole("treeitem", { name: /^notes.md/ })
    .dblclick();
  const source = code(page, "notes.md");
  await expect(source).toBeFocused();
  const preview = page.getByLabel("Markdown preview", { exact: true }).last();
  const modes = page.getByRole("group", { name: "Markdown preview" });
  await modes.getByRole("button", { name: "Split" }).click();
  await expect(page.locator(".md-preview h1")).toHaveText("Title");
  await expect(page.locator(".md-preview td").first()).toHaveText("1");
  // Links stay text: the preview never navigates or loads anything.
  await expect(page.locator(".md-preview a")).toHaveCount(0);
  await expect(page.locator(".md-preview .md-link")).toHaveText("link");
  await expect(source).toBeVisible();
  await page.screenshot({ path: "test-results/ide-markdown.png" });
  // It follows the unsaved text.
  await source.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.type("## Added\n");
  await expect(page.locator(".md-preview h2")).toHaveText("Added");
  // The shortcut steps on: preview alone, then the source again.
  await page.keyboard.press("Control+Shift+v");
  await expect(modes.getByRole("button", { name: "Preview" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(source).toBeHidden();
  await modes.getByRole("button", { name: "Source" }).click();
  await expect(page.locator(".md-preview")).toHaveCount(0);
  await expect(source).toBeVisible();
  expect(await preview.count()).toBe(1);
  // Other files have no preview.
  await tree(page).getByRole("treeitem", { name: /^src/ }).click();
  await tree(page)
    .getByRole("treeitem", { name: /^main.cpp/ })
    .dblclick();
  await expect(
    page.getByRole("group", { name: "Markdown preview" }),
  ).toHaveCount(0);
});

test("a Markdown preview shows a README's local pictures and opens the files it links to", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(async () => {
    const loaded = (path: string) =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((url) => new URL(url).pathname === path) ?? path;
    const { drawingsBackend } = await import(
      loaded("/src/services/drawings.ts")
    );
    (window as any).__pictures = [];
    drawingsBackend.readImage = async (path: string) => {
      (window as any).__pictures.push(path);
      return new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>',
      ).buffer;
    };
    const disk = (window as any).__ide.disk;
    disk.set("/proj/guide.md", {
      text: [
        '<p align="center">',
        '  <img src="./logo.svg" alt="Logo" width="100" onerror="window.__hacked = 1">',
        "  <br><sub>The <b>logo</b></sub>",
        "</p>",
        "",
        "See [the rules](src/../AGENTS.md), [the end](#the-end) or [the web](https://example.com).",
        "",
        "![Remote](https://example.com/x.png) <script>window.__hacked = 1</script>",
        "",
        ...Array.from({ length: 80 }, (_, i) => `Line ${i}\n`),
        "## The end",
        "",
      ].join("\n"),
      revision: "g1",
    });
    disk.set("/proj/AGENTS.md", { text: "# Rules\n", revision: "a1" });
  });
  await openProject(page);
  await tree(page)
    .getByRole("treeitem", { name: /^guide.md/ })
    .dblclick();
  const modes = page.getByRole("group", { name: "Markdown preview" });
  await modes.getByRole("button", { name: "Preview" }).click();
  const preview = page.locator(".md-preview");

  // The README layout: a centered local picture, read as bytes, with its caption.
  const picture = preview.getByRole("img", { name: "Logo" });
  await expect(picture).toBeVisible();
  await expect(picture).toHaveAttribute("src", /^blob:/);
  expect(await picture.evaluate((img) => img.style.width)).toBe("100px");
  expect(
    await preview
      .locator("p")
      .first()
      .evaluate((p) => p.style.textAlign),
  ).toBe("center");
  await expect(preview.locator("sub strong")).toHaveText("logo");
  // Only the local file is read (twice under React's development checks).
  expect(
    new Set(await page.evaluate(() => (window as any).__pictures)),
  ).toEqual(new Set(["/proj/logo.svg"]));
  // Web pictures are not loaded, scripts never run, and nothing is an `<a>`.
  await expect(preview.locator(".md-image")).toHaveText("[Remote]");
  await expect(preview.locator("a, script")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__hacked)).toBeUndefined();

  // A heading link scrolls the preview; a file link opens the file as code.
  const end = preview.getByRole("heading", { name: "The end" });
  await expect(end).not.toBeInViewport();
  await preview.getByRole("link", { name: "the end" }).click();
  await expect(end).toBeInViewport();
  await preview.getByRole("link", { name: "the web" }).click();
  await preview.getByRole("link", { name: "the rules" }).click();
  await expect(code(page, "AGENTS.md")).toBeVisible();
});

test("the C++ highlight theme colors C++ apart from the color theme and follows its lightness", async ({
  page,
}) => {
  await start(page);
  await openProject(page);
  const variable = () =>
    page.evaluate(() =>
      document.documentElement.style.getPropertyValue("--cpp-function"),
    );
  expect(await variable()).toBe("");
  await page.keyboard.press("Control+Shift+Comma");
  await page.getByRole("tab", { name: "IDE" }).click();
  await page
    .getByRole("combobox", { name: "C++ highlight theme" })
    .selectOption("vscode");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await closeSettings(page);
  expect(await variable()).toBe("#dcdcaa");
  // A light color theme takes the same theme's light colors.
  await page.keyboard.press("Control+Shift+Comma");
  await page.getByRole("tab", { name: "General" }).click();
  await page
    .getByRole("combobox", { name: "Theme" })
    .selectOption("mozaik-light");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await closeSettings(page);
  expect(await variable()).toBe("#795e26");
  await tree(page).getByRole("treeitem", { name: /^src/ }).click();
  await tree(page)
    .getByRole("treeitem", { name: /^main.cpp/ })
    .dblclick();
  const keyword = code(page, "main.cpp").locator("span", {
    hasText: /^int$/,
  });
  await expect(keyword.first()).toHaveCSS("color", "rgb(0, 0, 255)");
});

test("a window with another module refuses the IDE", async ({ page }) => {
  await start(page);
  await page.keyboard.press("Control+Shift+Quote");
  await page.getByRole("combobox", { name: "Search tools" }).fill("file man");
  await page.keyboard.press("Enter");
  await expect(
    page.locator('.panel[data-plugin="file-manager"]'),
  ).toBeVisible();
  await page.keyboard.press("Control+Shift+Quote");
  await page.getByRole("combobox", { name: "Search tools" }).fill("ide");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("alert").filter({ hasText: "takes a window of its own" }),
  ).toBeVisible();
  await expect(page.locator('.panel[data-plugin="ide"]')).toHaveCount(0);
});

test("with an IDE open other modules only float and new files are code tabs", async ({
  page,
}) => {
  await start(page);
  await openProject(page);
  await page.keyboard.press("Control+Shift+p");
  await page
    .getByRole("combobox", { name: "Type a command" })
    .fill(">Add to Workspace: Text Editor");
  await page.keyboard.press("Enter");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "opens only as a floating panel" }),
  ).toBeVisible();
  await expect(page.locator('.panel[data-plugin="text-editor"]')).toHaveCount(
    0,
  );
  // Ctrl+Shift+Enter floats it beside the IDE; it cannot dock there.
  await page.keyboard.press("Control+Shift+Quote");
  await page.getByRole("combobox", { name: "Search tools" }).fill("text");
  await page.keyboard.press("Control+Shift+Enter");
  const guest = page.locator('.panel.floating[data-plugin="text-editor"]');
  await expect(guest).toBeVisible();
  await expect(guest.getByRole("button", { name: "Dock panel" })).toHaveCount(
    0,
  );
  // Ctrl+N is a new code file, in the code area, wherever the focus is.
  await page.keyboard.press("Control+n");
  await expect(
    page.getByRole("textbox", { name: /^Code Untitled/ }),
  ).toBeVisible();
  await expect(page.locator('.panel[data-plugin="text-editor"]')).toHaveCount(
    1,
  );
});

test("the Explorer opens every file as a tab: an image to look at, other binaries as a note", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(async () => {
    const loaded = (path: string) =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((url) => new URL(url).pathname === path) ?? path;
    const { drawingsBackend } = await import(
      loaded("/src/services/drawings.ts")
    );
    // A red 2×1 SVG, as the bytes Rust would answer with.
    drawingsBackend.readImage = async () =>
      new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>',
      ).buffer;
    const fs = (await import(loaded("/src/services/filesystem.ts"))).fileSystem;
    (window as any).__opened = [];
    fs.open = async (path: string) => (window as any).__opened.push(path);
    const disk = (window as any).__ide.disk;
    disk.set("/proj/logo.svg", { text: "", revision: "r" });
    disk.set("/proj/manual.pdf", { text: "", revision: "r" });
  });
  await openProject(page);
  await openFile(page, "src", "main.cpp");

  await tree(page)
    .getByRole("treeitem", { name: /^logo.svg/ })
    .click();
  await expect(page.getByRole("tab", { name: "logo.svg" })).toBeVisible();
  const image = page.locator(".file-tab-image");
  await expect(image).toBeVisible();
  await expect(page.locator(".file-tab .code-status")).toContainText(
    "200 × 100",
  );
  // It joined the code panel, beside the code tab.
  await expect(page.getByRole("tab", { name: "main.cpp" })).toBeVisible();
  // It zooms like a diagram.
  const before = (await image.boundingBox())!;
  await image.hover();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");
  await expect
    .poll(async () => (await image.boundingBox())!.width)
    .toBeGreaterThan(before.width);

  await tree(page)
    .getByRole("treeitem", { name: /^manual.pdf/ })
    .click();
  await expect(page.getByRole("tab", { name: "manual.pdf" })).toBeVisible();
  await page
    .getByRole("button", { name: "Open in Default Application" })
    .click();
  expect(await page.evaluate(() => (window as any).__opened)).toEqual([
    "/proj/manual.pdf",
  ]);
  // One tab per file.
  await tree(page)
    .getByRole("treeitem", { name: /^logo.svg/ })
    .click();
  await expect(page.getByRole("tab", { name: "logo.svg" })).toHaveCount(1);
});

test("splitting a code file shows it twice as editor groups, as in VS Code", async ({
  page,
}) => {
  await start(page);
  await openProject(page);
  await openFile(page, "src", "main.cpp");
  const views = page.getByRole("textbox", { name: "Code main.cpp" });
  await page.getByRole("tab", { name: "main.cpp" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Split Right" }).click();
  await expect(views).toHaveCount(2);
  const left = (await views.nth(0).boundingBox())!,
    right = (await views.nth(1).boundingBox())!;
  expect(left.x).toBeLessThan(right.x);
  // The groups are one code area over the bottom panel, divided by a line.
  await expect(page.locator(".split.group")).toHaveCount(1);
  const bottom = (await page.locator(".ide-panel").boundingBox())!;
  expect(bottom.y).toBeGreaterThan(left.y);
  expect(bottom.x + bottom.width).toBeGreaterThan(right.x);

  // Typing in one shows in the other, and both tabs read unsaved.
  await views.nth(1).click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.type("// both\n");
  await expect(views.nth(0)).toContainText("// both");
  await expect(page.getByRole("tab", { name: "main.cpp •" })).toHaveCount(2);

  // A third group, down; Ctrl+1 goes back to the first.
  await page.keyboard.press("Control+Shift+p");
  await page
    .getByRole("combobox", { name: "Type a command" })
    .fill(">View: Split Editor Down");
  await page.keyboard.press("Enter");
  await expect(views).toHaveCount(3);
  await page.screenshot({ path: "test-results/ide-groups.png" });
  await page.keyboard.press("Control+1");
  await expect(views.nth(0)).toBeFocused();

  // Closing the file's own tab keeps it open in the other views and asks nothing.
  await page
    .getByRole("tab", { name: "main.cpp •" })
    .first()
    .click({ button: "middle" });
  await expect(views).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Discard" })).toHaveCount(0);
  await expect(views.nth(0)).toContainText("// both");
  await page
    .getByRole("tab", { name: "main.cpp •" })
    .first()
    .click({ button: "middle" });
  await expect(views).toHaveCount(1);

  // The last view asks; then the code area is empty again.
  await page
    .getByRole("tab", { name: "main.cpp •" })
    .click({ button: "middle" });
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(views).toHaveCount(0);
  await expect(page.locator(".code-empty")).toHaveCount(1);
});

test("a tab dropped at a code panel's edge makes an editor group; the last tab of a group closes it", async ({
  page,
}) => {
  await start(page);
  await openProject(page);
  await openFile(page, "src", "main.cpp");
  await tree(page)
    .getByRole("treeitem", { name: /^util.cpp/ })
    .click();
  await expect(code(page, "util.cpp")).toBeVisible();
  const drag = async (name: string, x: number, y: number) => {
    const tab = (await page.getByRole("tab", { name }).boundingBox())!;
    await page.mouse.move(tab.x + 10, tab.y + 10);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 8 });
    await page.mouse.up();
  };
  const area = (await code(page, "util.cpp").boundingBox())!;
  await drag("util.cpp", area.x + area.width - 10, area.y + area.height / 2);
  await expect(code(page, "main.cpp")).toBeVisible();
  await expect(code(page, "util.cpp")).toBeVisible();
  await expect(page.locator(".split.group")).toHaveCount(1);
  // Moved back with the command, the emptied group goes.
  await code(page, "util.cpp").click();
  await page.keyboard.press("Control+Alt+ArrowLeft");
  await expect(page.locator(".split.group")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "util.cpp" })).toBeVisible();
  // Nothing splits a docked tool.
  const count = await page.locator(".panel").count();
  const side = (await page.locator(".project").boundingBox())!;
  await drag("util.cpp", side.x + 4, side.y + side.height / 2);
  await expect(page.locator(".panel")).toHaveCount(count);
});

test("Claude Code and Codex open one panel of sessions that minimizes out of the layout", async ({
  page,
}) => {
  await start(page);
  await openProject(page);
  await openFile(page, "src", "main.cpp");
  const agent = page.locator('.panel[data-plugin="ide-agent"]');
  const claude = page.getByRole("button", { name: "Open Claude Code" });
  const codex = page.getByRole("button", { name: "Open Codex" });
  const sessions = agent.getByRole("tab");
  await expect(agent).toHaveCount(0);
  await expect(claude.locator(".agent-count")).toHaveCount(0);

  // The first press opens the panel beside the code, above the bottom panel.
  await claude.click();
  await expect(agent).toHaveCount(1);
  await expect(sessions).toHaveText(["Session 1"]);
  const area = (await code(page, "main.cpp").boundingBox())!;
  const box = (await agent.boundingBox())!;
  expect(box.x).toBeGreaterThan(area.x);
  const bottom = (await page.locator(".ide-panel").boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(bottom.y);
  // The session runs the agent in the project's folder.
  const running = () =>
    page.evaluate(async () => {
      const loaded = (path: string) =>
        performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((url) => new URL(url).pathname === path) ?? path;
      const { agentPanelOf } = await import(
        loaded("/src/plugins/ide/agents.ts")
      );
      const { hasSession, getSession } = await import(
        loaded("/src/plugins/terminal/sessions.ts")
      );
      const { allProjects } = await import(
        loaded("/src/plugins/ide/projects.ts")
      );
      const panel = agentPanelOf(allProjects()[0].id);
      return (panel?.sessions ?? []).map((s: { id: string }) =>
        hasSession(s.id)
          ? {
              id: s.id,
              agent: getSession(s.id).agent,
              directory: getSession(s.id).directory,
            }
          : null,
      );
    });
  const first = (await running())[0];
  expect(first).toMatchObject({ agent: "claude", directory: "/proj" });

  // The icons moved onto the panel, with the count at their lower right.
  await expect(claude).toHaveCount(0);
  await expect(codex).toHaveCount(0);
  const newClaude = agent.getByRole("button", {
    name: "New Claude Code Session",
  });
  await expect(newClaude.locator(".agent-count")).toHaveText("1");

  // Another press on the agent shown adds a session as a tab.
  await newClaude.click();
  await expect(sessions).toHaveText(["Session 1", "Session 2"]);
  await expect(sessions.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(newClaude.locator(".agent-count")).toHaveText("2");
  await page.screenshot({ path: "test-results/ide-agents.png" });

  // The other icon shows that agent, starting its first session, and then its tabs.
  await agent.getByRole("button", { name: "Show Codex" }).click();
  await expect(sessions).toHaveText(["Session 1"]);
  await agent.getByRole("button", { name: "Show Claude Code" }).click();
  await expect(sessions).toHaveText(["Session 1", "Session 2"]);
  await expect(sessions.nth(1)).toHaveAttribute("aria-selected", "true");
  await sessions.nth(0).click();
  await expect(sessions.nth(0)).toHaveAttribute("aria-selected", "true");

  // Minimized, nothing of the panel is left, the width of the code returns, the icons return
  // with their counts, and the sessions go on.
  const shared = (await agent.boundingBox())!.width;
  await agent.getByRole("button", { name: "Minimize agents" }).click();
  await expect(agent).toHaveCount(0);
  await expect(claude.locator(".agent-count")).toHaveText("2");
  await expect(codex.locator(".agent-count")).toHaveText("1");
  expect((await code(page, "main.cpp").boundingBox())!.width).toBeGreaterThan(
    area.width,
  );
  const before = await running();
  expect(before).toHaveLength(3);
  expect(before.every(Boolean)).toBe(true);

  // The same panel returns, as wide as it was, on the same sessions.
  await claude.click();
  await expect(agent).toHaveCount(1);
  await expect(sessions).toHaveText(["Session 1", "Session 2"]);
  await expect(sessions.nth(0)).toHaveAttribute("aria-selected", "true");
  expect(await running()).toEqual(before);
  expect(
    Math.abs((await agent.boundingBox())!.width - shared),
  ).toBeLessThanOrEqual(2);

  // A session's tab takes a name from its menu, as a terminal's tab, and keeps it when minimized.
  await sessions.nth(1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const naming = agent.getByRole("textbox", { name: "Session name" });
  await expect(naming).toBeFocused();
  await naming.fill("Refactor");
  await page.keyboard.press("Enter");
  await expect(sessions).toHaveText(["Session 1", "Refactor"]);
  await agent.getByRole("button", { name: "Minimize agents" }).click();
  await claude.click();
  await expect(sessions).toHaveText(["Session 1", "Refactor"]);
  await sessions.nth(1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await naming.fill("Dropped");
  await page.keyboard.press("Escape");
  await expect(sessions).toHaveText(["Session 1", "Refactor"]);

  // The palette: a toggle minimizes the agent shown, and New adds a session.
  const command = async (name: string) => {
    await page.keyboard.press("Control+Shift+p");
    await page
      .getByRole("combobox", { name: "Type a command" })
      .fill(`>${name}`);
    await page.keyboard.press("Enter");
  };
  await command("IDE: Toggle Claude Code");
  await expect(agent).toHaveCount(0);
  await command("IDE: New Codex Session");
  await expect(sessions).toHaveText(["Session 1", "Session 2"]);

  // Close Panel only minimizes it; nothing ends.
  await agent.getByRole("tab", { name: "Session 2" }).click();
  await page.keyboard.press("Control+Shift+c");
  await expect(agent).toHaveCount(0);
  expect(await running()).toHaveLength(4);

  // A session's own close ends it; the agent's last hands the panel to the other agent, and the
  // last one of all minimizes it.
  await codex.click();
  await agent.getByRole("button", { name: "Close Codex 2" }).click();
  await agent.getByRole("button", { name: "Close Codex 1" }).click();
  await expect(sessions).toHaveText(["Session 1", "Refactor"]);
  await agent.getByRole("button", { name: "Close Refactor" }).click();
  await agent.getByRole("button", { name: "Close Claude Code 1" }).click();
  await expect(agent).toHaveCount(0);
  await expect(claude.locator(".agent-count")).toHaveCount(0);
  expect(await running()).toEqual([]);

  // Closing the IDE ends the sessions of a minimized panel too.
  await claude.click();
  await page.getByRole("button", { name: "Minimize agents" }).click();
  const left = (await running())[0].id as string;
  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Close IDE" }).click();
  await expect(page.locator(".project")).toHaveCount(0);
  const stays = await page.evaluate(async (id) => {
    const url =
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find(
          (u) => new URL(u).pathname === "/src/plugins/terminal/sessions.ts",
        ) ?? "/src/plugins/terminal/sessions.ts";
    return (await import(url)).hasSession(id);
  }, left);
  expect(stays).toBe(false);
});

test("Ctrl+Shift+C in a split code file closes the whole IDE", async ({
  page,
}) => {
  await start(page);
  await openProject(page);
  await openFile(page, "src", "main.cpp");
  const views = page.getByRole("textbox", { name: "Code main.cpp" });
  await page.getByRole("tab", { name: "main.cpp" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Split Right" }).click();
  await expect(views).toHaveCount(2);
  await views.nth(1).click();
  await page.keyboard.press("Control+Shift+C");
  await page
    .getByRole("dialog", { name: "Close IDE" })
    .getByRole("button", { name: "Close IDE" })
    .click();
  await expect(page.locator("[data-panel]")).toHaveCount(0);
});
