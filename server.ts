import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import Database from "better-sqlite3";

const PORT = 8081;
const DB_PATH = process.env.MF_DB || "/workspace/mf.db";
const AUTH_KEY = process.env.MF_AIB_KEY || "set-a-long-random-secret";

const app = express();
app.use(cors());
app.use(bodyParser.json());

function auth(req:any, res:any, next:any) {
  if (req.headers["x-mfaib-key"] !== AUTH_KEY)
    return res.status(401).json({ error: "Unauthorized" });
  next();
}

const db = new Database(DB_PATH);

// --- Migration guard ---
const cols:any[] = db.prepare("PRAGMA table_info(tasks)").all();
if (cols.length === 0) {
  db.exec(`CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT,
    kind TEXT NOT NULL DEFAULT 'legacy',
    status TEXT,
    input_json TEXT,
    result_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);
} else {
  const names = new Set(cols.map((c:any) => c.name));
  if (!names.has("kind")) db.exec("ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'legacy';");
  if (!names.has("result_json")) db.exec("ALTER TABLE tasks ADD COLUMN result_json TEXT;");
}

// --- Routes ---

app.get("/healthz", (_req,res)=>res.json({ok:true}));

// list tasks
app.get("/tasks", auth, (_req,res)=>{
  const rows = db.prepare("select id,title,kind,status,created_at from tasks order by created_at desc").all();
  res.json(rows);
});

// get task by id
app.get("/tasks/:id", auth, (req,res)=>{
  const row = db.prepare("select * from tasks where id=?").get(req.params.id);
  if (!row) return res.status(404).json({error:"not found"});
  res.json(row);
});

// write file
app.post("/tasks", auth, (req,res)=>{
  const { title, kind, input } = req.body || {};
  const id = crypto.rand
