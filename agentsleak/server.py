"""FastAPI server for AgentsLeak."""

from __future__ import annotations

import asyncio
import hmac
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from agentsleak.api import (
    alerts_router,
    events_router,
    graph_router,
    policies_router,
    sessions_router,
    stats_router,
    websocket_router,
)
from agentsleak.collector.routes import router as collector_router
from agentsleak.config.settings import Settings, get_settings, set_settings
from agentsleak.engine.processor import Engine, set_engine
from agentsleak.store.database import Database, get_database, set_database

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan handler.

    Initializes database and starts the processing engine on startup.
    Cleans up resources on shutdown.
    """
    settings = get_settings()

    # Initialize database
    logger.info(f"Initializing database at {settings.db_path}")
    database = Database(settings)
    set_database(database)

    # Seed default detection policies
    from agentsleak.config.policy_seeder import seed_default_policies

    count = seed_default_policies(database)
    logger.info(f"Seeded {count} default policies")

    # Initialize and start engine
    logger.info("Starting event processing engine")
    engine = Engine(settings, database)
    set_engine(engine)
    await engine.start()

    # Start stale session cleanup task
    async def _cleanup_stale_sessions() -> None:
        """Periodically close sessions with no recent activity."""
        while True:
            await asyncio.sleep(300)  # check every 5 minutes
            try:
                closed = database.cleanup_stale_sessions(inactive_minutes=1440)
                if closed > 0:
                    logger.info(f"Auto-closed {closed} stale session(s)")
            except Exception:
                logger.exception("Error in stale session cleanup")

    cleanup_task = asyncio.create_task(_cleanup_stale_sessions())

    logger.info(
        f"AgentsLeak server starting on http://{settings.host}:{settings.port}"
    )

    yield

    # Cleanup
    logger.info("Shutting down AgentsLeak server")
    cleanup_task.cancel()
    await engine.stop()
    database.close()


class ApiKeyAuthMiddleware(BaseHTTPMiddleware):
    """Authentication middleware for AgentsLeak.

    Two independent auth mechanisms:
    1. Collector auth: AGENTSLEAK_API_KEY protects /api/collect/* endpoints
       via X-AgentsLeak-Key header.
    2. Dashboard auth: AGENTSLEAK_DASHBOARD_TOKEN protects all other /api/*
       routes via Authorization: Bearer <token> header. WebSocket connections
       pass the token as a ?token= query parameter.
    """

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # --- Collector auth (hook endpoints) ---
        api_key = os.environ.get("AGENTSLEAK_API_KEY")
        if api_key and path.startswith("/api/collect/"):
            provided_key = request.headers.get("X-AgentsLeak-Key")
            if not provided_key or not hmac.compare_digest(provided_key, api_key):
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Invalid or missing API key"},
                )
            return await call_next(request)

        # --- Dashboard auth (API + WebSocket) ---
        dashboard_token = os.environ.get("AGENTSLEAK_DASHBOARD_TOKEN")
        if not dashboard_token:
            return await call_next(request)

        # Skip auth for: health endpoint, collector routes, static assets, SPA
        if (
            path == "/api/health"
            or path.startswith("/api/collect/")
            or path.startswith("/assets/")
            or not path.startswith("/api/")
        ):
            return await call_next(request)

        # WebSocket: check ?token= query param
        if path == "/api/ws":
            token = request.query_params.get("token")
            if not token or not hmac.compare_digest(token, dashboard_token):
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Invalid or missing dashboard token"},
                )
            return await call_next(request)

        # Regular API: check Authorization: Bearer <token>
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            provided_token = auth_header[7:]
        else:
            provided_token = ""

        if not provided_token or not hmac.compare_digest(provided_token, dashboard_token):
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or missing dashboard token"},
            )

        return await call_next(request)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create and configure the FastAPI application.

    Args:
        settings: Optional settings. Uses default settings if not provided.

    Returns:
        Configured FastAPI application
    """
    if settings:
        set_settings(settings)
    else:
        settings = get_settings()

    # Configure logging
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper()),
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    app = FastAPI(
        title="AgentsLeak",
        description="AI Agent Security Monitoring",
        version="0.1.0",
        lifespan=lifespan,
    )

    # Configure CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-AgentsLeak-Key",
                       "X-Endpoint-Hostname", "X-Endpoint-User", "X-AgentsLeak-Source"],
    )

    # Add optional API key authentication for collector endpoints
    app.add_middleware(ApiKeyAuthMiddleware)

    # Include routers
    app.include_router(collector_router)

    # Include API routers with /api prefix
    app.include_router(sessions_router, prefix="/api")
    app.include_router(events_router, prefix="/api")
    app.include_router(alerts_router, prefix="/api")
    app.include_router(policies_router, prefix="/api")
    app.include_router(graph_router, prefix="/api")
    app.include_router(stats_router, prefix="/api")
    app.include_router(websocket_router, prefix="/api")

    # API routes
    @app.get("/api/health")
    async def health_check() -> dict[str, str]:
        """Global health check endpoint."""
        return {"status": "healthy", "service": "agentsleak"}

    @app.get("/api/overview")
    async def get_overview() -> dict[str, int]:
        """Get basic overview statistics."""
        db = get_database()
        return {
            "total_sessions": db.get_session_count(),
            "active_sessions": db.get_session_count(status="active"),
            "total_events": db.get_event_count(),
            "total_alerts": db.get_alert_count(),
            "new_alerts": db.get_alert_count(status="new"),
        }

    # Mount static files for dashboard (if exists)
    dashboard_path = Path(__file__).parent.parent / "dashboard" / "dist"
    if dashboard_path.exists():
        # Serve static assets (JS, CSS, etc.)
        app.mount(
            "/assets",
            StaticFiles(directory=str(dashboard_path / "assets")),
            name="dashboard-assets",
        )

        # SPA catch-all: serve index.html for all non-API routes
        @app.get("/{full_path:path}")
        async def serve_spa(full_path: str) -> FileResponse:
            """Serve the SPA index.html for all non-API routes."""
            # Never intercept API routes — let them 404 naturally
            if full_path.startswith("api/") or full_path == "api":
                raise HTTPException(status_code=404, detail="Not found")
            file_path = (dashboard_path / full_path).resolve()
            if not str(file_path).startswith(str(dashboard_path.resolve())):
                raise HTTPException(status_code=403, detail="Forbidden")
            if file_path.is_file():
                return FileResponse(str(file_path))
            return FileResponse(str(dashboard_path / "index.html"))

        logger.info(f"Mounted dashboard from {dashboard_path}")
    else:
        logger.warning(
            f"Dashboard not found at {dashboard_path}. "
            "Run 'npm run build' in the dashboard directory to build it."
        )

        @app.get("/")
        async def root() -> dict[str, str]:
            """Root endpoint when dashboard is not built."""
            return {
                "message": "AgentsLeak API is running",
                "docs": "/docs",
                "health": "/api/health",
            }

    return app


# Create default app instance
app = create_app()
