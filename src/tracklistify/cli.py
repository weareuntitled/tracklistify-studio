# Standard library imports
import argparse
import asyncio
import os
import signal
import sys
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

from .config import ConfigError, get_config, get_root
from .core import ApplicationError, AsyncApp
from .utils.logger import get_logger, set_logger

# Get the logger for this module
logger = get_logger(__name__)


async def main(args: argparse.Namespace) -> int:
    """
    Main entry point for the async application.

    Returns:
        int: Process exit code (0 for success, >0 for error).
    """
    app: Optional[AsyncApp] = None

    try:
        # Load configuration (from env, config files etc.)
        config = get_config()

        # Create and run application
        app = AsyncApp(config)

        # Log selected CLI options for transparency
        logger.info(
            "Starting processing",
            extra={
                "input": args.input,
                "formats": getattr(args, "formats", None),
                "provider": getattr(args, "provider", None),
                "no_fallback": getattr(args, "no_fallback", None),
            },
        )

        # Setup signal handlers where supported
        def signal_handler() -> None:
            logger.info("Received shutdown signal")
            # Clean up gracefully, but do not block the signal handler
            if app is not None:
                asyncio.create_task(app.cleanup())

        try:
            # On Windows, add_signal_handler is not implemented
            if sys.platform != "win32":
                loop = asyncio.get_running_loop()
                for sig in (signal.SIGTERM, signal.SIGINT):
                    try:
                        loop.add_signal_handler(sig, signal_handler)
                    except NotImplementedError:
                        logger.debug(
                            "add_signal_handler not implemented for signal %s on this platform",
                            sig,
                        )
                        break
        except (RuntimeError, NotImplementedError) as e:
            # If there is no running loop yet or it's otherwise unsupported
            logger.debug("Signal handler setup skipped: %s", e)

        # Process the input (URL or file path)
        await app.process_input(args.input)

        return 0

    except ConfigError as e:
        logger.error("Configuration error: %s", e, exc_info=True)
        return 1
    except ApplicationError as e:
        logger.error("Application error: %s", e, exc_info=True)
        return 1
    except Exception as e:  # noqa: BLE001 - catch-all for CLI robustness
        logger.error("Unexpected error: %s", e, exc_info=True)
        return 1
    finally:
        if app is not None:
            # Make sure resources are released
            await app.close()


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    """
    Parse command line arguments.

    Args:
        argv: Optional argument list. If None, defaults to sys.argv[1:].

    Returns:
        argparse.Namespace: Parsed arguments.
    """
    parser = argparse.ArgumentParser(
        description="Identify tracks in a mix (file or stream)."
    )

    parser.add_argument(
        "input",
        help="Path to audio file or yt-dlp URL",
    )

    parser.add_argument(
        "-f",
        "--formats",
        default="all",
        choices=["json", "markdown", "m3u", "all"],
        help="Output format(s)",
    )

    parser.add_argument(
        "-p",
        "--provider",
        help="Specify the primary track identification provider",
    )

    parser.add_argument(
        "--no-fallback",
        action="store_true",
        help="Disable fallback to secondary providers",
    )

    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        help="Logging level",
    )

    parser.add_argument(
        "--log-file",
        default=None,
        type=Path,
        help="Log file path",
    )

    parser.add_argument(
        "-v",
        "--verbose",
        default=True,
        action="store_true",
        help="Enable verbose logging",
    )

    parser.add_argument(
        "-d",
        "--debug",
        default=False,
        action="store_true",
        help="Enable debug logging",
    )

    return parser.parse_args(argv)


def load_environment_variables(env_path: Path) -> None:
    """
    Load environment variables from a .env file if it exists.

    Only variables starting with TRACKLISTIFY_ are logged at debug level.
    """
    if env_path.exists():
        load_dotenv(env_path)
        logger.info("Loaded environment from %s", env_path)

        # Log loaded environment variables for debugging
        for key, value in os.environ.items():
            if key.startswith("TRACKLISTIFY_"):
                logger.debug("Loaded env var: %s=%s", key, value)


def cli() -> None:
    """
    Core CLI execution logic.

    Responsible for:
    - Argument parsing
    - Logger setup
    - Environment loading
    - Async main execution
    """
    args = parse_args()

    # Setup logging as early as possible
    set_logger(
        log_level=args.log_level,
        log_file=args.log_file,
        verbose=args.verbose,
        debug=args.debug,
    )

    logger.info("Starting CLI")

    # Load environment variables first (config, providers, etc.)
    env_path = get_root() / ".env"
    load_environment_variables(env_path)

    try:
        # asyncio.run creates and manages the event loop for us
        exit_code = asyncio.run(main(args))
        sys.exit(exit_code)
    except KeyboardInterrupt:
        logger.info("Operation cancelled by user")
        print("\nOperation cancelled by user")
        sys.exit(1)


if __name__ == "__main__":
    cli()
