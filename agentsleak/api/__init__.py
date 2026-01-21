"""API routes for AgentsLeak dashboard and management."""

from agentsleak.api.alerts import router as alerts_router
from agentsleak.api.events import router as events_router
from agentsleak.api.graph import router as graph_router
from agentsleak.api.policies import router as policies_router
from agentsleak.api.sessions import router as sessions_router
from agentsleak.api.stats import router as stats_router
from agentsleak.api.websocket import router as websocket_router

__all__ = [
    "sessions_router",
    "events_router",
    "alerts_router",
    "policies_router",
    "graph_router",
    "stats_router",
    "websocket_router",
]
