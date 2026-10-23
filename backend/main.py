"""ASGI entry point: python main.py or uvicorn main:app."""

from pathlib import Path

import uvicorn
from wisp_backend.application import create_app
from wisp_backend.config.loader import load_logging_settings
from wisp_backend.logging_config import LoggingSettings
from wisp_backend.logging_output import configure_logging

try:
    configure_logging(load_logging_settings())
except ValueError:
    configure_logging(LoggingSettings())
    raise

app = create_app()

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        log_config=None,
        access_log=False,
        reload_dirs=[str(Path(__file__).resolve().parent)],
    )
