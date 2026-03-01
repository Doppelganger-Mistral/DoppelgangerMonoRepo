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

    clean_username = username.strip()
    if not clean_username:
        raise HTTPException(status_code=400, detail="username must be non-empty")

    existing = (
        supabase.table("users")
        .select("username")
        .eq("username", clean_username)
        .execute()
    )
    if existing.data:
        raise HTTPException(status_code=409, detail="username already exists")

    try:
        result = supabase.table("users").insert(
            {"username": clean_username}
        ).execute()
        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to insert user")
        return {"status": "ok", "user": result.data[0]}
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.get("/login")
async def login_user(
    username: str = Query(..., description="Username to look up"),
):
    """Check if a user exists in the database."""
    if supabase is None:
        raise HTTPException(status_code=503, detail="Database not configured")

    clean_username = username.strip()
    if not clean_username:
        raise HTTPException(status_code=400, detail="username must be non-empty")

    existing = (
        supabase.table("users")
        .select("username")
        .eq("username", clean_username)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="username not found")

    return {"status": "ok", "user": existing.data[0]}
