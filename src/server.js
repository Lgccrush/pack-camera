const express = require('express');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');

/**
 * HTTP API 服务和 WebSocket 服务
 */
class Server {
  constructor(config, recorderManager, sessionManager, videoGenerator, streamServer) {
    this.config = config;
    this.recorderManager = recorderManager;
    this.sessionManager = sessionManager;
    this.videoGenerator = videoGenerator;
    this.streamServer = streamServer;

    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = null;
    this.clients = new Set();

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.setupEventForwarding();
  }

  /**
   * 设置中间件
   */
  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, '../public')));

    // 视频文件静态服务
    this.app.use('/videos', express.static(this.config.videoOutput));

    // CORS
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });
  }

  /**
   * 设置路由
   */
  setupRoutes() {
    // 系统状态
    this.app.get('/api/status', (req, res) => {
      const recorderStatus = this.recorderManager.getStatus();
      const activeSessions = this.sessionManager.getActiveSessions();

      res.json({
        ...recorderStatus,
        activeSessions,
        streamCount: this.streamServer.getActiveStreamCount(),
        wsClients: this.clients.size
      });
    });

    // 打包开始
    this.app.post('/api/pack/start/:orderId', (req, res) => {
      const { orderId } = req.params;

      if (!orderId || orderId.trim() === '') {
        return res.status(400).json({
          success: false,
          error: '订单ID不能为空'
        });
      }

      const result = this.sessionManager.startSession(orderId.trim());
      res.json(result);
    });

    // 打包结束
    this.app.post('/api/pack/end/:orderId', (req, res) => {
      const { orderId } = req.params;

      if (!orderId || orderId.trim() === '') {
        return res.status(400).json({
          success: false,
          error: '订单ID不能为空'
        });
      }

      const result = this.sessionManager.endSession(orderId.trim());

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json({
        success: true,
        orderId: result.orderId,
        startTime: result.startTime,
        endTime: result.endTime,
        message: `等待 ${result.waitSeconds} 秒后开始生成视频...`
      });
    });

    // 获取会话信息
    this.app.get('/api/session/:orderId', (req, res) => {
      const { orderId } = req.params;
      const session = this.sessionManager.getSession(orderId);

      if (!session) {
        return res.status(404).json({
          success: false,
          error: '会话不存在'
        });
      }

      res.json({
        success: true,
        session
      });
    });

    // 活跃会话列表
    this.app.get('/api/sessions/active', (req, res) => {
      res.json({
        success: true,
        sessions: this.sessionManager.getActiveSessions()
      });
    });

    // 已完成会话列表
    this.app.get('/api/sessions/completed', (req, res) => {
      res.json({
        success: true,
        sessions: this.sessionManager.getCompletedSessions()
      });
    });

    // 视频列表
    this.app.get('/api/videos', (req, res) => {
      const videos = this.videoGenerator.getVideoList();
      res.json({
        success: true,
        videos
      });
    });

    // 删除视频
    this.app.delete('/api/videos/:filename', (req, res) => {
      const { filename } = req.params;

      try {
        this.videoGenerator.deleteVideo(filename);
        res.json({
          success: true,
          message: '视频已删除'
        });
      } catch (error) {
        res.status(400).json({
          success: false,
          error: error.message
        });
      }
    });

    // 摄像头实时流
    this.app.get('/stream/:cameraId', (req, res) => {
      const { cameraId } = req.params;
      this.streamServer.handleStreamRequest(cameraId, res);
    });

    // 摄像头列表
    this.app.get('/api/cameras', (req, res) => {
      const cameras = this.recorderManager.getCameras();
      res.json({
        success: true,
        cameras: cameras.map(c => ({
          id: c.id,
          name: c.name
        }))
      });
    });
  }

  /**
   * 设置 WebSocket
   */
  setupWebSocket() {
    this.wss = new WebSocket.Server({ server: this.server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      console.log(`[WS] 客户端连接, 当前: ${this.clients.size}`);

      // 发送初始状态
      ws.send(JSON.stringify({
        type: 'connected',
        data: {
          cameras: this.recorderManager.getCameras().map(c => ({ id: c.id, name: c.name })),
          status: this.recorderManager.getStatus()
        }
      }));

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`[WS] 客户端断开, 当前: ${this.clients.size}`);
      });

      ws.on('error', (err) => {
        console.error('[WS] 错误:', err.message);
        this.clients.delete(ws);
      });
    });
  }

  /**
   * 设置事件转发到 WebSocket
   */
  setupEventForwarding() {
    // 会话事件
    this.sessionManager.on('session_start', (session) => {
      this.broadcast({
        type: 'session_start',
        data: {
          orderId: session.orderId,
          startTime: new Date(session.startTime).toISOString()
        }
      });
    });

    this.sessionManager.on('session_completed', (data) => {
      this.broadcast({
        type: 'session_completed',
        data: {
          orderId: data.orderId,
          videoFiles: data.videoFiles
        }
      });
    });

    this.sessionManager.on('session_failed', (data) => {
      this.broadcast({
        type: 'session_failed',
        data: {
          orderId: data.orderId,
          error: data.error
        }
      });
    });

    // 录制事件
    this.recorderManager.on('camera_started', (camera) => {
      this.broadcast({
        type: 'camera_started',
        data: { id: camera.id, name: camera.name }
      });
    });

    // 视频生成事件
    this.videoGenerator.on('generated', (data) => {
      this.broadcast({
        type: 'video_generated',
        data
      });
    });
  }

  /**
   * 广播消息给所有 WebSocket 客户端
   */
  broadcast(message) {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(data);
        } catch (e) {
          // 忽略发送错误
        }
      }
    }
  }

  /**
   * 启动服务器
   */
  start() {
    return new Promise((resolve) => {
      this.server.listen(this.config.port, () => {
        console.log(`[Server] HTTP 服务启动: http://localhost:${this.config.port}`);
        console.log(`[Server] WebSocket 服务启动: ws://localhost:${this.config.port}/ws`);
        resolve();
      });
    });
  }

  /**
   * 停止服务器
   */
  stop() {
    return new Promise((resolve) => {
      // 关闭所有 WebSocket 连接
      for (const client of this.clients) {
        client.close();
      }

      this.server.close(() => {
        console.log('[Server] 服务器已停止');
        resolve();
      });
    });
  }
}

module.exports = Server;
