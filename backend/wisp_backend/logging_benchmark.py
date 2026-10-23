"""Offline synthetic logger benchmark: python -m wisp_backend.logging_benchmark."""

import io
import json
import time

from wisp_backend.logging import get_logger, log_context
from wisp_backend.logging_config import LoggingSettings
from wisp_backend.logging_output import configure_logging


def main() -> None:
    for level in ("OFF", "INFO", "DEBUG"):
        output = io.StringIO()
        runtime = configure_logging(LoggingSettings(format="json", level=level, queue_capacity=10000), output)
        logger = get_logger("wisp_backend.benchmark")
        started = time.perf_counter()
        for _ in range(1000):
            with log_context(operation="maintenance"):
                logger.debug("operation_started", fields=lambda: {"count": sum(range(10))})
                logger.info("operation_finished", fields={"duration_ms": 1})
        elapsed = time.perf_counter() - started
        runtime.close()
        print(
            json.dumps(
                {
                    "level": level,
                    "operations": 1000,
                    "producer_us_per_operation": round(elapsed * 1000, 3),
                    "bytes": len(output.getvalue().encode()),
                    "dropped": runtime.dropped,
                    "output_errors": runtime.output_errors,
                }
            )
        )


if __name__ == "__main__":
    main()
