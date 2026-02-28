"""Room management routes – create, join, get code, WebSocket."""

import random

from fastapi import APIRouter, File, Form, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from config import supabase
from websocket_manager import room_manager


class CreateRoomRequest(BaseModel):
    username: str
    max_players: int


class JoinRoomRequest(BaseModel):
    room_id: str
    username: str


class CheckMatchRequest(BaseModel):
    room_id: str
    round_num: int
    username: str  # the player submitting their guesses
    matches: dict[str, str]  # e.g. {"Rahul": "Manoj", "Ishman": "Abishek"}

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


@router.get("/{room_id}")
async def get_room(room_id: str) -> dict:
    """Fetch the current state of a room."""
    if supabase is None:
        raise HTTPException(status_code=503, detail="Database not configured")

    clean_room = room_id.strip()
    if not clean_room:
        raise HTTPException(status_code=400, detail="room_id must be non-empty")

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
        return {"status": "ok", "room": result.data[0]}
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


@router.post("/next_round")
async def next_round(
    room_id: str = Form(..., description="6-digit room code"),
    max_rounds: int = Form(None, description="Maximum number of rounds (only required on first call)"),
) -> dict:
    """
    Initialize or advance to the next round.
    - First call: creates round rows for each player (round_num=1). max_rounds required.
    - Subsequent calls: increments round_num for all players in the room. max_rounds ignored.
    - Randomly assigns each player a player to voice-clone.
    """
    if supabase is None:
        raise HTTPException(status_code=503, detail="Database not configured")

    clean_room = room_id.strip()
    if not clean_room:
        raise HTTPException(status_code=400, detail="room_id must be non-empty")

    # Fetch the room to get the player list
    try:
        lobby_result = (
            supabase.table("game_lobby")
            .select("player_list")
            .eq("room_id", clean_room)
            .limit(1)
            .execute()
        )
        if not lobby_result.data:
            raise HTTPException(status_code=404, detail="Room not found")

        player_list: list[str] = lobby_result.data[0].get("player_list") or []
        if not player_list:
            raise HTTPException(status_code=400, detail="Room has no players")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Check if round rows already exist for this room
    try:
        existing = (
            supabase.table("rounds")
            .select("player, round_num, max_rounds")
            .eq("room_id", clean_room)
            .limit(1)
            .execute()
        )
        round_exists = bool(existing.data)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

    shuffled = player_list.copy()
    random.shuffle(shuffled)
    assignments = {player_list[i]: shuffled[i] for i in range(len(player_list))}

    try:
        if not round_exists:
            if max_rounds is None or max_rounds < 1:
                raise HTTPException(status_code=400, detail="max_rounds is required and must be at least 1 when creating the first round")

            rows = [
                {
                    "room_id": clean_room,
                    "player": player,
                    "assigned_player": assignments[player],
                    "round_num": 1,
                    "max_rounds": max_rounds,
                    "round_scores": [],
                }
                for player in player_list
            ]
            result = supabase.table("rounds").insert(rows).execute()
            if not result.data:
                raise HTTPException(status_code=500, detail="Failed to create rounds")
            current_round = 1

        else:
            # Read max_rounds from DB — ignore whatever was passed in
            stored_max_rounds = existing.data[0]["max_rounds"]
            current_round = existing.data[0]["round_num"] + 1

            if current_round > stored_max_rounds:
                raise HTTPException(status_code=400, detail="All rounds already completed")

            for player in player_list:
                supabase.table("rounds").update({
                    "round_num": current_round,
                    "assigned_player": assignments[player],
                }).eq("room_id", clean_room).eq("player", player).execute()

            max_rounds = stored_max_rounds  # for the return value

        # # Broadcast to all players in the room that the next round is beginning
        # await room_manager.broadcast(clean_room, {
        #     "event": "next_round",
        #     "round_num": current_round,
        #     "max_rounds": max_rounds,
        #     "assignments": assignments,
        # })

        return {
            "status": "ok",
            "room_id": clean_room,
            "round_num": current_round,
            "max_rounds": max_rounds,
            "assignments": assignments,
            "players": player_list,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.get("/leaderboard")
async def get_leaderboard(
    room_id: str = Query(..., description="6-digit room code"),
    round_num: int = Query(..., description="Round number to fetch scores for"),
) -> dict:
    """
    Returns sorted leaderboard for a specific round.
    Score is taken from round_scores[round_num - 1] for each player.
    """
    if supabase is None:
        raise HTTPException(status_code=503, detail="Database not configured")

    clean_room = room_id.strip()
    if not clean_room:
        raise HTTPException(status_code=400, detail="room_id must be non-empty")

    try:
        result = (
            supabase.table("rounds")
            .select("player, round_scores")
            .eq("room_id", clean_room)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="No round data found for this room")

        scores = {}
        for row in result.data:
            round_scores = row.get("round_scores") or []
            idx = round_num - 1
            score = round_scores[idx] if idx < len(round_scores) else 0
            scores[row["player"]] = score

        sorted_scores = dict(sorted(scores.items(), key=lambda x: x[1], reverse=True))
        return {"status": "ok", "round_num": round_num, "leaderboard": sorted_scores}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.get("/leaderboard/final")
async def get_final_leaderboard(
    room_id: str = Query(..., description="6-digit room code"),
) -> dict:
    """
    Returns sorted leaderboard with total score across all rounds.
    """
    if supabase is None:
        raise HTTPException(status_code=503, detail="Database not configured")

    clean_room = room_id.strip()
    if not clean_room:
        raise HTTPException(status_code=400, detail="room_id must be non-empty")

    try:
        result = (
            supabase.table("rounds")
            .select("player, round_scores")
            .eq("room_id", clean_room)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="No round data found for this room")

        scores = {
            row["player"]: sum(row.get("round_scores") or [])
            for row in result.data
        }

        sorted_scores = dict(sorted(scores.items(), key=lambda x: x[1], reverse=True))
        return {"status": "ok", "leaderboard": sorted_scores}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
