#!/bin/bash

# =============================================================================
# Logs Viewer Script
# =============================================================================

if [ -z "$1" ]; then
    echo "📋 Viewing all services logs..."
    docker compose logs -f
else
    echo "📋 Viewing $1 logs..."
    docker compose logs -f $1
fi
