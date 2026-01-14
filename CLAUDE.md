# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Order packing video recording system (订单打包视频记录系统) - A Node.js application that continuously records from connected cameras and generates video clips for order packing sessions.

## Commands

```bash
npm start         # Start the server (production)
npm run dev       # Start with --watch for development (auto-reload on changes)
```

**Prerequisites**: FFmpeg must be installed and available in PATH.

## Architecture

### Core Modules (src/)

- **index.js** - Entry point; loads config, initializes all modules, handles graceful shutdown
- **server.js** - Express HTTP API server + WebSocket server for real-time updates
- **recorder.js** - Contains `CameraRecorder` (single camera) and `RecorderManager` (multi-camera orchestration); continuously records video in segments to temp directory
- **session-manager.js** - Manages packing session lifecycle (start/end/complete/fail); emits events for video generation
- **video-generator.js** - Async queue that concatenates video segments using FFmpeg when sessions end
- **stream-server.js** - MJPEG streaming server for web preview; parses JPEG frames from FFmpeg output

### Utilities (src/utils/)

- **camera.js** - Cross-platform camera detection (AVFoundation on Mac, DirectShow on Windows, V4L2 on Linux)
- **ffmpeg.js** - FFmpeg wrapper for video operations (concat, trim, duration)

### Data Flow

1. `RecorderManager` continuously records all cameras in 5-second segments (configurable)
2. When packing starts via API, `SessionManager` creates a session with timestamp
3. When packing ends, `SessionManager` waits `postPackSeconds`, then emits `session_end`
4. `VideoGenerator` listens for `session_end`, fetches relevant segments, concatenates them with FFmpeg
5. Final MP4 files are saved to `./videos/` directory

### Configuration (config.json)

- `port` - HTTP server port (default: 3000)
- `bufferSeconds` - How long to keep segments in memory (default: 30)
- `segmentDuration` - Length of each recording segment (default: 5)
- `prePackSeconds` / `postPackSeconds` - Video padding before/after packing (default: 10 each)
- `videoOutput` / `tempDir` - Output directories

### API Endpoints

- `POST /api/pack/start/:orderId` - Start packing session
- `POST /api/pack/end/:orderId` - End packing session (triggers video generation)
- `GET /api/status` - System status
- `GET /api/videos` - List generated videos
- `GET /stream/:cameraId` - MJPEG stream for camera preview

### WebSocket Events (ws://localhost:3000/ws)

Events: `session_start`, `session_completed`, `session_failed`, `camera_started`, `video_generated`
