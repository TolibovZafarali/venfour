FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080 \
    VENFOUR_ENABLE_LEGACY_ANALYSIS_API=0

WORKDIR /app

COPY requirements.txt ./
RUN python -m pip install --no-cache-dir --requirement requirements.txt

COPY schemas/ ./schemas/
COPY scripts/ ./scripts/
COPY venfour/ ./venfour/

USER 65534:65534

EXPOSE 8080
STOPSIGNAL SIGTERM

CMD ["sh", "-c", "exec python -m uvicorn venfour.api:create_app --factory --host 0.0.0.0 --port \"${PORT:-8080}\" --workers 1 --no-server-header"]
