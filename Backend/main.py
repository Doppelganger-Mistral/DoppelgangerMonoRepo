import asyncio
import os
from io import BytesIO
import uvicorn
from dotenv import load_dotenv

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from elevenlabs.client import ElevenLabs
from supabase import create_client, Client

load_dotenv()

# Supabase configuration
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")

supabase: Client = None

if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

if ELEVENLABS_API_KEY:
    elevenlabs = ElevenLabs(api_key=ELEVENLABS_API_KEY)

app = FastAPI(title="Doppelganger Voice API")


# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins (update for production)
    allow_credentials=False,  # Must be False when using wildcard origins
    allow_methods=["*"],
    allow_headers=["*"],
)


#### HELPER FUNCTIONS: ###############################################################
def _create_voice_sync(name: str, audio_bytes: bytes) -> str:
    """Synchronous voice creation (runs in thread pool)."""
    voice = elevenlabs.voices.ivc.create(
        name=name,
        files=[BytesIO(audio_bytes)],
    )
    return voice.voice_id


def _convert_speech_sync(voice_id: str, audio_bytes: bytes) -> bytes:
    """Synchronous speech-to-speech conversion (runs in thread pool)."""
    audio_data = BytesIO(audio_bytes)
    audio_stream = elevenlabs.speech_to_speech.convert(
        voice_id=voice_id,
        audio=audio_data,
        model_id="eleven_multilingual_sts_v2",
        output_format="mp3_44100_128",
    )
    return b"".join(audio_stream)

########################################################################################


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


# check for username already existing
@app.get("/onboard/user")
async def add_user(
    username: str = Query(..., description="Username to add to the database"),
):
    """Add a user into the database using the Supabase client."""
    if supabase is None:
        raise HTTPException(
            status_code=503,
            detail="Database not configured (missing SUPABASE_URL or SUPABASE_KEY)",
        )
    if not username.strip():
        raise HTTPException(status_code=400, detail="username must be non-empty")
    try:
        result = supabase.table("users").insert(
            {"username": username.strip()}
        ).execute()
        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to insert user")
        return {"status": "ok", "user": result.data[0]}
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))



@app.post("/onboard/voices")
async def create_voice(
    username: str = Form(..., description="Name used when creating the voice"),
    audio: UploadFile = File(..., description="Audio file for voice cloning"),
) -> dict:
    """
    Upload an audio file and username to create a voice clone.
    Returns the created voice ID.
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
        raise HTTPException(
            status_code=503,
            detail="Database not configured (missing SUPABASE_URL or SUPABASE_KEY)",
        )
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


# use the username to fetch the voice_id and then pass it into elevenlabs for the feature
@app.post("/round/convert")
async def convert_audio(
    username: str = Form(
        ..., description="Username whose cloned voice should be used for conversion"
    ),
    audio: UploadFile = File(..., description="Audio file to convert"),
) -> Response:
    """
    Convert the uploaded audio to the given user's cloned voice.
    Returns the generated audio file (MP3).
    """
    if supabase is None:
        raise HTTPException(
            status_code=503,
            detail="Database not configured (missing SUPABASE_URL or SUPABASE_KEY)",
        )
    clean_username = username.strip()
    if not clean_username:
        raise HTTPException(status_code=400, detail="username must be non-empty")

    content = await audio.read()
    if not content:
        raise HTTPException(status_code=400, detail="audio file is empty")

    # Look up the user's voice_id from the database
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
                status_code=404,
                detail=f"User not found for username='{clean_username}'",
            )
        voice_id = result.data[0].get("own_voice_id")
        if not voice_id:
            raise HTTPException(
                status_code=404,
                detail=f"No voice configured for username='{clean_username}'",
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Perform the speech-to-speech conversion using the resolved voice_id
    try:
        output_bytes = await asyncio.to_thread(
            _convert_speech_sync, voice_id, content
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

    return Response(
        content=output_bytes,
        media_type="audio/mpeg",
        headers={
            "Content-Disposition": "attachment; filename=generated.mp3",
        },
    )


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )
