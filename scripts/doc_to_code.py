import os, json, base64, time, textwrap, subprocess, requests
from pathlib import Path
from openai import OpenAI

MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
DOC_IDS = os.getenv("DOC_IDS","").replace(","," ").split()
OUTPUT_DIR = os.getenv("OUTPUT_DIR","mf-generated")
BASE_BRANCH = os.getenv("BASE_BRANCH","main")
BRANCH_NAME = os.getenv("BRANCH_NAME","bot/doc-sync")
ALLOWLIST = [p.strip() for p in os.getenv("ALLOWLIST","").split(",") if p.strip()]  # e.g. "mf-runner/,apps/"

def gsa_access_token():
    sa = json.loads(base64.b64decode(os.environ["GDRIVE_SA_JSON_B64"]))
    now = int(time.time())
    jwt_payload = {
        "iss": sa["client_email"],
        "scope": "https://www.googleapis.com/auth/drive.readonly",
        "aud": sa["token_uri"],
        "exp": now + 3600, "iat": now,
    }
    import jwt
    token = jwt.encode(jwt_payload, sa["private_key"], algorithm="RS256")
    r = requests.post(sa["token_uri"], data={
        "grant_type":"urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": token
    })
    r.raise_for_status()
    return r.json()["access_token"]

def fetch_doc_text(doc_id, at):
    url = f"https://www.googleapis.com/drive/v3/files/{doc_id}/export?mimeType=text/plain"
    r = requests.get(url, headers={"Authorization": f"Bearer {at}"})
    r.raise_for_status()
    return r.text

def within_allowlist(path: str) -> bool:
    if not ALLOWLIST: return True
    return any(path.startswith(prefix) for prefix in ALLOWLIST)

def main():
    if not DOC_IDS: raise SystemExit("DOC_IDS env var is empty")
    at = gsa_access_token()
    chunks = []
    for i, did in enumerate(DOC_IDS, 1):
        txt = fetch_doc_text(did, at)
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
    """)
    user = f"Allowed paths: {', '.join(ALLOWLIST) or '(no restriction)'}\n\nSPEC:\n{spec}"

    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    resp = client.responses.create(
        model=MODEL,
        input=[{"role":"system","content":system},{"role":"user","content":user}],
        text_format={"type":"json_object"}
    )
    plan_raw = resp.output_text.strip()
    try:
        plan = json.loads(plan_raw)
    except Exception:
        plan = {"files": [], "notes": plan_raw}

    changed = []
    for f in plan.get("files", []):
        path = f.get("path","").lstrip("./")
        if not path or not within_allowlist(path):
            continue
        p = Path(path); p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(f.get("content",""))
        changed.append(path)

    if not changed:
        print("No files written (maybe outside allowlist?). Notes:\n", plan.get("notes",""))
        return

    # Commit & PR (in CI), else just print
    if os.getenv("GITHUB_ACTIONS") == "true":
        def run(*args): subprocess.check_call(list(args))
        try:
            run("git","checkout","-b",BRANCH_NAME)
        except subprocess.CalledProcessError:
            run("git","checkout",BRANCH_NAME)
        run("git","add",*changed)
        run("git","commit","-m","chore: doc→code sync (auto)")
        run("git","push","-u","origin",BRANCH_NAME)
        # Try to open PR (gh may not be present, that's okay)
        subprocess.call(["gh","pr","create","--title","Doc→Code Sync (auto)","--body",plan.get("notes",""),
                         "--base",BASE_BRANCH,"--head",BRANCH_NAME])
    else:
        print("Wrote files:\n- " + "\n- ".join(changed))
        print("\nNotes:\n", plan.get("notes",""))

if __name__ == "__main__":
    main()
