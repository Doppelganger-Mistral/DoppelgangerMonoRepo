"""Onboarding routes – user registration."""

from fastapi import APIRouter, HTTPException, Query

from config import supabase

router = APIRouter(prefix="/onboard", tags=["Onboard"])


@router.get("/user")
async def add_user(
    username: str = Query(..., description="Username to add to the database"),
):
    """Add a new user to the database."""
    if supabase is None:
        raise HTTPException(status_code=503, detail="Database not configured")

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
