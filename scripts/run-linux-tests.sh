#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

IMAGE_NAME="mcp-screenshot-linux-test"

echo "Building Docker image..."
docker build -f "$PROJECT_DIR/Dockerfile.linux-test" -t "$IMAGE_NAME" "$PROJECT_DIR"

echo "Running Linux e2e tests..."
docker run --rm "$IMAGE_NAME" "$@"
