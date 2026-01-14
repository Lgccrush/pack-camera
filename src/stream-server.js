const { spawn } = require('child_process');
const cameraDetector = require('./utils/camera');

/**
 * MJPEG 流服务
 * 为 Web 界面提供摄像头实时预览
 */
class StreamServer {
  constructor(config, recorderManager) {
    this.config = config;
    this.recorderManager = recorderManager;
    this.streams = new Map(); // cameraId -> {process, clients}
  }

  /**
   * 处理流请求
   * @param {string} cameraId - 摄像头ID
   * @param {object} res - HTTP 响应对象
   */
  handleStreamRequest(cameraId, res) {
    const cameras = this.recorderManager.getCameras();
    const camera = cameras.find(c => c.id === cameraId);

    if (!camera) {
      res.status(404).send('摄像头未找到');
      return;
    }

    // 设置 MJPEG 响应头
    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Pragma': 'no-cache'
    });

    // 获取或创建流
    let stream = this.streams.get(cameraId);
    if (!stream) {
      stream = this.createStream(camera);
      this.streams.set(cameraId, stream);
    }

    // 添加客户端
    stream.clients.add(res);

    // 客户端断开连接时移除
    res.on('close', () => {
      stream.clients.delete(res);

      // 如果没有客户端了，停止流
      if (stream.clients.size === 0) {
        this.stopStream(cameraId);
      }
    });
  }

  /**
   * 创建摄像头流
   */
  createStream(camera) {
    const inputFormat = cameraDetector.getInputFormat();
    const inputPath = cameraDetector.getFFmpegInput(camera);

    const args = this.buildFFmpegArgs(inputFormat, inputPath);

    const process = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const stream = {
      process,
      clients: new Set(),
      buffer: Buffer.alloc(0)
    };

    // 处理输出数据
    process.stdout.on('data', (data) => {
      // 将数据追加到缓冲区
      stream.buffer = Buffer.concat([stream.buffer, data]);

      // 查找 JPEG 帧边界
      let start = 0;
      let end = 0;

      while (true) {
        // 查找 JPEG 开始标记 (FFD8)
        start = this.findJpegStart(stream.buffer, end);
        if (start === -1) break;

        // 查找 JPEG 结束标记 (FFD9)
        end = this.findJpegEnd(stream.buffer, start + 2);
        if (end === -1) break;

        // 提取完整的 JPEG 帧
        const frame = stream.buffer.slice(start, end + 2);

        // 发送给所有客户端
        this.sendFrameToClients(stream.clients, frame);

        // 从缓冲区移除已处理的数据
        stream.buffer = stream.buffer.slice(end + 2);
        end = 0;
      }

      // 防止缓冲区过大
      if (stream.buffer.length > 1024 * 1024) {
        stream.buffer = Buffer.alloc(0);
      }
    });

    process.stderr.on('data', (data) => {
      // 可以添加调试日志
      // console.log(`[Stream ${camera.id}] FFmpeg: ${data.toString()}`);
    });

    process.on('close', (code) => {
      console.log(`[Stream] 摄像头 ${camera.id} 流已关闭`);
      this.streams.delete(camera.id);
    });

    process.on('error', (err) => {
      console.error(`[Stream] 摄像头 ${camera.id} 错误:`, err.message);
    });

    console.log(`[Stream] 开始摄像头 ${camera.id} 流`);

    return stream;
  }

  /**
   * 构建 FFmpeg 参数（输出 MJPEG）
   */
  buildFFmpegArgs(inputFormat, inputPath) {
    const platform = process.platform;
    const args = [];

    // 输入参数
    if (platform === 'darwin') {
      // Mac: avfoundation 使用设备索引，用 -an 禁用音频
      args.push(
        '-f', inputFormat,
        '-framerate', '30',
        '-i', inputPath,
        '-an'
      );
    } else if (platform === 'win32') {
      args.push(
        '-f', inputFormat,
        '-video_size', `${this.config.videoWidth}x${this.config.videoHeight}`,
        '-framerate', '15',
        '-i', inputPath
      );
    } else {
      // Linux
      args.push(
        '-f', inputFormat,
        '-video_size', `${this.config.videoWidth}x${this.config.videoHeight}`,
        '-framerate', '15',
        '-i', inputPath
      );
    }

    // 输出 MJPEG - 缩放并转换
    args.push(
      '-vf', `scale=${this.config.videoWidth}:${this.config.videoHeight}`,
      '-f', 'mjpeg',
      '-q:v', '5',
      '-r', '10',
      '-'
    );

    return args;
  }

  /**
   * 查找 JPEG 开始标记
   */
  findJpegStart(buffer, offset) {
    for (let i = offset; i < buffer.length - 1; i++) {
      if (buffer[i] === 0xFF && buffer[i + 1] === 0xD8) {
        return i;
      }
    }
    return -1;
  }

  /**
   * 查找 JPEG 结束标记
   */
  findJpegEnd(buffer, offset) {
    for (let i = offset; i < buffer.length - 1; i++) {
      if (buffer[i] === 0xFF && buffer[i + 1] === 0xD9) {
        return i;
      }
    }
    return -1;
  }

  /**
   * 发送帧给所有客户端
   */
  sendFrameToClients(clients, frame) {
    const header = Buffer.from(
      `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`
    );

    for (const client of clients) {
      try {
        client.write(header);
        client.write(frame);
        client.write(Buffer.from('\r\n'));
      } catch (e) {
        // 客户端可能已断开
      }
    }
  }

  /**
   * 停止指定摄像头的流
   */
  stopStream(cameraId) {
    const stream = this.streams.get(cameraId);
    if (stream) {
      if (stream.process && !stream.process.killed) {
        stream.process.kill('SIGTERM');
      }
      this.streams.delete(cameraId);
      console.log(`[Stream] 停止摄像头 ${cameraId} 流`);
    }
  }

  /**
   * 停止所有流
   */
  stopAll() {
    for (const cameraId of this.streams.keys()) {
      this.stopStream(cameraId);
    }
  }

  /**
   * 获取活跃流数量
   */
  getActiveStreamCount() {
    return this.streams.size;
  }
}

module.exports = StreamServer;
