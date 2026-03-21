"""OpenClaw gateway client — sends task instructions to the agent via /v1/responses."""

import os
import httpx
from typing import Optional

GATEWAY_URL = os.getenv("OPENCLAW_GATEWAY_URL", "http://localhost:18789")
GATEWAY_TOKEN = os.getenv("OPENCLAW_GATEWAY_TOKEN", "6a2cad4249ed66b81a63c93ec8a3fffc788fcbb36ef12b81")

_client: Optional[httpx.AsyncClient] = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            base_url=GATEWAY_URL,
            headers={
                "Authorization": f"Bearer {GATEWAY_TOKEN}",
                "Content-Type": "application/json",
                "x-openclaw-agent-id": "main",
            },
            timeout=60.0,
        )
    return _client


def _extract_text(data: dict) -> str:
    """Extract the agent's text response from the /v1/responses payload."""
    output = data.get("output", data)

    # List of output items (OpenResponses format)
    if isinstance(output, list):
        parts = []
        for item in output:
            if isinstance(item, dict):
                # message item with content array
                content = item.get("content", [])
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "output_text":
                            parts.append(block.get("text", ""))
                elif isinstance(content, str):
                    parts.append(content)
                # plain text item
                if "text" in item:
                    parts.append(item["text"])
        return "\n".join(parts) if parts else str(output)

    # Single output object
    if isinstance(output, dict):
        content = output.get("content", "")
        if isinstance(content, list):
            return "\n".join(
                b.get("text", "") for b in content
                if isinstance(b, dict) and b.get("type") == "output_text"
            ) or str(content)
        return str(content) if content else str(output)

    return str(output)


async def execute(instruction: str) -> dict:
    """Send a natural-language task instruction to the OpenClaw agent."""
    try:
        client = _get_client()
        response = await client.post("/v1/responses", json={
            "model": "openclaw:main",
            "input": instruction,
            "stream": False,
        })

        if response.status_code == 200:
            data = response.json()
            return {
                "success": True,
                "result": _extract_text(data),
                "via": "openclaw",
                "raw": data,
            }
        elif response.status_code == 401:
            return {"success": False, "error": "Gateway authentication failed", "gateway_available": True}
        elif response.status_code == 404:
            return {"success": False, "error": "Gateway /v1/responses endpoint not enabled — add gateway.http.endpoints.responses.enabled: true to openclaw.json", "gateway_available": True}
        else:
            return {"success": False, "error": f"Gateway returned HTTP {response.status_code}: {response.text[:200]}", "gateway_available": True}

    except httpx.ConnectError:
        return {"success": False, "error": "OpenClaw gateway unreachable at " + GATEWAY_URL, "gateway_available": False}
    except httpx.TimeoutException:
        return {"success": False, "error": "Gateway request timed out (60s)", "gateway_available": True}
    except Exception as e:
        return {"success": False, "error": str(e), "gateway_available": False}


async def health() -> dict:
    """Check if the OpenClaw gateway is reachable using /tools/invoke."""
    try:
        client = _get_client()
        response = await client.post("/tools/invoke", json={
            "tool": "sessions_list",
            "action": "json",
            "args": {},
            "sessionKey": "main",
        })
        if response.status_code == 200:
            data = response.json()
            return {"connected": True, "url": GATEWAY_URL, "ok": data.get("ok", False)}
        if response.status_code == 401:
            return {"connected": False, "url": GATEWAY_URL, "error": "Authentication failed — check OPENCLAW_GATEWAY_TOKEN"}
        return {"connected": False, "url": GATEWAY_URL, "error": f"HTTP {response.status_code}"}
    except httpx.ConnectError:
        return {"connected": False, "url": GATEWAY_URL, "error": "Unreachable"}
    except httpx.TimeoutException:
        return {"connected": False, "url": GATEWAY_URL, "error": "Timeout"}
    except Exception as e:
        return {"connected": False, "url": GATEWAY_URL, "error": str(e)}
