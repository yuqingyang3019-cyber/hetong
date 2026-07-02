FROM node:20-bookworm-slim AS frontend

WORKDIR /repo
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci --prefix ./frontend
COPY frontend/ ./frontend/
COPY agent/contract/templates/ ./agent/contract/templates/
RUN npm run build --prefix ./frontend

FROM python:3.12-slim-bookworm

WORKDIR /code
ENV PYTHONUNBUFFERED=1 \
    PORT=9000 \
    H5_STATIC_DIR=/code/static \
    PYTHONPATH=/code

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY agent/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY agent/ .
COPY --from=frontend /repo/agent/static ./static

EXPOSE 9000
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "9000"]
