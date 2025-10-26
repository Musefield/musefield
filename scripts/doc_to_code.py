#!/usr/bin/env python3
import os, json, base64, time, textwrap, subprocess, requests
from pathlib import Path
from openai import OpenAI

MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
DOC_IDS = os.getenv("DOC_IDS", "").replace(",", " ").split()
OUTPUT_DIR = os.getenv("OUTPUT_DIR", "mf-generated")  # reserved for future use
BASE_BRANCH = os.getenv("BASE_BRANCH", "main")
BRANCH_NAME = os.getenv("BRANCH_NAME", "bot/doc-sync")
ALLOWLIST = [p.strip() for p in os.getenv("ALLOWLIST", "").split(",") if p.strip()]  # e.g. "mf-runner/,apps/"

# ---------- Google Service Account helpers ----------

def _load_sa_from_env():
    """
    Load service-account JSON from env var GDRIVE_SA_JSON_B64.
    Accepts either:
      - base64-encoded JSON (preferred)
      - raw JSON (if someone pasted it directly)
    Also auto-fixes missing base64 padding.
    """
    raw = os.environ["GDRIVE_SA_JSON_B64"].strip()
    # If user pasted raw JSON instead of base64, accept it.
    if raw.startswith("{"):
        return json.loads(raw)

    # Base64 path: remove whitespace, fix padding, decode.
    b64 = "".join(raw.split())
    rem = len(b64) % 4
    if rem:
        b64 += "=" * (4 - rem)
    return json.loads(base64.b64decode(b64))

def gsa_access_token():
    sa = _load_sa_from_env()
    now = int(time.time())
    jwt_payload = {
        "iss": sa["client_email"],
        "scope": "https://www.googleapis.com/auth/drive.readonly",
        "aud": sa["token_uri"],
        "exp": now + 3600,
        "iat": now,
    }
    import jwt
    token = jwt.encode(jwt_payload, sa["private_key"], algorithm="RS256")
    r = requests.post(sa["token_uri"], data={
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": token
    })
    r.raise_for_status()
    return r.json()["access_token"]

def fetch_doc_text(doc_id, access_token):
    url = f"https://www.googleapis.com/drive/v3/files/{doc_id}/export?mimeType=text/plain"
    r = requests.get(url, headers={"Authorization": f"Bearer {access_token}"})
    r.raise_for_status()
    return r.text

# ---------- Git / filesystem helpers ----------

def within_allowlist(path: str) -> bool:
    if not ALLOWLIST:
        return True
    return any(path.startswith(prefix) for prefix in ALLOWLIST)

def run_ci_git(changed_paths, pr_body):
    def run(*args):
        subprocess.check_call(list(args))

    # Create or switch to working branch
    try:
        run("git", "checkout", "-b", BRANCH_NAME)
    except subprocess.CalledProcessError:
        run("git", "checkout", BRANCH_NAME)

    run("git", "add", *changed_paths)
    # Keep message simple and deterministic for CI
    run("git", "commit", "-m", "chore: doc→code sync (auto)")
    run("git", "push", "-u", "origin", BRANCH_NAME)

    # Attempt to open a PR (ignore failure if gh isn't installed)
    subprocess.call([
        "gh", "pr", "create",
        "--title", "Doc→Code Sync (auto)",
        "--body", pr_body or "Automated update from Google Docs",
        "--base", BASE_BRANCH,
        "--head", BRANCH_NAME
    ])

# ---------- OpenAI call ----------

def call_openai(model, system_prompt, user_prompt):
    # Be tolerant of accidental newline/space in the key
    api_key = os.environ["OPENAI_API_KEY"].strip()
    client = OpenAI(api_key=api_key)

    resp = client.responses.create(
        model=model,
        input=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt},
        ],
        temperature=0.2,
    )

    # Preferred property for the new SDK:
    if getattr(resp, "output_text", None):
        return resp.output_text

    # Fallback stitching if needed
    parts = []
    for msg in getattr(resp, "output", []):
        for c in getattr(msg, "content", []):
            if getattr(c, "type", None) == "output_text":
                parts.append(c.text)
    return "".join(parts)

# ---------- Main ----------

def main():
    if not DOC_IDS:
        raise SystemExit("DOC_IDS env var is empty")

    access_token = gsa_access_token()

    # Aggregate docs into one spec string
    chunks = []
    for i, did in enumerate(DOC_IDS, 1):
        txt = fetch_doc_text(did, access_token)
        chunks.append(f"\n\n===== DOC {i} ({did}) =====\n{txt}")
    spec = "".join(chunks)

    system = textwrap.dedent("""
        You are the MuseField Code Builder. Given a multi-document spec, produce a JSON plan:
        {
          "files": [{"path":"<relative path>", "content":"<full file content>"}],
          "notes": "<short summary>"
        }
        Rules:
        - Prefer small, composable modules.
        - Keep changes inside allowed paths only (provided separately).
        - If something is ambiguous, add TODOs and safe scaffolds.
        - Return only valid JSON. No commentary outside JSON.
    """).strip()

    user = f"Allowed paths: {', '.join(ALLOWLIST) or '(no restriction)'}\n\nSPEC:\n{spec}"

    plan_raw = call_openai(MODEL, system, user).strip()

    try:
        plan = json.loads(plan_raw)
    except Exception:
        # If the model didn't return JSON, keep notes so we can see what happened
        plan = {"files": [], "notes": plan_raw}

    changed = []
    for f in plan.get("files", []):
        path = f.get("path", "").lstrip("./")
        if not path:
            continue
        if not within_allowlist(path):
            # Skip writes outside the allowlist
            continue

        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(f.get("content", ""))  # UTF-8 default
        changed.append(path)

    if not changed:
        print("No files written (maybe all proposed paths were outside allowlist?).")
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
