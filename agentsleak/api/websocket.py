"""WebSocket API routes for AgentsLeak real-time streaming."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])


# =============================================================================
# WebSocket Message Types
# =============================================================================


class WSMessage(BaseModel):
    """Base WebSocket message."""

    type: str
    timestamp: datetime
    data: dict[str, Any]


class WSSubscription(BaseModel):
    """Subscription request from client."""

    action: str  # "subscribe" or "unsubscribe"
    channels: list[str]  # e.g., ["events", "alerts", "sessions", "session:abc123"]


# =============================================================================
# Connection Manager
# =============================================================================


class ConnectionManager:
    """Manages WebSocket connections and subscriptions."""

    def __init__(self) -> None:
        # All active connections
        self.active_connections: set[WebSocket] = set()
        # Connection subscriptions: websocket -> set of channels
        self.subscriptions: dict[WebSocket, set[str]] = {}
        # Lock for thread safety
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        """Accept and register a new connection."""
        await websocket.accept()
        async with self._lock:
            self.active_connections.add(websocket)
            # Default subscriptions for new connections
            self.subscriptions[websocket] = {"events", "alerts"}
        logger.info(f"WebSocket connected. Total connections: {len(self.active_connections)}")

    async def disconnect(self, websocket: WebSocket) -> None:
        """Remove a connection."""
        async with self._lock:
            self.active_connections.discard(websocket)
            self.subscriptions.pop(websocket, None)
        logger.info(f"WebSocket disconnected. Total connections: {len(self.active_connections)}")

    async def subscribe(self, websocket: WebSocket, channels: list[str]) -> None:
        """Subscribe a connection to channels."""
        async with self._lock:
            if websocket in self.subscriptions:
                self.subscriptions[websocket].update(channels)
        logger.debug(f"Subscribed to channels: {channels}")

    async def unsubscribe(self, websocket: WebSocket, channels: list[str]) -> None:
        """Unsubscribe a connection from channels."""
        async with self._lock:
            if websocket in self.subscriptions:
                self.subscriptions[websocket].difference_update(channels)
        logger.debug(f"Unsubscribed from channels: {channels}")

    async def broadcast(self, channel: str, message: dict[str, Any]) -> None:
        """Broadcast a message to all connections subscribed to a channel."""
        disconnected: list[WebSocket] = []

        async with self._lock:
            connections = list(self.active_connections)

        for connection in connections:
            # Check if connection is subscribed to this channel
            if connection in self.subscriptions:
                subs = self.subscriptions[connection]
                # Match exact channel or wildcard
                if channel in subs or self._matches_wildcard(channel, subs):
                    try:
                        await connection.send_json(message)
                    except Exception as e:
                        logger.warning(f"Failed to send to connection: {e}")
                        disconnected.append(connection)

        # Clean up disconnected clients
        for conn in disconnected:
            await self.disconnect(conn)

    def _matches_wildcard(self, channel: str, subscriptions: set[str]) -> bool:
        """Check if a channel matches any wildcard subscriptions."""
        # Support patterns like "session:*" matching "session:abc123"
        for sub in subscriptions:
            if sub.endswith("*"):
                prefix = sub[:-1]
                if channel.startswith(prefix):
                    return True
        return False

    async def send_personal(self, websocket: WebSocket, message: dict[str, Any]) -> None:
        """Send a message to a specific connection."""
        try:
            await websocket.send_json(message)
        except Exception as e:
            logger.warning(f"Failed to send personal message: {e}")
            await self.disconnect(websocket)


# Global connection manager instance
manager = ConnectionManager()


def get_connection_manager() -> ConnectionManager:
    """Get the global connection manager."""
    return manager


# =============================================================================
# WebSocket Endpoint
# =============================================================================


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """WebSocket endpoint for real-time event/alert streaming.

    Supported message types from client:
    - {"action": "subscribe", "channels": ["events", "alerts", "session:abc123"]}
    - {"action": "unsubscribe", "channels": ["events"]}
    - {"action": "ping"}

    Server sends:
    - {"type": "event", "timestamp": "...", "data": {...}}
    - {"type": "alert", "timestamp": "...", "data": {...}}
    - {"type": "session_update", "timestamp": "...", "data": {...}}
    - {"type": "pong", "timestamp": "..."}
    - {"type": "subscribed", "channels": [...]}
    - {"type": "error", "message": "..."}
    """
    await manager.connect(websocket)

    # Send initial subscription confirmation
    await manager.send_personal(
        websocket,
        {
            "type": "connected",
            "timestamp": datetime.now(UTC).isoformat(),
            "data": {
                "message": "Connected to AgentsLeak WebSocket",
                "subscriptions": list(manager.subscriptions.get(websocket, set())),
            },
        },
    )

    try:
        while True:
            # Receive message from client
            data = await websocket.receive_text()

            try:
                message = json.loads(data)
                action = message.get("action")

                if action == "subscribe":
                    channels = message.get("channels", [])
                    await manager.subscribe(websocket, channels)
                    await manager.send_personal(
                        websocket,
                        {
                            "type": "subscribed",
                            "timestamp": datetime.now(UTC).isoformat(),
                            "data": {
                                "channels": list(
                                    manager.subscriptions.get(websocket, set())
                                )
                            },
                        },
                    )

                elif action == "unsubscribe":
                    channels = message.get("channels", [])
                    await manager.unsubscribe(websocket, channels)
                    await manager.send_personal(
                        websocket,
                        {
                            "type": "unsubscribed",
                            "timestamp": datetime.now(UTC).isoformat(),
                            "data": {
                                "channels": list(
                                    manager.subscriptions.get(websocket, set())
                                )
                            },
                        },
                    )

                elif action == "ping":
                    await manager.send_personal(
                        websocket,
                        {
                            "type": "pong",
                            "timestamp": datetime.now(UTC).isoformat(),
                            "data": {},
                        },
                    )

                else:
                    await manager.send_personal(
                        websocket,
                        {
                            "type": "error",
                            "timestamp": datetime.now(UTC).isoformat(),
                            "data": {"message": f"Unknown action: {action}"},
                        },
                    )

            except json.JSONDecodeError:
                await manager.send_personal(
                    websocket,
                    {
                        "type": "error",
                        "timestamp": datetime.now(UTC).isoformat(),
                        "data": {"message": "Invalid JSON message"},
                    },
                )

    except WebSocketDisconnect:
        await manager.disconnect(websocket)


# =============================================================================
# Broadcast Functions (called from other parts of the app)
# =============================================================================


async def broadcast_event(event_data: dict[str, Any]) -> None:
    """Broadcast a new event to subscribed clients."""
    message = {
        "type": "event",
        "timestamp": datetime.now(UTC).isoformat(),
        "payload": event_data,
    }
    await manager.broadcast("events", message)

    # Also broadcast to session-specific channel
    session_id = event_data.get("session_id")
    if session_id:
        await manager.broadcast(f"session:{session_id}", message)


async def broadcast_alert(alert_data: dict[str, Any]) -> None:
    """Broadcast a new alert to subscribed clients."""
    message = {
        "type": "alert",
        "timestamp": datetime.now(UTC).isoformat(),
        "payload": alert_data,
    }
    await manager.broadcast("alerts", message)

    # Also broadcast to session-specific channel
    session_id = alert_data.get("session_id")
    if session_id:
        await manager.broadcast(f"session:{session_id}", message)


async def broadcast_session_update(session_data: dict[str, Any]) -> None:
    """Broadcast a session update to subscribed clients."""
    message = {
        "type": "session_update",
        "timestamp": datetime.now(UTC).isoformat(),
        "payload": session_data,
    }
    await manager.broadcast("sessions", message)

    # Also broadcast to session-specific channel
    session_id = session_data.get("session_id")
    if session_id:
        await manager.broadcast(f"session:{session_id}", message)
