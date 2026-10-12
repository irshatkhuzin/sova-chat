# Images and short videos

The widget and Android SDK accept PNG, JPEG, WebP, GIF, MP4, and WebM.
Images are limited by `MAX_UPLOAD_BYTES` (5 MiB by default) and 20 megapixels.
Video limits are 32 MiB, 60 seconds, and 4K. GIF analysis uses the first frame.

## Processing and AI

FFprobe/FFmpeg validate content and prepare JPEG frames. Videos are sampled near
the beginning, middle, and end; events between sampled frames can be missed.
Audio is not sent to AI. Users can play the original with audio when present.
If a chosen frame cannot be extracted, processing falls back to an available frame.

The support agent receives up to three recent customer attachments within the
20-message context window: up to nine images, resized to a maximum dimension of
1600 pixels. Knowledge retrieval still uses the text question, so ask users to
describe the problem alongside media.

A support model accepting `image_url` in Chat Completions is required. Missing
vision support or analysis failure can trigger operator handoff. Screening and
translation roles receive text only. Cached frames avoid repeated processing,
but sending them to a provider again can incur input-token costs.

## Storage and access

Originals and derived frames are private under `STORAGE_LOCAL_DIR`.
Do not serve that directory directly. File API access checks session and
conversation ownership; session tokens should not appear in URLs.
The panel supports byte-range requests for video playback.

## Installation

Install FFmpeg and FFprobe on the server. On Debian/Ubuntu:

```sh
sudo apt-get install --no-install-recommends ffmpeg
```

Override paths with `FFMPEG_PATH` and `FFPROBE_PATH` when needed.
Use `client_max_body_size 33m` in the Sova nginx block. Application limits still
apply. Media processing is queued with bounded concurrency and timeouts;
corrupt files are rejected before permanent storage.

## Verification

Use a disposable installation and synthetic media to check uploads, private access,
video playback, and provider failure. See [testing](TESTING.md). Actual image
recognition quality depends on the model and should be evaluated separately.
