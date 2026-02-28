"""Voice routes – clone creation & speech-to-speech conversion."""

import asyncio
from io import BytesIO

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from config import supabase, elevenlabs

router = APIRouter(tags=["Voice"])


# ── Helpers (run in thread pool) ──────────────────────────────────────

def _create_voice_sync(name: str, audio_bytes: bytes) -> str:
    """Create a cloned voice via ElevenLabs."""
    voice = elevenlabs.voices.ivc.create(
        name=name,
        files=[BytesIO(audio_bytes)],
    )
    return voice.voice_id


def _convert_speech_sync(voice_id: str, audio_bytes: bytes) -> bytes:
    """Speech-to-speech conversion via ElevenLabs."""
    audio_stream = elevenlabs.speech_to_speech.convert(
        voice_id=voice_id,
        audio=BytesIO(audio_bytes),
        model_id="eleven_multilingual_sts_v2",
        output_format="mp3_44100_128",
    )
    return b"".join(audio_stream)


# ── Endpoints ─────────────────────────────────────────────────────────

@router.post("/onboard/voices")
async def create_voice(
    username: str = Form(..., description="Name used when creating the voice"),
    audio: UploadFile = File(..., description="Audio file for voice cloning"),
) -> dict:
    """
    Upload an audio file and username to create a voice clone.
    Stores the resulting voice_id in the users table.
    """
    if not username.strip():
        raise HTTPException(status_code=400, detail="username must be non-empty")

    content = await audio.read()
    if not content:
        raise HTTPException(status_code=400, detail="audio file is empty")

    try:
        voice_id = await asyncio.to_thread(_create_voice_sync, username.strip(), content)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

    if supabase is None:
        raise HTTPException(status_code=503, detail="Database not configured")

    try:
        result = (
            supabase.table("users")
            .update({"own_voice_id": voice_id})
            .eq("username", username.strip())
            .execute()
        )
        if not result.data:
            raise HTTPException(
                status_code=404, detail=f"User not found for username='{username.strip()}'"
            )
        return {"status": "ok", "voice_id": voice_id, "user": result.data[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.post("/round/convert")
async def convert_audio(
    username: str = Form(
        ..., description="Username whose cloned voice should be used for conversion"
    ),
    audio: UploadFile = File(..., description="Audio file to convert"),
) -> Response:
    """
    Convert uploaded audio to the given user's cloned voice.
    Returns the generated audio file (MP3).
    """
    if supabase is None:
        raise HTTPException(status_code=503, detail="Database not configured")

    clean_username = username.strip()
    if not clean_username:
        raise HTTPException(status_code=400, detail="username must be non-empty")

    content = await audio.read()
    if not content:
        raise HTTPException(status_code=400, detail="audio file is empty")

    # Look up the user's voice_id
    try:
        result = (
            supabase.table("users")
            .select("own_voice_id")
            .eq("username", clean_username)
            .limit(1)
            .execute()
        )
        if not result.data:
            raise HTTPException(
                status_code=404, detail=f"User not found for username='{clean_username}'"
            )
        voice_id = result.data[0].get("own_voice_id")
        if not voice_id:
            raise HTTPException(
                status_code=404, detail=f"No voice configured for username='{clean_username}'"
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Speech-to-speech conversion
    try:
        output_bytes = await asyncio.to_thread(_convert_speech_sync, voice_id, content)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

    return Response(
        content=output_bytes,
        media_type="audio/mpeg",
        headers={"Content-Disposition": "attachment; filename=generated.mp3"},
    )
