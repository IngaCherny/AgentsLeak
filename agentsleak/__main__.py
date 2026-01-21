"""CLI entry point for AgentsLeak."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> int:
    """Main entry point for the AgentsLeak CLI."""
    parser = argparse.ArgumentParser(
        prog="agentsleak",
        description="AgentsLeak — Runtime Security Monitoring for AI Coding Agents",
    )

    parser.add_argument(
        "--host",
        type=str,
        default="127.0.0.1",
        help="Host to bind the server to (default: 127.0.0.1)",
    )

    parser.add_argument(
        "--port",
        type=int,
        default=3827,
        help="Port to bind the server to (default: 3827)",
    )

    parser.add_argument(
        "--db-path",
        type=Path,
        default=None,
        help="Path to SQLite database (default: ~/.agentsleak/data.db)",
    )

    parser.add_argument(
        "--log-level",
        type=str,
        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        default="INFO",
        help="Logging level (default: INFO)",
    )

    parser.add_argument(
        "--reload",
        action="store_true",
        help="Enable auto-reload for development",
    )

    parser.add_argument(
        "--version",
        action="version",
        version="%(prog)s 0.1.0",
    )

    args = parser.parse_args()

    # Import here to avoid circular imports and speed up --help
    import uvicorn

    from agentsleak.config.settings import Settings, set_settings

    # Build settings from CLI arguments
    settings_kwargs = {
        "host": args.host,
        "port": args.port,
        "log_level": args.log_level,
    }

    if args.db_path:
        settings_kwargs["db_path"] = args.db_path

    # Start from env-based settings, then override with CLI args
    settings = Settings.from_env()
    for k, v in settings_kwargs.items():
        setattr(settings, k, v)
    set_settings(settings)

    print(f"Starting AgentsLeak server on http://{args.host}:{args.port}")
    print(f"Database: {settings.db_path}")
    print(f"Log level: {args.log_level}")
    print()
    print("Press Ctrl+C to stop")
    print()

    # Run the server
    uvicorn.run(
        "agentsleak.server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level=args.log_level.lower(),
    )

    return 0


if __name__ == "__main__":
    sys.exit(main())
