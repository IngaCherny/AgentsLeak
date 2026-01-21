"""Settings configuration for AgentsLeak."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, model_validator


def get_default_data_dir() -> Path:
    """Get the default data directory (~/.agentsleak)."""
    return Path.home() / ".agentsleak"


def _get_cors_origins() -> list[str]:
    """Return CORS origins from env var or sensible defaults."""
    env = os.environ.get("AGENTSLEAK_CORS_ORIGINS")
    if env:
        return [o.strip() for o in env.split(",") if o.strip()]
    return [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ]


class Settings(BaseModel):
    """Application settings for AgentsLeak."""

    # Database settings
    db_path: Path = Field(
        default_factory=lambda: get_default_data_dir() / "data.db",
        description="Path to SQLite database file",
    )

    # Server settings
    host: str = Field(
        default="127.0.0.1",
        description="Host to bind the server to",
    )
    port: int = Field(
        default=3827,
        description="Port to bind the server to",
    )

    # Rules and policies
    rules_path: Path = Field(
        default_factory=lambda: get_default_data_dir() / "rules",
        description="Path to rules/policies directory",
    )

    # Logging
    log_level: str = Field(
        default="INFO",
        description="Logging level",
    )

    # Processing settings
    batch_size: int = Field(
        default=100,
        description="Number of events to process in a batch",
    )
    process_interval: float = Field(
        default=0.1,
        description="Interval between processing batches (seconds)",
    )

    # CORS settings
    cors_origins: list[str] = Field(
        default_factory=lambda: _get_cors_origins(),
        description="Allowed CORS origins",
    )

    # Dashboard authentication
    dashboard_token: str | None = Field(
        default=None,
        description="Bearer token for dashboard API access. If set, all dashboard routes require auth.",
    )

    # Anthropic API (for Policy Assistant)
    anthropic_api_key: str | None = Field(
        default=None,
        description="Anthropic API key for the Policy Assistant feature.",
    )

    model_config = {
        "validate_default": True,
        "extra": "forbid",
    }

    @model_validator(mode="after")
    def ensure_directories_exist(self) -> Settings:
        """Ensure data directories exist."""
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.rules_path.mkdir(parents=True, exist_ok=True)
        return self

    @classmethod
    def from_env(cls) -> Settings:
        """Load settings from environment variables."""
        env_mapping: dict[str, tuple[str, Any]] = {
            "AGENTSLEAK_DB_PATH": ("db_path", Path),
            "AGENTSLEAK_HOST": ("host", str),
            "AGENTSLEAK_PORT": ("port", int),
            "AGENTSLEAK_RULES_PATH": ("rules_path", Path),
            "AGENTSLEAK_LOG_LEVEL": ("log_level", str),
            "AGENTSLEAK_DASHBOARD_TOKEN": ("dashboard_token", str),
            "ANTHROPIC_API_KEY": ("anthropic_api_key", str),
        }

        kwargs: dict[str, Any] = {}
        for env_var, (field_name, type_func) in env_mapping.items():
            value = os.environ.get(env_var)
            if value is not None:
                kwargs[field_name] = type_func(value)

        return cls(**kwargs)


# Global settings instance
_settings: Settings | None = None


def get_settings() -> Settings:
    """Get the global settings instance."""
    global _settings
    if _settings is None:
        _settings = Settings.from_env()
    return _settings


def set_settings(settings: Settings) -> None:
    """Set the global settings instance."""
    global _settings
    _settings = settings
