import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();
app.get("/", c => c.text("mf-api alive"));
app.get("/healthz", c => c.json({ ok: true }));

serve({ fetch: app.fetch, port: 8787 });
console.log("mf-api listening on :8787");
