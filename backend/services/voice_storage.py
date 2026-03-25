"""Voice audio storage — S3 with local filesystem fallback."""

import os
import shutil
from datetime import datetime
from typing import Optional

# S3 config from environment
S3_BUCKET = os.getenv("AWS_S3_BUCKET", "")
AWS_ACCESS_KEY = os.getenv("AWS_ACCESS_KEY_ID", "")
AWS_SECRET_KEY = os.getenv("AWS_SECRET_ACCESS_KEY", "")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")

# Local fallback
COS_WORKSPACE = os.getenv("COS_WORKSPACE", os.path.expanduser("~/.openclaw/workspace"))
LOCAL_VOICE_DIR = os.path.join(COS_WORKSPACE, "data", "voice", "audio")

_s3_client = None


def _get_s3():
    """Lazy init S3 client."""
    global _s3_client
    if _s3_client is None and S3_BUCKET and AWS_ACCESS_KEY:
        import boto3
        _s3_client = boto3.client(
            "s3",
            aws_access_key_id=AWS_ACCESS_KEY,
            aws_secret_access_key=AWS_SECRET_KEY,
            region_name=AWS_REGION,
        )
    return _s3_client


def _use_s3() -> bool:
    """Check if S3 is configured."""
    return bool(S3_BUCKET and AWS_ACCESS_KEY and AWS_SECRET_KEY)


def _generate_key(who: str, update_type: str, ext: str = "webm") -> str:
    """Generate storage key: voice/2026-03-24/shivam-standup-0901.webm"""
    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    time_str = now.strftime("%H%M")
    return f"voice/{date_str}/{who}-{update_type}-{time_str}.{ext}"


async def save_audio(file_data: bytes, who: str, update_type: str, ext: str = "webm") -> str:
    """Save audio to S3 or local filesystem. Returns the storage key."""
    key = _generate_key(who, update_type, ext)

    if _use_s3():
        s3 = _get_s3()
        content_type = f"audio/{ext}" if ext in ("webm", "mp3", "wav", "ogg") else "application/octet-stream"
        s3.put_object(
            Bucket=S3_BUCKET,
            Key=key,
            Body=file_data,
            ContentType=content_type,
        )
        return key

    # Local fallback
    local_path = os.path.join(LOCAL_VOICE_DIR, key.replace("voice/", ""))
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    with open(local_path, "wb") as f:
        f.write(file_data)
    return key


def get_audio_url(key: str) -> Optional[str]:
    """Get playback URL — presigned S3 URL or local file path."""
    if _use_s3():
        s3 = _get_s3()
        try:
            url = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": S3_BUCKET, "Key": key},
                ExpiresIn=3600,  # 1 hour
            )
            return url
        except Exception:
            return None

    # Local fallback — return relative path for backend to serve
    local_path = os.path.join(LOCAL_VOICE_DIR, key.replace("voice/", ""))
    if os.path.exists(local_path):
        return f"/api/voice/stream/{key}"
    return None


def delete_audio(key: str) -> bool:
    """Delete audio from S3 or local filesystem."""
    if _use_s3():
        s3 = _get_s3()
        try:
            s3.delete_object(Bucket=S3_BUCKET, Key=key)
            return True
        except Exception:
            return False

    # Local fallback
    local_path = os.path.join(LOCAL_VOICE_DIR, key.replace("voice/", ""))
    if os.path.exists(local_path):
        os.remove(local_path)
        return True
    return False


def get_local_path(key: str) -> Optional[str]:
    """Get local filesystem path for a voice file (for streaming)."""
    local_path = os.path.join(LOCAL_VOICE_DIR, key.replace("voice/", ""))
    return local_path if os.path.exists(local_path) else None


def get_storage_mode() -> str:
    """Return current storage mode."""
    return "s3" if _use_s3() else "local"
