"""Bounded operational context without exception payloads or local variables."""

from __future__ import annotations

import copy
import functools
import json
import logging
import re
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Any


_context: ContextVar[dict[str, Any] | None] = ContextVar("analysis_diagnostic_context", default=None)
_ATTRIBUTE = "_venfour_failure_context"
_BOOLEAN_FIELDS = {"providerTransportCompleted", "evidenceNormalized", "historyVerificationBegun"}
_INTEGER_FIELDS = {"requestAttemptsConsumed", "eventIndex", "pageStart", "returnedRows", "parseableObservations", "stageIndex"}


def execution(function):
    @functools.wraps(function)
    def wrapped(*args, **kwargs):
        if _context.get() is not None:
            return function(*args, **kwargs)
        token = _context.set({"phase": "analysis", "operation": "initialize", "stream": None,
            "centerId": None, "eventIndex": None, "pageStart": None,
            "providerTransportCompleted": False, "evidenceNormalized": False,
            "historyVerificationBegun": False, "requestAttemptsConsumed": None})
        try:
            return function(*args, **kwargs)
        except Exception as exc:
            capture_failure(exc)
            logging.getLogger("venfour.analysis_failure").error(json.dumps(failure_diagnostic(exc)))
            raise
        finally:
            _context.reset(token)
    return wrapped


def progress(**fields: Any) -> None:
    state = _context.get()
    if state is None:
        return
    for key, value in fields.items():
        if key in {"phase", "operation"} and isinstance(value, str) and re.fullmatch(r"[a-z_]{1,64}", value):
            state[key] = value
        elif key in _BOOLEAN_FIELDS and type(value) is bool:
            state[key] = value
        elif key in _INTEGER_FIELDS and (value is None or type(value) is int and 0 <= value <= 1000000):
            state[key] = value
        elif key == "stream" and (value is None or isinstance(value, str) and value in {"current", "historical"}):
            state[key] = value
        elif key == "centerId":
            state[key] = value if value is None or value == "customer" or (
                isinstance(value, str) and re.fullmatch(r"cbsa:[0-9]{5}", value)) else "alternate"


def capture_failure(error: Exception) -> None:
    if getattr(error, _ATTRIBUTE, None) is None and _context.get() is not None:
        setattr(error, _ATTRIBUTE, copy.deepcopy(_context.get()))


def inherit_sanitized_failure(wrapper: Exception, cause: Exception) -> None:
    """Preserve frame locations without retaining transport URLs or payloads."""
    diagnostic = failure_diagnostic(cause)
    context = getattr(cause, _ATTRIBUTE, None) or _context.get()
    if context is not None:
        setattr(wrapper, _ATTRIBUTE, copy.deepcopy(context))
    setattr(wrapper, "_venfour_sanitized_exception_chain", diagnostic["exceptionChain"])


@contextmanager
def phase(name: str, operation: str, **fields: Any):
    state = _context.get()
    parent = {key: state[key] for key in ("phase", "operation")} if state else {}
    progress(phase=name, operation=operation, **fields)
    try:
        yield
    except Exception as exc:
        capture_failure(exc)
        raise
    else:
        progress(**parent)


def step(name: str, operation: str):
    def decorate(function):
        @functools.wraps(function)
        def wrapped(*args, **kwargs):
            with phase(name, operation):
                return function(*args, **kwargs)
        return wrapped
    return decorate


def failure_diagnostic(error: Exception) -> dict[str, Any]:
    """Keep every chained frame, but never format exception arguments or source."""
    chain = []
    seen = set()
    cause: BaseException | None = error
    selected = None
    while cause is not None and id(cause) not in seen:
        seen.add(id(cause))
        context = getattr(cause, _ATTRIBUTE, None)
        if context is not None:
            selected = context
        frames = []
        trace = cause.__traceback__
        while trace is not None:
            code = trace.tb_frame.f_code
            frames.append({"file": Path(code.co_filename).name, "function": code.co_name, "line": trace.tb_lineno})
            trace = trace.tb_next
        chain.append({"exceptionType": type(cause).__name__, "frames": frames,
                      "context": copy.deepcopy(context)})
        for entry in getattr(cause, "_venfour_sanitized_exception_chain", ()):
            chain.append(copy.deepcopy(entry))
            if entry.get("context") is not None:
                selected = entry["context"]
        cause = cause.__cause__ or (cause.__context__ if not cause.__suppress_context__ else None)
    context = copy.deepcopy(selected or _context.get() or {"phase": "analysis", "operation": "unknown"})
    internal_code = "ANALYSIS_" + context["phase"].upper() + "_" + context["operation"].upper() + "_FAILED"
    return {**context, "internalErrorCode": internal_code,
            "exceptionType": chain[-1]["exceptionType"],
            "sanitizedMessage": f"The {context['phase']} phase could not complete {context['operation']}.",
            "requestCountIsLastAcknowledged": True, "exceptionChain": chain}
