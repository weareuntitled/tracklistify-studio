# tracklistify/core/app.py

# Standard library imports
import asyncio
import concurrent.futures
import traceback
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple

# Local/package imports
from tracklistify.config.factory import get_config
from tracklistify.core.exceptions import DownloadError, ValidationError
from tracklistify.core.track import Track
from tracklistify.core.types import AudioSegment
from tracklistify.downloaders import DownloaderFactory
from tracklistify.exporters import TracklistOutput
from tracklistify.providers.factory import create_provider_factory
from tracklistify.utils.identification import IdentificationManager
from tracklistify.utils.logger import get_logger
from tracklistify.utils.strings import sanitizer
from tracklistify.utils.validation import validate_input

logger = get_logger(__name__)


class AsyncApp:
    """Main application logic container"""

    def __init__(self, config=None):
        # Always refresh config
        self.config = config or get_config(force_refresh=True)
        self.provider_factory = create_provider_factory()
        self.downloader_factory = DownloaderFactory()
        self.logger = get_logger(__name__)
        self.shutdown_event = asyncio.Event()
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=4)
        self.mix_metadata: dict = {}

        # Always recreate identification_manager with fresh config
        self.identification_manager = IdentificationManager(
            config=self.config, provider_factory=self.provider_factory
        )

    def shutdown(self) -> None:
        """Shutdown the application gracefully."""
        self.logger.info("Shutting down...")
        self.shutdown_event.set()
        self.executor.shutdown(wait=True)

    async def process_input(self, input_path: str):
        """Process input URL or file path."""
        try:
            local_path, source_path = await self._prepare_input(input_path)

            # Keep a reference for output metadata
            self.source_path = source_path

            self.logger.info("Processing audio...")

            # Process the downloaded file
            audio_segments = self.split_audio(local_path)
            if not audio_segments:
                raise ValueError("No audio segments were created")

            self.logger.info(f"Created {len(audio_segments)} audio segments")

            # Identify tracks in audio segments
            self.logger.info("Identifying tracks...")
            tracks = await self.identification_manager.identify_tracks(audio_segments)
            if not tracks:
                context = {
                    "segments_created": len(audio_segments),
                    "input_path": source_path,
                    "file_duration": getattr(self, "duration", "unknown"),
                }
                raise TrackIdentificationError(
                    f"No tracks were identified in the audio file. "
                    f"Created {len(audio_segments)} segments but no matches found. "
                    f"This could be due to poor audio quality, instrumental music, "
                    f"or unsupported audio content.",
                    context=context,
                )

            self.logger.info(f"Identified {len(tracks)} tracks")
            self.logger.debug(f"Tracks: {tracks}")

            # Only save if we have identified tracks
            self.logger.info("Saving output...")
            if len(tracks) > 0:
                await self.save_output(tracks, self.config.output_format)
            else:
                raise ValueError(
                    "No tracks were successfully identified with sufficient confidence"
                )

        except Exception as e:
            self.logger.error(f"Failed to process input: {e}")
            if self.config.debug:
                self.logger.error(traceback.format_exc())
            raise
        finally:
            # Always clean up temporary files
            await self.cleanup()

    def _build_mix_info(self, title: str, tracks: List["Track"]) -> dict:
        """Assemble mix metadata used by exporters."""

        mix_info = {
            "title": sanitizer(title) if title else "Unknown Mix",
            "date": datetime.now().strftime("%Y-%m-%d"),
        }

        # Prefer artist/uploader information from download metadata
        artist = (
            getattr(self, "uploader", None)
            or self.mix_metadata.get("uploader")
            or self.mix_metadata.get("artist")
        )
        if artist:
            mix_info["artist"] = sanitizer(artist)

        # yt-dlp upload_date is in YYYYMMDD format – normalize if present
        upload_date = self.mix_metadata.get("upload_date")
        if isinstance(upload_date, str) and len(upload_date) == 8:
            mix_info["date"] = f"{upload_date[0:4]}-{upload_date[4:6]}-{upload_date[6:8]}"

        duration = self.mix_metadata.get("duration") or getattr(self, "duration", None)
        if duration:
            mix_info["duration"] = duration

        if hasattr(self, "source_path"):
            mix_info["source"] = self.source_path

        # Include a simple analysis summary
        mix_info["track_count"] = len(tracks)

        return mix_info

    async def _prepare_input(self, input_path: str) -> Tuple[str, str]:
        """Validate, download (if needed) and normalize the input source."""

        # Reset any stale metadata before handling a new input
        self.mix_metadata = {}
        self.original_title = None
        self.duration = None
        self.uploader = None

        result = validate_input(input_path)
        if not result:
            raise ValidationError("Input must be a valid URL or existing audio file")

        validated_path, is_local_file = result

        # Local file requires no download – just record minimal metadata
        if is_local_file:
            self.logger.info(f"Using local file: {sanitizer(validated_path)}")
            self.original_title = Path(validated_path).stem
            return validated_path, validated_path

        # Remote URL: pick downloader and fetch the audio
        self.logger.info(f"Downloading from: {sanitizer(validated_path)}")
        try:
            downloader = self.downloader_factory.create_downloader(validated_path)
        except ValueError as exc:  # Unsupported URL format
            raise ValidationError(
                f"Unsupported or unrecognized URL: {sanitizer(validated_path)}"
            ) from exc

        try:
            downloaded_path = await downloader.download(validated_path)
        except Exception as exc:  # noqa: BLE001 - surface download errors
            raise DownloadError(
                f"Failed to download audio from {sanitizer(validated_path)}",
                url=validated_path,
                cause=exc,
            ) from exc

        if not downloaded_path:
            raise DownloadError(
                f"Downloader returned no file path for {sanitizer(validated_path)}",
                url=validated_path,
            )

        # Persist metadata gathered during download for later output
        self.mix_metadata = downloader.get_last_metadata() or {}
        self.original_title = getattr(downloader, "title", None) or Path(
            downloaded_path
        ).stem
        self.duration = getattr(downloader, "duration", None)
        self.uploader = getattr(downloader, "uploader", None)

        return downloaded_path, validated_path

    def split_audio(self, file_path: str) -> List[AudioSegment]:
        """Split audio file into overlapping segments for analysis."""
        self.logger.info(f"Splitting audio file: {file_path}")
        self.logger.debug(
            f"Config values: segment_length={self.config.segment_length}, "
            f"overlap_duration={self.config.overlap_duration}"
        )

        import os
        import subprocess
        from concurrent.futures import ThreadPoolExecutor
        from pathlib import Path

        from mutagen._file import File

        audio = File(file_path)
        if audio is None:
            self.logger.error(f"Could not read audio file: {file_path}")
            return []

        try:
            duration = audio.info.length  # Duration in seconds

        except AttributeError:
            self.logger.error("Could not determine audio duration")
            return []

        # Get configuration for segmentation from instance
        segment_duration = self.config.segment_length
        overlap_duration = self.config.overlap_duration
        step = segment_duration - overlap_duration

        # Create temp directory for segments
        temp_dir = Path(self.config.temp_dir)
        temp_dir.mkdir(parents=True, exist_ok=True)

        # Optimize ffmpeg settings for faster processing
        base_cmd = [
            "ffmpeg",
            "-hide_banner",
            "-nostdin",  # Force non-interactive mode
            "-loglevel",
            "error",
            "-i",
            file_path,
            "-vn",  # Skip video processing
            "-ar",
            "44100",  # Standard sample rate
            "-ac",
            "2",  # Stereo
            "-c:a",
            "libmp3lame",  # Use MP3 encoder
            "-q:a",
            "5",  # Variable bitrate quality (0-9, lower is better)
            "-map",
            "0:a",  # Only process audio stream
            "-threads",
            str(os.cpu_count()),  # Use all CPU cores
        ]

        # Generate segment parameters
        segment_params = []
        current_time = 0

        while current_time < duration:
            segment_length = min(segment_duration, duration - current_time)
            segment_file = (
                temp_dir / f"segment_{current_time:.0f}_{segment_length:.0f}.mp3"
            )

            # Add small padding to improve recognition
            start_time = max(0, current_time - 0.5)
            end_time = min(duration, current_time + segment_length + 0.5)
            actual_length = end_time - start_time

            segment_params.append(
                {
                    "start_time": current_time,
                    "length": segment_length,
                    "file": segment_file,
                    "cmd": base_cmd
                    + [
                        "-ss",
                        str(start_time),
                        "-t",
                        str(actual_length),
                        "-y",
                        str(segment_file),
                    ],
                }
            )

            current_time += step

        def create_segment(params):
            """Create a single audio segment using ffmpeg."""
            try:
                if params["file"].exists():
                    # Skip if file already exists and has content
                    if params["file"].stat().st_size > 1000:
                        return AudioSegment(
                            file_path=str(params["file"]),
                            start_time=int(params["start_time"]),
                            duration=int(params["length"]),
                        )

                result = subprocess.run(
                    params["cmd"], capture_output=True, text=True, check=True
                )
                self.logger.debug(f"FFmpeg output: {result.stdout}")

                if params["file"].exists() and params["file"].stat().st_size > 1000:
                    return AudioSegment(
                        file_path=str(params["file"]),
                        start_time=int(params["start_time"]),
                        duration=int(params["length"]),
                    )
                else:
                    self.logger.error(
                        f"Failed to create segment at {params['start_time']}s: "
                        f"Output file is missing or too small"
                    )
                    return None

            except subprocess.CalledProcessError as e:
                self.logger.error(
                    f"Failed to create segment at {params['start_time']}s: {e.stderr}"
                )
                return None

            except Exception as e:
                self.logger.error(
                    f"Error creating segment at {params['start_time']}s: {e}"
                )
                return None

        # Process segments in parallel using ThreadPoolExecutor
        segments = []
        try:
            # Ensure os.cpu_count() does not return None
            cpu_count = os.cpu_count()
            if cpu_count is None:
                raise ValueError("os.cpu_count() returned None")

            # Use more workers for better parallelization
            max_workers = min(cpu_count * 2, len(segment_params))
            self.logger.debug(f"Processing segments with {max_workers} workers")

            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                # Submit all tasks and gather results
                future_segments = list(executor.map(create_segment, segment_params))

                # Filter out failed segments
                segments = [seg for seg in future_segments if seg is not None]

            self.logger.info(f"Split audio into {len(segments)} segments")
            return segments

        except Exception as e:
            self.logger.error(f"Failed to process segments: {e}")
            return []

    async def save_output(self, tracks: List["Track"], format: str):
        """Save identified tracks to output files.

        Args:
            tracks: List of identified tracks
            format: Output format (json, markdown, m3u)

        Raises:
            ValueError: If tracks list is empty
        """
        if len(tracks) == 0:
            logger.error("Cannot save output: No tracks provided")
            return

        # Get title from the original title or use a default
        title = getattr(self, "original_title", None)
        if not title:
            # Try to construct a title from the first track
            if tracks and tracks[0].artist and tracks[0].song_name:
                title = f"{tracks[0].artist} - {tracks[0].song_name}"
            else:
                title = "Identified Mix"

        # Prepare mix info using the downloaded title
        mix_info = self._build_mix_info(title, tracks)

        try:
            # Create output handler
            output = TracklistOutput(mix_info=mix_info, tracks=tracks)

            # Save in specified format
            if format == "all":
                saved_files = output.save_all()
                if saved_files:
                    for file in saved_files:
                        logger.debug(f"Saved tracklist to: {file}")
                else:
                    logger.error("Failed to save tracklist in any format")
            else:
                if saved_file := output.save(format):
                    logger.info(f"Saved {format} tracklist to: {saved_file}")
                else:
                    logger.error(f"Failed to save tracklist in format: {format}")

        except Exception as e:
            logger.error(f"Error saving tracklist: {e}")
            if self.config.debug:
                logger.error(traceback.format_exc())

    async def cleanup(self):
        """Cleanup resources"""
        try:
            # Clean up temp directory
            temp_dir = Path(self.config.temp_dir)
            if temp_dir.exists():
                # First try to remove all files
                for file in temp_dir.glob("*"):
                    try:
                        if file.is_file():
                            file.unlink()
                            self.logger.debug(f"Removed temporary file: {file}")
                        elif file.is_dir():
                            import shutil

                            shutil.rmtree(file)
                            self.logger.debug(f"Removed temporary directory: {file}")
                    except Exception as e:
                        self.logger.warning(f"Failed to remove {file}: {e}")

                # Try to remove the directory itself
                try:
                    # Use rmtree instead of rmdir to handle any remaining files
                    import shutil

                    shutil.rmtree(temp_dir)
                    self.logger.debug("Removed temporary directory")
                except Exception as e:
                    self.logger.debug(f"Could not remove temp directory: {e}")
                    # If rmtree fails, try to at least remove empty directory
                    try:
                        temp_dir.rmdir()
                    except Exception:
                        pass
        except Exception as e:
            self.logger.warning(f"Error during cleanup: {e}")

        # Clean up other resources
        try:
            if hasattr(self.identification_manager, "close"):
                await self.identification_manager.close()
        except Exception as e:
            self.logger.warning(f"Error cleaning up identification manager: {e}")

    async def close(self):
        """Cleanup resources."""
        await self.cleanup()


class ApplicationError(Exception):
    """Base application error."""

    pass


class TrackIdentificationError(ApplicationError):
    """Raised when track identification fails or produces no results."""

    def __init__(self, message: str, context: dict = None):
        super().__init__(message)
        self.context = context or {}
