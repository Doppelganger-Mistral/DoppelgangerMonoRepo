"""Room management routes – create, join, get code, WebSocket."""

import random

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from config import supabase
from websocket_manager import room_manager


class CreateRoomRequest(BaseModel):
    username: str
    max_players: int


class JoinRoomRequest(BaseModel):
    room_id: str
    username: str

router = APIRouter(prefix="/room", tags=["Room"])


@router.post("/create")
async def create_room(body: CreateRoomRequest) -> dict:
    """
    Create a new game room.
    Generates a 6-digit room code, inserts into game_lobby with
    the host in player_list, game_state = true.
    """
    if supabase is None:
        raise HTTPException(status_code=503, detail="Database not configured")

    clean_username = body.username.strip()
    max_players = body.max_players
    if not clean_username:
        raise HTTPException(status_code=400, detail="username must be non-empty")
    if max_players < 2:
        raise HTTPException(status_code=400, detail="max_players must be at least 2")

    room_id = str(random.randint(100000, 999999))

    try:
        result = supabase.table("game_lobby").insert({
            "room_id": room_id,
            "player_list": [clean_username],
            "game_state": True,
            "max_players": max_players,
        }).execute()
        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create room")
        return {
            "status": "ok",
            "room_id": room_id,
            "host": clean_username,
            "max_players": max_players,
            "room": result.data[0],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.get("/code")
async def get_room_code(
    username: str = Query(..., description="Host player's username"),
) -> dict:
    """Get the room_id for an active room this user is in."""
    if supabase is None:
        raise HTTPException(status_code=503, detail="Database not configured")

    clean_username = username.strip()
    if not clean_username:
        raise HTTPException(status_code=400, detail="username must be non-empty")

    try:
        result = (
            supabase.table("game_lobby")
            .select("room_id, player_list")
            .eq("game_state", True)
            .execute()
        )
        for room in result.data or []:
            player_list = room.get("player_list") or []
            if clean_username in player_list:
                return {"status": "ok", "room_id": room["room_id"]}
        raise HTTPException(status_code=404, detail="No active room found for this user")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.post("/join")
async def join_room(body: JoinRoomRequest) -> dict:
    """
    Join an existing game room.
    Validates room exists, checks capacity, appends player, broadcasts via WebSocket.
    """
    if supabase is None:
        raise HTTPException(status_code=503, detail="Database not configured")

    clean_room = body.room_id.strip()
    clean_username = body.username.strip()
    if not clean_room or not clean_username:
        raise HTTPException(status_code=400, detail="room_id and username must be non-empty")

    try:
        result = (
            supabase.table("game_lobby")
            .select("*")
            .eq("room_id", clean_room)
            .limit(1)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Room not found")

        room = result.data[0]
        player_list = room.get("player_list", []) or []
        max_players = room.get("max_players", 0)

        if len(player_list) >= max_players:
            raise HTTPException(status_code=400, detail="Lobby full")
        if clean_username in player_list:
            raise HTTPException(status_code=400, detail="Player already in this room")

        player_list.append(clean_username)
        update_result = (
            supabase.table("game_lobby")
            .update({"player_list": player_list})
            .eq("room_id", clean_room)
            .execute()
        )
        if not update_result.data:
            raise HTTPException(status_code=500, detail="Failed to join room")

        await room_manager.broadcast(clean_room, {
            "event": "player_joined",
            "username": clean_username,
            "player_list": player_list,
            "players_count": len(player_list),
        })

        return {
            "status": "ok",
            "room_id": clean_room,
            "username": clean_username,
            "player_list": player_list,
            "players_count": len(player_list),
            "max_players": max_players,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.websocket("/{room_id}/ws")
async def room_websocket(websocket: WebSocket, room_id: str):
    """
    WebSocket for real-time room updates.
    Events: player_joined
    """
    await room_manager.connect(room_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        room_manager.disconnect(room_id, websocket)
