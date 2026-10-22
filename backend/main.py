"""ASGI entry point: python main.py or uvicorn main:app."""

from pathlib import Path

import uvicorn
from wisp_backend.application import create_app

app = create_app()

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        reload_dirs=[str(Path(__file__).resolve().parent)],
    )
