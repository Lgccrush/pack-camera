# 订单打包视频记录系统 / Order Packing Video Recorder

[中文](#中文) | [English](#english)

---

## 中文

### 简介

订单打包视频记录系统是一个基于 Node.js 的应用，用于在订单打包过程中自动录制视频。系统会持续录制所有连接的摄像头，当打包会话结束时，自动生成包含打包前后时间段的视频文件。

### 功能特点

- 多摄像头支持（自动检测）
- 持续录制，循环缓冲
- 打包会话管理
- 自动生成打包视频（包含打包前后各 10 秒）
- Web 界面实时预览
- WebSocket 实时状态推送
- 跨平台支持（Mac / Windows / Linux）

### 系统要求

- Node.js 16+
- FFmpeg（必须安装并添加到 PATH）

### 安装

```bash
# 克隆项目
git clone <repository-url>
cd pack-video-recorder

# 安装依赖
npm install
```

### 配置

编辑 `config.json` 文件：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| port | HTTP 服务端口 | 3000 |
| bufferSeconds | 视频缓冲时长（秒） | 30 |
| segmentDuration | 录制片段时长（秒） | 5 |
| prePackSeconds | 打包前录制时长（秒） | 10 |
| postPackSeconds | 打包后录制时长（秒） | 10 |
| videoOutput | 视频输出目录 | ./videos |
| tempDir | 临时文件目录 | ./temp |

### 使用

```bash
# 启动服务
npm start

# 开发模式（自动重载）
npm run dev
```

启动后访问 `http://localhost:3000` 打开 Web 界面。

### API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/pack/start/:orderId | 开始打包会话 |
| POST | /api/pack/end/:orderId | 结束打包会话 |
| GET | /api/status | 获取系统状态 |
| GET | /api/videos | 获取视频列表 |
| GET | /api/cameras | 获取摄像头列表 |
| DELETE | /api/videos/:filename | 删除视频 |
| GET | /stream/:cameraId | 摄像头实时流 |

---

## English

### Introduction

Order Packing Video Recorder is a Node.js application that automatically records video during order packing processes. The system continuously records from all connected cameras and generates video files covering the packing period (including before and after) when a packing session ends.

### Features

- Multi-camera support (auto-detection)
- Continuous recording with circular buffer
- Packing session management
- Automatic video generation (10 seconds before and after packing)
- Web interface with real-time preview
- WebSocket real-time status updates
- Cross-platform support (Mac / Windows / Linux)

### Requirements

- Node.js 16+
- FFmpeg (must be installed and added to PATH)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd pack-video-recorder

# Install dependencies
npm install
```

### Configuration

Edit `config.json`:

| Parameter | Description | Default |
|-----------|-------------|---------|
| port | HTTP server port | 3000 |
| bufferSeconds | Video buffer duration (seconds) | 30 |
| segmentDuration | Recording segment duration (seconds) | 5 |
| prePackSeconds | Pre-packing record duration (seconds) | 10 |
| postPackSeconds | Post-packing record duration (seconds) | 10 |
| videoOutput | Video output directory | ./videos |
| tempDir | Temporary files directory | ./temp |

### Usage

```bash
# Start the server
npm start

# Development mode (auto-reload)
npm run dev
```

Open `http://localhost:3000` in your browser after starting.

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/pack/start/:orderId | Start packing session |
| POST | /api/pack/end/:orderId | End packing session |
| GET | /api/status | Get system status |
| GET | /api/videos | Get video list |
| GET | /api/cameras | Get camera list |
| DELETE | /api/videos/:filename | Delete video |
| GET | /stream/:cameraId | Camera live stream |

### WebSocket

Connect to `ws://localhost:3000/ws` for real-time updates.

Events:
- `connected` - Initial connection with camera list
- `session_start` - Packing session started
- `session_completed` - Video generation completed
- `session_failed` - Video generation failed
- `video_generated` - New video available

---

## License

MIT
