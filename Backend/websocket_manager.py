"""WebSocket manager + room connection manager (shared singleton)."""

import json
from fastapi import WebSocket


class RoomConnectionManager:
    """Manages WebSocket connections per room for real-time updates."""

    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = {}

    async def connect(self, room_id: str, websocket: WebSocket):
        await websocket.accept()
        if room_id not in self.active_connections:
            self.active_connections[room_id] = []
        self.active_connections[room_id].append(websocket)

    def disconnect(self, room_id: str, websocket: WebSocket):
        if room_id in self.active_connections:
            self.active_connections[room_id].remove(websocket)
            if not self.active_connections[room_id]:
                del self.active_connections[room_id]

    async def broadcast(self, room_id: str, message: dict):
        """Send a JSON message to all connected clients in a room."""
        if room_id in self.active_connections:
            text = json.dumps(message)
            for ws in self.active_connections[room_id]:
                try:
                    await ws.send_text(text)
                except Exception:
                    pass


room_manager = RoomConnectionManager()
