#!/usr/bin/env python3
import os, json, base64, time, textwrap, subprocess, requests, math
from pathlib import Path
from typing import List, Dict
from openai import OpenAI

# -------------------- Config --------------------

MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

# Google Docs to ingest (comma or space separated)
DOC_IDS = os.getenv("DOC_IDS", "").replace(",", " ").split()

# Where code may be written (comma-separated prefixes)
ALLOWLIST = [p.strip() for p in os.getenv("ALLOWLIST", "").split(",") if p.strip()]  # e.g. "mf-runner/,apps/,packages/,scripts/"

# Git/PR settings (used only in CI)
BASE_BRANCH = os.getenv("BASE_BRANCH", "main")
BRANCH_NAME = os.getenv("BRANCH_NAME", "bot/doc-sync")

# Summarization knobs (safe defaults)
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "10000"))            # characters per chunk (map)
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "500"))        # overlapping chars between chunks
MAX_DOC_CHUNKS = int(os.getenv("MAX_DOC_CHUNKS", "200"))      # hard cap per doc to avoid runaways
MAX_DIGEST_CHARS = int(os.getenv("MAX_DIGEST_CHARS", "120000"))  # cap combined digests fed to planner

# -------------------- SA / Drive helpers --------------------

def _load_sa_from_env() -> Dict:
    """
    Load service-account JSON from GDRIVE_SA_JSON_B64.
    Accepts base64 or raw JSON; auto-fixes missing base64 padding.
    """
    raw = os.environ["GDRIVE_SA_JSON_B64"].strip()
    if raw.startswith("{"):
        return json.loads(raw)
    b64 = "".join(raw.split())
    rem = len(b64) % 4
    if rem:
        b64 += "=" * (4 - rem)
    return json.loads(base64.b64decode(b64))

def gsa_access_token() -> str:
    sa = _load_sa_from_env()
    now = int(time.time())
    payload = {
        "iss": sa["client_email"],
        "scope": "https://www.googleapis.com/auth/drive.readonly",
        "aud": sa["token_uri"],
        "exp": now + 3600,
        "iat": now,
    }
    import jwt  # requires PyJWT and cryptography installed
    assertion = jwt.encode(payload, sa["private_key"], algorithm="RS256")
    r = requests.post(sa["token_uri"], data={
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": assertion,
    })
    r.raise_for_status()
    return r.json()["access_token"]

def fetch_doc_text(doc_id: str, access_token: str) -> str:
    url = f"https://www.googleapis.com/drive/v3/files/{doc_id}/export?mimeType=text/plain"
    r = requests.get(url, headers={"Authorization": f"Bearer {access_token}"})
    r.raise_for_status()
    return r.text

# -------------------- OpenAI helpers --------------------

def _client() -> OpenAI:
    key = os.environ["OPENAI_API_KEY"].strip()
    return OpenAI(api_key=key)

def call_openai_text(model: str, system: str, user: str, temperature: float = 0.2) -> str:
    """
    Minimal wrapper around Responses API that returns output_text,
    falling back to stitching if needed.
    """
    client = _client()
    resp = client.responses.create(
        model=model,
        input=[
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
        temperature=temperature,
    )
    if getattr(resp, "output_text", None):
        return resp.output_text
    # Fallback: stitch parts
    out = []
    for msg in getattr(resp, "output", []):
        for c in getattr(msg, "content", []):
            if getattr(c, "type", None) == "output_text":
                out.append(c.text)
    return "".join(out)

# -------------------- Chunking & Summarization --------------------

def chunk_text(s: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    if size <= 0: return [s]
    if overlap < 0: overlap = 0
    chunks = []
    i = 0
    n = len(s)
    while i < n and len(chunks) < MAX_DOC_CHUNKS:
        end = min(n, i + size)
        chunks.append(s[i:end])
        if end == n: break
        i = end - overlap
        if i < 0: i = 0
    return chunks

CHUNK_SYS = textwrap.dedent("""
You are a precise technical summarizer. Summarize the following project text chunk for engineers.

Output a compact JSON object with keys:
{
  "highlights": [short bullets of key ideas],
  "requirements": [explicit functional requirements if any],
  "constraints": [hard constraints / compatibility / budgets / security],
  "entities": [APIs, services, modules, data models mentioned],
  "files": [{"path": "suggested/relative/path.ext", "purpose": "what goes here"}],
  "open_questions": [ambiguous or missing details worth clarifying]
}
Limit each list to the top 5–8 items. Stay terse.
Return JSON only.
""").strip()

REDUCE_SYS = textwrap.dedent("""
You are merging multiple chunk summaries of the same document into a concise single-document digest for engineers.

Given an array of chunk JSONs, produce a single JSON:
{
  "doc_id": "<id>",
  "title": "<best inferred title or short description>",
  "highlights": [...],
  "requirements": [...],
  "constraints": [...],
  "entities": [...],
  "files": [{"path": "...", "purpose": "..."}],
  "open_questions": [...]
}
Deduplicate closely similar items. Keep it compact and practical.
Return JSON only.
""").strip()

PLANNER_SYS = textwrap.dedent("""
You are the MuseField Code Builder. You will receive multiple document digests.

Produce a single JSON plan:
{
  "files": [{"path":"<relative path>","content":"<full file content>"}],
  "notes": "<short summary of what you generated and why>"
}

Rules:
- Confine outputs to the allowed path prefixes provided.
- Prefer small, composable modules and minimal diffs.
- If uncertain, scaffold with clear TODOs rather than guessing.
- Use modern, clean patterns suitable for a TypeScript/Node/React stack unless the digest clearly specifies otherwise.
- Return ONLY JSON (no commentary outside JSON).
""").strip()

def summarize_doc(doc_id: str, text: str) -> Dict:
    """
    Map-reduce summarization:
      - Map: per-chunk JSON summaries
      - Reduce: merge chunk JSONs into one doc digest
    """
    chunks = chunk_text(text)
    chunk_summaries = []

    # Map
    for idx, ch in enumerate(chunks, 1):
        user = f"Chunk {idx}/{len(chunks)} for document {doc_id}:\n\n{ch}"
        out = call_openai_text(MODEL, CHUNK_SYS, user, temperature=0.1).strip()
        try:
            chunk_summaries.append(json.loads(out))
        except Exception:
            # Be resilient: keep a fallback summary rather than fail hard
            chunk_summaries.append({
                "highlights": [out[:300]],
                "requirements": [], "constraints": [],
                "entities": [], "files": [], "open_questions": []
            })

    # Reduce
    reduce_user = "Merge the following array of chunk JSONs into one digest:\n\n" + json.dumps(chunk_summaries, ensure_ascii=False)
    digest_raw = call_openai_text(MODEL, REDUCE_SYS, reduce_user, temperature=0.1).strip()
    try:
        digest = json.loads(digest_raw)
    except Exception:
        digest = {
            "doc_id": doc_id,
            "title": f"Doc {doc_id}",
            "highlights": [digest_raw[:500]],
            "requirements": [], "constraints": [],
            "entities": [], "files": [], "open_questions": []
        }

    # Attach id for traceability
    digest.setdefault("doc_id", doc_id)
    return digest

# -------------------- Allowlist & Git --------------------

def within_allowlist(path: str) -> bool:
    if not ALLOWLIST:
        return True
    return any(path.startswith(prefix) for prefix in ALLOWLIST)

def run_ci_git(changed_paths: List[str], pr_body: str):
    def run(*args): subprocess.check_call(list(args))
    try:
        run("git", "checkout", "-b", BRANCH_NAME)
    except subprocess.CalledProcessError:
        run("git", "checkout", BRANCH_NAME)
    run("git", "add", *changed_paths)
    run("git", "commit", "-m", "chore: doc→code sync (auto)")
    run("git", "push", "-u", "origin", BRANCH_NAME)
    subprocess.call([
        "gh","pr","create",
        "--title","Doc→Code Sync (auto)",
        "--body", pr_body or "Automated update from Google Docs",
        "--base", BASE_BRANCH, "--head", BRANCH_NAME
    ])

# -------------------- Main flow --------------------

def main():
    if not DOC_IDS:
        raise SystemExit("DOC_IDS env var is empty")

    # 1) Fetch docs
    at = gsa_access_token()
    docs = []
    for did in DOC_IDS:
        txt = fetch_doc_text(did, at)
        docs.append({"id": did, "text": txt})

    # 2) Per-doc summarization (map-reduce)
    digests = []
    for d in docs:
        digest = summarize_doc(d["id"], d["text"])
        digests.append(digest)

    # 3) Clamp combined digests to size limit (ultra-safe)
    digests_json = json.dumps(digests, ensure_ascii=False)
    if len(digests_json) > MAX_DIGEST_CHARS:
        # Keep the head, note truncation
        digests_json = digests_json[:MAX_DIGEST_CHARS] + "\n/* TRUNCATED DIGESTS DUE TO SIZE LIMIT */"

    allowed = ", ".join(ALLOWLIST) or "(no restriction)"
    planner_user = f"Allowed path prefixes: {allowed}\n\nAll document digests (JSON array):\n{digests_json}"

    # 4) Ask the model for the actual file plan
    plan_raw = call_openai_text(MODEL, PLANNER_SYS, planner_user, temperature=0.2).strip()

    try:
        plan = json.loads(plan_raw)
    except Exception:
        plan = {"files": [], "notes": plan_raw}

    # 5) Write files within allowlist
    changed = []
    for f in plan.get("files", []):
        path = (f.get("path") or "").lstrip("./")
        if not path or not within_allowlist(path):
            continue
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(f.get("content", ""), encoding="utf-8")
        changed.append(path)

    # 6) Commit/PR in CI or print locally
    if not changed:
        print("No files written (maybe all proposed paths were outside allowlist or plan was empty).")
        if plan.get("notes"):
            print("\nNotes:\n", plan["notes"])
        return

    if os.getenv("GITHUB_ACTIONS") == "true":
        run_ci_git(changed, plan.get("notes", ""))
    else:
        print("Wrote files:\n- " + "\n- ".join(changed))
        if plan.get("notes"):
            print("\nNotes:\n", plan["notes"])

if __name__ == "__main__":
    main()
