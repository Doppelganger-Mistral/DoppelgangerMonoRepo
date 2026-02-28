"""
Doppelganger Voice API – main entrypoint.
Registers all route modules and starts the server.
"""

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.room import router as room_router
from routes.onboard import router as onboard_router
from routes.voice import router as voice_router
from routes.s3 import router as s3_router

app = FastAPI(title="Doppelganger Voice API")

# ── CORS ──────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────
app.include_router(room_router)
app.include_router(onboard_router)
app.include_router(voice_router)
app.include_router(s3_router)


# ── Health ────────────────────────────────────────────────────────────
@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "healthy"}


# ── Dev server ────────────────────────────────────────────────────────
if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )

