import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import Database from "better-sqlite3";
import crypto from "crypto";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Config ---
const PORT = 8081;
const DB_PATH = process.env.MF_DB || "/workspace/mf.db";
const AUTH_KEY = process.env.MF_AIB_KEY || "set-a-long-random-secret";

// --- App ---
const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- Auth middleware ---
function auth(req: any, res: any, next: any) {
  if (req.headers["x-mfaib-key"] !== AUTH_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// --- DB setup ---
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Migration guard: ensure table + columns exist
const cols: any[] = db.prepare("PRAGMA table_info(tasks)").all();
if (cols.length === 0) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT,
      kind TEXT NOT NULL DEFAULT 'legacy',
      status TEXT,
      input_json TEXT,
      result_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
} else {
  const names = new Set(cols.map((c: any) => c.name));
  if (!names.has("kind")) db.exec("ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'legacy';");
  if (!names.has("result_json")) db.exec("ALTER TABLE tasks ADD COLUMN result_json TEXT;");
}

// --- Routes ---
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/api/healthz", (_req, res) => res.json({ ok: true, api: true }));

// list tasks
app.get("/tasks", auth, (_req, res) => {
  const rows = db
    .prepare("SELECT id,title,kind,status,created_at FROM tasks ORDER BY created_at DESC")
    .all();
  res.json(rows);
});

// get task by id
app.get("/tasks/:id", auth, (req, res) => {
  const row = db.prepare("SELECT * FROM tasks WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  res.json(row);
});

// create task (supports kind: run | write_file)
app.post("/tasks", auth, (req, res, next) => {
  try {
    const { title, kind, input } = req.body || {};
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO tasks (id,title,kind,status,input_json) VALUES (?,?,?,?,?)")
      .run(id, title, kind || "legacy", "done", JSON.stringify(input || {}));

    if (kind === "write_file" && input?.path && typeof input?.content === "string") {
      fs.mkdirSync(path.dirname(input.path), { recursive: true });
      fs.writeFileSync(input.path, input.content);
      db.prepare("UPDATE tasks SET result_json=? WHERE id=?")
        .run(JSON.stringify({ ok: true, wrote: input.path }), id);
    } else if (kind === "run" && input?.cmd) {
      const result = spawnSync(input.cmd, input.args || [], { encoding: "utf8" });
      db.prepare("UPDATE tasks SET result_json=? WHERE id=?").run(
        JSON.stringify({
          code: result.status,
          stdout: result.stdout,
          stderr: result.stderr,
        }),
        id
      );
    }

    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

// --- /v1/scaffold ---
// Writes a minimal React+Vite app to /workspace/app, with base "/ui/" so assets resolve under /ui/.
app.post("/v1/scaffold", auth, (_req, res, next) => {
  try {
    const root = "/workspace/app";
    fs.mkdirSync(root, { recursive: true });

    const write = (p: string, c: string) => {
      const f = path.join(root, p);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, c);
    };

    // package.json
    write(
      "package.json",
      `{
  "name": "musefield-ui",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview --port 5173"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "vite": "^5.4.8",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.6.2",
    "tailwindcss": "^3.4.14",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.47"
  }
}`
    );

    // vite.config.ts with base="/ui/"
    write(
      "vite.config.ts",
      `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "/ui/",
  plugins: [react()],
});`
    );

    // index.html
    write(
      "index.html",
      `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8"/>
    <title>MuseField UI</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/ui/assets/index.js"></script>
  </body>
</html>`
    );

    // src/main.tsx + App.tsx
    write(
      "src/main.tsx",
      `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
createRoot(document.getElementById("root")!).render(<App />);`
    );

    write(
      "src/App.tsx",
      `import React, { useEffect, useState } from "react";
export default function App() {
  const [tasks, setTasks] = useState<any[]>([]);
  useEffect(() => {
    fetch("/tasks", { headers: { "x-mfaib-key": "${AUTH_KEY}" } })
      .then(r => r.json()).then(setTasks).catch(() => {});
  }, []);
  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "24px", marginBottom: "12px" }}>MuseField Runner UI</h1>
      {tasks.length === 0 ? <p>No tasks yet.</p> : tasks.slice(0,10).map((t:any) => (
        <div key={t.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: "#666" }}>{t.id}</div>
          <div style={{ fontWeight: 600 }}>{t.title}</div>
          <div style={{ fontSize: 12 }}>{t.kind} • {t.status}</div>
        </div>
      ))}
    </div>
  );
}`
    );

    // Small shim so index.html's script path exists after build
    write(
      "src/index.ts",
      `import "./main"; // Vite will emit hashed assets; the /ui/ base makes them resolve under /ui/`
    );

    // Install & build
    const install = spawnSync("npm", ["install"], { cwd: root, stdio: "inherit" });
    if (install.status !== 0) throw new Error("npm install failed");
    const build = spawnSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
    if (build.status !== 0) throw new Error("npm run build failed");

    res.json({ ok: true, servedAt: "/ui", root });
  } catch (e: any) {
    next(e);
  }
});

// --- Static UI (Runner SPA) ---
// We’ll try to serve the built runner UI from mf-runner/admin/dist.
// You can override with APP_DIST if your mount path differs.
function findDist(): string {
  const candidates = [
    process.env.APP_DIST,                              // explicit override
    path.resolve(process.cwd(), "admin", "dist"),      // host-mounted repo (common)
    path.resolve(__dirname, "../admin/dist"),          // transpiled layout
    "/repo/mf-runner/admin/dist",                      // common container mount
    "/workspace/mf-runner/admin/dist"                  // alternative mount
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      if (fs.existsSync(path.join(p, "index.html"))) return p;
    } catch {}
  }
  console.warn("WARN: Runner SPA dist not found. Build it or set APP_DIST.");
  return "";
}

const RUNNER_DIST = findDist();

// --- Legacy scaffold UI at /ui (guarded so it only mounts if present) ---
const SCAFFOLD_ROOT = "/workspace/app/dist";
if (fs.existsSync(path.join(SCAFFOLD_ROOT, "index.html"))) {
  app.use("/ui", express.static(SCAFFOLD_ROOT, { index: "index.html" }));
  app.use("/assets", express.static(path.join(SCAFFOLD_ROOT, "assets")));
  app.get("/ui", (_req, res) => res.sendFile(path.join(SCAFFOLD_ROOT, "index.html")));
}

// Serve the Runner SPA at the root of this service
if (RUNNER_DIST) {
  app.use(express.static(RUNNER_DIST));
  // Catch-all for client routing, but do NOT swallow API or scaffold routes
  app.get(/^(?!\/api\/|\/v1\/scaffold|\/ui(\/|$)).*$/, (_req, res) => {
    res.sendFile(path.join(RUNNER_DIST, "index.html"));
  });
} else {
  // Helpful fallback if dist is missing
  app.get("/", (_req, res) =>
    res
      .status(500)
      .send("Runner SPA dist not found. Build it (mf-runner/admin) or set APP_DIST.")
  );
}

// --- Error handler ---
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("UNCAUGHT:", err?.stack || err);
  res.status(500).json({ error: String(err?.message || err) });
});

// --- Start server ---
app.listen(PORT, "0.0.0.0", () => console.log(`MF runner listening on ${PORT}`));
