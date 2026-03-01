"""Room management routes – create, join, get code, WebSocket."""

import json
import random
import asyncio

from fastapi import APIRouter, File, Form, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from config import supabase
from websocket_manager import room_manager
from orchestrator import get_next_prompt


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

    # Generate a globally unique 6-digit room id by checking the DB for
    # collisions. Retry a bounded number of times to avoid infinite loops.
    MAX_ATTEMPTS = 1000
    attempt = 0
    room_id = None
    try:
        while attempt < MAX_ATTEMPTS:
            candidate = str(random.randint(100000, 999999))
            exists = (
                supabase.table("game_lobby")
                .select("room_id")
                .eq("room_id", candidate)
                .limit(1)
                .execute()
            )
            if not exists.data:
                room_id = candidate
                break
            attempt += 1

        if room_id is None:
            raise HTTPException(status_code=500, detail="Exhausted room id space; try again later")

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
    Relays client messages to all connections in the room.
    """
    await room_manager.connect(room_id, websocket)
    try:
        while True:
            text = await websocket.receive_text()
            try:
                msg = json.loads(text)
                await room_manager.broadcast(room_id, msg)
            except (json.JSONDecodeError, Exception):
                pass
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

    # shuffled = player_list.copy()
    # random.shuffle(shuffled)
    # assignments = {player_list[i]: shuffled[i] for i in range(len(player_list))}

    # Shuffle players to create a random unique assignment (circular permutation)
    # Each player[i] is assigned player[i+1], guaranteeing no self-assignment
    shuffled = player_list.copy()
    random.shuffle(shuffled)
    assignments = {
        shuffled[i]: shuffled[(i + 1) % len(shuffled)]
        for i in range(len(shuffled))
    }

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

        round_prompt = await asyncio.to_thread(get_next_prompt)

        await room_manager.broadcast(clean_room, {
            "event": "game_started",
            "round_num": current_round,
            "max_rounds": max_rounds,
            "assignments": assignments,
            "players": player_list,
            "round_prompt": round_prompt,
        })

        return {
            "status": "ok",
            "room_id": clean_room,
            "round_num": current_round,
            "max_rounds": max_rounds,
            "assignments": assignments,
            "players": player_list,
            "round_prompt": round_prompt,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

@router.post("/check-match")
async def check_match(body: CheckMatchRequest) -> dict:
    """
    Check if a player's voice-matching guesses are correct.

    Compares the submitted matches against the actual
    player → assigned_player mapping in the rounds table
    for the given room_id and round_num.

    Returns correct count, total, and per-guess results.
    """
    if supabase is None:
        raise HTTPException(status_code=503, detail="Database not configured")

    if not body.matches:
        raise HTTPException(status_code=400, detail="matches must be non-empty")

    try:
        # Each row is one player → assigned_player pair
        result = (
            supabase.table("rounds")
            .select("player, assigned_player")
            .eq("room_id", body.room_id)
            .eq("round_num", body.round_num)
            .execute()
        )

        if not result.data:
            raise HTTPException(
                status_code=404,
                detail=f"No round found for room_id={body.room_id}, round_num={body.round_num}",
            )

        # Build actual mapping from rows: {player: assigned_player}
        actual_mapping = {
            row["player"]: row["assigned_player"] for row in result.data
        }

        # Compare each guess
        results = {}
        correct = 0
        for player, guessed_assigned in body.matches.items():
            actual_assigned = actual_mapping.get(player)
            is_correct = guessed_assigned == actual_assigned
            if is_correct:
                correct += 1
            results[player] = {
                "guessed": guessed_assigned,
                "actual": actual_assigned,
                "correct": is_correct,
            }

        total = len(body.matches)
        score = correct * 100

        # Fetch current round_scores for this player's row
        player_row = (
            supabase.table("rounds")
            .select("id, round_scores")
            .eq("room_id", body.room_id)
            .eq("round_num", body.round_num)
            .eq("player", body.username.strip())
            .limit(1)
            .execute()
        )

        if player_row.data:
            row = player_row.data[0]
            existing_scores = row.get("round_scores") or []
            existing_scores.append(score)
            supabase.table("rounds").update(
                {"round_scores": existing_scores}
            ).eq("id", row["id"]).execute()

        return {
            "status": "ok",
            "room_id": body.room_id,
            "round_num": body.round_num,
            "username": body.username.strip(),
            "correct": correct,
            "total": total,
            "score": score,
            "results": results,
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


@router.get("/assigned_player")
async def get_assigned_player(
    room_id: str = Query(..., description="6-digit room code"),
    username: str = Query(..., description="Player's username"),
) -> dict:
    """Returns the player assigned to the given username for the current round."""
    if supabase is None:
        raise HTTPException(status_code=503, detail="Database not configured")

    clean_room = room_id.strip()
    clean_username = username.strip()
    if not clean_room or not clean_username:
        raise HTTPException(status_code=400, detail="room_id and username must be non-empty")

    try:
        result = (
            supabase.table("rounds")
            .select("assigned_player, round_num")
            .eq("room_id", clean_room)
            .eq("player", clean_username)
            .limit(1)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="No round data found for this player in this room")

        return {
            "status": "ok",
            "username": clean_username,
            "assigned_player": result.data[0]["assigned_player"],
            "round_num": result.data[0]["round_num"],
        }
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
