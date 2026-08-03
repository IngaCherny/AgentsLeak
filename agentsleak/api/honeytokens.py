"""Honeytoken API routes for AgentsLeak.

The honeytoken *list* (which decoys exist) is editable here; the honeytoken
*response* (alert vs block) is a policy with ``honeytoken: true``. Detection is
decoupled from enforcement, so operators tune the decoys in one place and the
policy engine reacts to whatever is currently active.
"""

from __future__ import annotations

import logging
import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from agentsleak.engine.processor import get_engine
from agentsleak.store.database import Database, get_database

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/honeytokens", tags=["honeytokens"])


class HoneytokenItem(BaseModel):
    """A decoy definition as returned to the dashboard."""

    id: str
    kind: str
    pattern: str
    label: str
    builtin: bool
    enabled: bool


class HoneytokenListResponse(BaseModel):
    items: list[HoneytokenItem]
    total: int


class HoneytokenCreateRequest(BaseModel):
    kind: str = Field(..., description="'path' (regex vs file paths/commands) or 'value' (literal secret)")
    pattern: str = Field(..., min_length=1, description="Regex (path) or literal string (value)")
    label: str = Field(default="", description="Human-readable name for the decoy")


class HoneytokenToggleRequest(BaseModel):
    enabled: bool


def _reload() -> None:
    """Push the edited list into the running engine so it takes effect at once."""
    try:
        get_engine().reload_honeytokens()
    except Exception as e:  # pragma: no cover - defensive
        logger.error(f"Failed to reload honeytokens into engine: {e}")


@router.get("", response_model=HoneytokenListResponse)
async def list_honeytokens(db: Database = Depends(get_database)) -> HoneytokenListResponse:
    """List all decoys (built-in and user-defined)."""
    rows = db.get_honeytoken_rows()
    return HoneytokenListResponse(
        items=[HoneytokenItem(**r) for r in rows],
        total=len(rows),
    )


@router.post("", response_model=HoneytokenItem, status_code=status.HTTP_201_CREATED)
async def create_honeytoken(
    request: HoneytokenCreateRequest,
    db: Database = Depends(get_database),
) -> HoneytokenItem:
    """Add a decoy. Path patterns are validated as regexes."""
    if request.kind not in ("path", "value"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="kind must be 'path' or 'value'",
        )
    if request.kind == "path":
        try:
            re.compile(request.pattern)
        except re.error as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid regex pattern: {e}",
            )

    label = request.label or (
        f"Decoy path {request.pattern}" if request.kind == "path" else "Decoy value"
    )
    row = db.add_honeytoken(request.kind, request.pattern, label)
    _reload()
    logger.info(f"Added honeytoken: {row['id']} ({request.kind})")
    return HoneytokenItem(**row)


@router.post("/{token_id}/toggle", response_model=HoneytokenItem)
async def toggle_honeytoken(
    token_id: str,
    request: HoneytokenToggleRequest,
    db: Database = Depends(get_database),
) -> HoneytokenItem:
    """Enable or disable a decoy (works for built-ins too)."""
    if not db.set_honeytoken_enabled(token_id, request.enabled):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Honeytoken {token_id} not found",
        )
    _reload()
    row = next((r for r in db.get_honeytoken_rows() if r["id"] == token_id), None)
    return HoneytokenItem(**row)  # type: ignore[arg-type]


@router.delete("/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_honeytoken(
    token_id: str,
    db: Database = Depends(get_database),
) -> None:
    """Delete a user-defined decoy. Built-ins can only be disabled, not deleted."""
    result = db.delete_honeytoken(token_id)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Honeytoken {token_id} not found",
        )
    if result == "builtin":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Built-in honeytokens cannot be deleted — disable it instead.",
        )
    _reload()
    logger.info(f"Deleted honeytoken: {token_id}")
