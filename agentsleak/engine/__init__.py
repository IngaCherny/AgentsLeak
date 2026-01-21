"""Engine module for AgentsLeak - processes and analyzes events."""

from agentsleak.engine.classifier import classify_event, compute_severity
from agentsleak.engine.processor import Engine, get_engine

__all__ = ["Engine", "get_engine", "classify_event", "compute_severity"]
