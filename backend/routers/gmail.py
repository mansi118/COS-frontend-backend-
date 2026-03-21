"""Gmail integration — reads inbox, searches, creates drafts via CoS gmail.py CLI."""

import json
import os
import subprocess
import sys
from typing import Optional
from fastapi import APIRouter, Query

router = APIRouter(prefix="/api/gmail", tags=["gmail"])

COS_WORKSPACE = os.getenv("COS_WORKSPACE", "/home/mansigambhir/.openclaw/workspace")
GMAIL_SCRIPT = os.path.join(COS_WORKSPACE, "scripts", "gmail", "gmail.py")
PYTHON = sys.executable


def _run_gmail(args: list[str]) -> dict:
    """Run the Gmail CLI script and return JSON output."""
    if not os.path.exists(GMAIL_SCRIPT):
        return {"error": f"Gmail script not found at {GMAIL_SCRIPT}"}

    cmd = [PYTHON, GMAIL_SCRIPT, "--json"] + args
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
            cwd=os.path.dirname(GMAIL_SCRIPT),
        )
        if result.returncode != 0:
            stderr = result.stderr.strip()
            if "credentials.json" in stderr or "token.json" in stderr:
                return {"error": "Gmail OAuth not configured. Run gmail.py manually first to authorize."}
            return {"error": stderr or "Gmail CLI failed"}
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError:
            return {"raw": result.stdout.strip()}
    except subprocess.TimeoutExpired:
        return {"error": "Gmail request timed out"}
    except Exception as e:
        return {"error": str(e)}


@router.get("/inbox")
def get_inbox(limit: int = Query(10, le=50), unread: bool = Query(False), starred: bool = Query(False)):
    """List inbox messages."""
    args = ["inbox", "--limit", str(limit)]
    if unread:
        args.append("--unread")
    if starred:
        args.append("--starred")
    data = _run_gmail(args)
    if isinstance(data, list):
        return {"messages": data, "count": len(data)}
    if "error" in data:
        return data
    return {"messages": data if isinstance(data, list) else [], "count": 0}


@router.get("/read/{message_id}")
def read_message(message_id: str):
    """Read a specific email by ID."""
    return _run_gmail(["read", message_id])


@router.get("/search")
def search_messages(q: str = Query(...), limit: int = Query(10, le=50)):
    """Search Gmail messages."""
    args = ["search", q, "--limit", str(limit)]
    data = _run_gmail(args)
    if isinstance(data, list):
        return {"messages": data, "count": len(data), "query": q}
    if "error" in data:
        return data
    return {"messages": [], "count": 0, "query": q}


@router.post("/draft")
def create_draft(
    to: str = Query(...),
    subject: str = Query(...),
    body: str = Query(...),
    cc: Optional[str] = Query(None),
):
    """Create a Gmail draft."""
    args = ["draft", "--to", to, "--subject", subject, "--body", body]
    if cc:
        args.extend(["--cc", cc])
    return _run_gmail(args)


@router.get("/labels")
def list_labels():
    """List all Gmail labels."""
    data = _run_gmail(["labels"])
    if isinstance(data, list):
        return {"labels": data}
    return data


@router.get("/config")
def gmail_config():
    """Check if Gmail CLI is available and configured."""
    script_exists = os.path.exists(GMAIL_SCRIPT)
    token_exists = os.path.exists(os.path.join(COS_WORKSPACE, "scripts", "common", "token.json"))

    # Check if token has Gmail scopes
    gmail_scopes = False
    token_path = os.path.join(COS_WORKSPACE, "scripts", "common", "token.json")
    if os.path.exists(token_path):
        try:
            with open(token_path) as f:
                token = json.load(f)
            scopes = token.get("scopes", [])
            gmail_scopes = any("gmail" in s for s in scopes)
        except Exception:
            pass

    return {
        "script_exists": script_exists,
        "token_exists": token_exists,
        "gmail_scopes": gmail_scopes,
        "configured": script_exists and token_exists and gmail_scopes,
        "note": "Gmail OAuth token needs gmail scopes. Run: python3 gmail.py inbox --limit 1" if not gmail_scopes else None,
    }
