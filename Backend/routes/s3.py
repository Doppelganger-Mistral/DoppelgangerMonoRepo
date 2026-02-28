"""S3 routes – upload, download, and list vocals."""

import asyncio
import os
from io import BytesIO

from botocore.exceptions import ClientError
from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response

from config import s3_client, S3_BUCKET_NAME, AWS_REGION

router = APIRouter(tags=["S3"])


# ── Helpers (run in thread pool) ──────────────────────────────────────

def _upload_to_s3_sync(file_bytes: bytes, key: str, content_type: str) -> str:
    """Upload bytes to S3, return the public URL."""
    s3_client.upload_fileobj(
        BytesIO(file_bytes),
        S3_BUCKET_NAME,
        key,
        ExtraArgs={"ContentType": content_type},
    )
    return f"https://{S3_BUCKET_NAME}.s3.{AWS_REGION}.amazonaws.com/{key}"


def _download_from_s3_sync(key: str) -> tuple[bytes, str]:
    """Download an object from S3. Returns (file_bytes, content_type)."""
    response = s3_client.get_object(Bucket=S3_BUCKET_NAME, Key=key)
    content_type = response.get("ContentType", "audio/mpeg")
    file_bytes = response["Body"].read()
    return file_bytes, content_type


def _list_s3_keys_sync(prefix: str) -> list[str]:
    """List all object keys under an S3 prefix."""
    keys = []
    paginator = s3_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=S3_BUCKET_NAME, Prefix=prefix):
        for obj in page.get("Contents", []):
            keys.append(obj["Key"])
    return keys


# ── Endpoints ─────────────────────────────────────────────────────────

@router.post("/upload/s3")
async def upload_to_s3(
    audio: UploadFile = File(..., description="Audio/vocal file to upload to S3"),
    room_id: str = Form(..., description="Room ID"),
    round_id: str = Form(..., description="Round ID"),
    username: str = Form(..., description="Player username"),
) -> dict:
    """
    Upload a vocal file to S3.
    Stored as: {room_id}/{round_id}/{username}.mp3
    """
    if s3_client is None or not S3_BUCKET_NAME:
        raise HTTPException(status_code=503, detail="S3 not configured")

    clean_room = room_id.strip()
    clean_round = round_id.strip()
    clean_username = username.strip()
    if not clean_room or not clean_round or not clean_username:
        raise HTTPException(status_code=400, detail="room_id, round_id, and username must be non-empty")

    content = await audio.read()
    if not content:
        raise HTTPException(status_code=400, detail="audio file is empty")

    s3_key = f"{clean_room}/{clean_round}/{clean_username}.mp3"
    content_type = audio.content_type or "audio/mpeg"

    try:
        s3_url = await asyncio.to_thread(_upload_to_s3_sync, content, s3_key, content_type)
    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"S3 upload failed: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

    return {"status": "ok", "url": s3_url, "s3_key": s3_key}


@router.get("/download/s3")
async def download_from_s3(
    room_id: str = Query(..., description="Room ID"),
    round_id: str = Query(..., description="Round ID"),
    username: str = Query(..., description="Player username"),
) -> Response:
    """
    Download a single player's vocal file from S3.
    Fetches: {room_id}/{round_id}/{username}.mp3
    """
    if s3_client is None or not S3_BUCKET_NAME:
        raise HTTPException(status_code=503, detail="S3 not configured")

    clean_room = room_id.strip()
    clean_round = round_id.strip()
    clean_username = username.strip()
    if not clean_room or not clean_round or not clean_username:
        raise HTTPException(status_code=400, detail="room_id, round_id, and username must be non-empty")

    s3_key = f"{clean_room}/{clean_round}/{clean_username}.mp3"

    try:
        file_bytes, content_type = await asyncio.to_thread(_download_from_s3_sync, s3_key)
    except ClientError as e:
        if e.response["Error"]["Code"] == "NoSuchKey":
            raise HTTPException(status_code=404, detail=f"File not found: {s3_key}")
        raise HTTPException(status_code=500, detail=f"S3 download failed: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

    return Response(
        content=file_bytes,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{clean_username}.mp3"'},
    )


@router.get("/round/vocals")
async def get_round_vocals(
    room_id: str = Query(..., description="Room ID"),
    round_id: str = Query(..., description="Round ID"),
) -> dict:
    """
    List all vocal file names for a specific room and round.
    Returns the player usernames who have submitted audio.
    """
    if s3_client is None or not S3_BUCKET_NAME:
        raise HTTPException(status_code=503, detail="S3 not configured")

    clean_room = room_id.strip()
    clean_round = round_id.strip()
    if not clean_room or not clean_round:
        raise HTTPException(status_code=400, detail="room_id and round_id must be non-empty")

    prefix = f"{clean_room}/{clean_round}/"

    try:
        keys = await asyncio.to_thread(_list_s3_keys_sync, prefix)
    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"S3 list failed: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

    players = [os.path.splitext(os.path.basename(k))[0] for k in keys]

    return {
        "status": "ok",
        "room_id": clean_room,
        "round_id": clean_round,
        "count": len(players),
        "players": players,
        "files": keys,
    }
