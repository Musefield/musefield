import React, { useCallback, useEffect, useMemo, useState } from "react";

const API = (import.meta.env.VITE_MF_API_BASE as string) || "/api";
const KEY = (import.meta.env.VITE_MF_API_KEY as string) || "";

type TaskRow = {
  id: string;
  title: string;
  kind: "legacy" | "run" | "write_file";
  status: string;
  created_at: string;
};

async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-mfaib-key": KEY,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${text}`);
  }
  return res.json();
}

export default function App() {
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [ping, setPing] = useState<string>("…");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPing = useCallback(async () => {
    try {
      const r = await fetch(`${API}/healthz`, { headers: { "x-mfaib-key": KEY } });
      setPing(r.ok ? "ok" : `err ${r.status}`);
    } catch (e: any) {
      setPing("down");
    }
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      const data = await api<{ tasks: TaskRow[] }>("/tasks");
      setRows(data.tasks || []);
      setError(null);
    } catch (e: any) {
      setError(e.message || String(e));
    }
  }, []);

  useEffect(() => {
    fetchPing();
    fetchTasks();
    const id = setInterval(() => {
      fetchPing();
      fetchTasks();
    }, 2000);
    return () => clearInterval(id);
  }, [fetchPing, fetchTasks]);

  const runSample = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await api("/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "whoami (admin)",
          kind: "run",
          input: { cmd: "whoami", args: [] },
        }),
      });
      await fetchTasks();
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [fetchTasks]);

  const prettyDate = useCallback((s: string) => {
    try {
      const d = new Date(s);
      return d.toLocaleString();
    } catch {
      return s;
    }
  }, []);

  const empty = rows.length === 0;

  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", padding: 16, maxWidth: 980, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>MF Admin — Tasks</h1>
        <div style={{
          display: "flex", gap: 8, alignItems: "center",
          fontSize: 14, opacity: 0.85
        }}>
          <span>API:</span>
          <code>{API}</code>
          <span style={{
            padding: "2px 8px",
            borderRadius: 999,
            border: "1px solid #ddd",
            background: ping === "ok" ? "#e6ffed" : "#ffeaea"
          }}>
            {ping}
          </span>
          <button
            onClick={() => { fetchPing(); fetchTasks(); }}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" }}
          >
            Refresh
          </button>
          <button
            onClick={runSample}
            disabled={loading}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" }}
          >
            {loading ? "Running…" : "Run sample task"}
          </button>
        </div>
      </header>

      {error && (
        <div style={{ marginBottom: 12, color: "#b00020" }}>
          {error}
        </div>
      )}

      {empty ? (
        <div style={{ opacity: 0.7, padding: "20px 8px" }}>
          No tasks yet. Use “Run sample task” above or call the API.
        </div>
      ) : (
        <div style={{ border: "1px solid #eee", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ background: "#fafafa" }}>
              <tr>
                <th style={th}>Created</th>
                <th style={th}>Title</th>
                <th style={th}>Kind</th>
                <th style={th}>Status</th>
                <th style={th}>ID</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ borderTop: "1px solid #f1f1f1" }}>
                  <td style={td}>{prettyDate(r.created_at)}</td>
                  <td style={td}>{r.title}</td>
                  <td style={td}><code>{r.kind}</code></td>
                  <td style={td}>{r.status}</td>
                  <td style={{ ...td, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}>
                    {r.id}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "10px 12px", fontWeight: 700, fontSize: 13, color: "#444" };
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 14, color: "#222" };
