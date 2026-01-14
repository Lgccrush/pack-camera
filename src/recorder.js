const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const cameraDetector = require('./utils/camera');

/**
 * 单个摄像头的持续录制器
 */
class CameraRecorder extends EventEmitter {
  constructor(camera, config) {
    super();
    this.camera = camera;
    this.config = config;
    this.process = null;
    this.isRecording = false;
    this.segments = []; // {filename, startTime, endTime}
    this.currentSegmentIndex = 0;

    // 确保临时目录存在
    this.tempDir = path.join(config.tempDir, camera.id);
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * 开始录制
   */
  start() {
    if (this.isRecording) {
      console.log(`[${this.camera.id}] 已经在录制中`);
      return;
    }

    this.isRecording = true;
    this.recordNextSegment();
    this.startCleanupTimer();

    console.log(`[${this.camera.id}] 开始持续录制`);
    this.emit('started', this.camera);
  }

  /**
   * 录制下一个片段
   */
  recordNextSegment() {
    if (!this.isRecording) return;

    const segmentIndex = this.currentSegmentIndex++;
    const filename = `segment_${Date.now()}_${segmentIndex}.mp4`;
    const filePath = path.join(this.tempDir, filename);
    const startTime = Date.now();

    const inputFormat = cameraDetector.getInputFormat();
    const inputPath = cameraDetector.getFFmpegInput(this.camera);

    // 构建 FFmpeg 参数
    const args = this.buildFFmpegArgs(inputFormat, inputPath, filePath);

    this.process = spawn('ffmpeg', args, { stdio: 'pipe' });

    // 监听错误
    this.process.stderr.on('data', (data) => {
      // 调试日志
      const msg = data.toString();
      if (msg.includes('error') || msg.includes('Error') || msg.includes('Invalid')) {
        console.error(`[${this.camera.id}] FFmpeg错误: ${msg}`);
      }
    });

    this.process.on('close', (code) => {
      const endTime = Date.now();

      // 记录片段信息
      if (fs.existsSync(filePath)) {
        this.segments.push({
          filename,
          filePath,
          startTime,
          endTime,
          duration: (endTime - startTime) / 1000
        });
        this.emit('segment', { camera: this.camera, segment: this.segments[this.segments.length - 1] });
      }

      // 继续录制下一个片段
      if (this.isRecording) {
        this.recordNextSegment();
      }
    });

    this.process.on('error', (err) => {
      console.error(`[${this.camera.id}] FFmpeg 错误:`, err.message);
      // 尝试重新开始
      if (this.isRecording) {
        setTimeout(() => this.recordNextSegment(), 1000);
      }
    });

    // 设置片段时长定时器
    setTimeout(() => {
      if (this.process && !this.process.killed) {
        this.process.kill('SIGTERM');
      }
    }, this.config.segmentDuration * 1000);
  }

  /**
   * 构建 FFmpeg 参数
   */
  buildFFmpegArgs(inputFormat, inputPath, outputPath) {
    const platform = process.platform;
    const args = ['-y'];

    // 输入参数
    if (platform === 'darwin') {
      // Mac: avfoundation 格式为 "视频索引:音频索引"，使用 -an 禁用音频
      args.push(
        '-f', inputFormat,
        '-framerate', '30',
        '-i', inputPath,
        '-an'  // 禁用音频
      );
    } else if (platform === 'win32') {
      args.push(
        '-f', inputFormat,
        '-video_size', `${this.config.videoWidth}x${this.config.videoHeight}`,
        '-framerate', this.config.frameRate.toString(),
        '-i', inputPath
      );
    } else {
      // Linux
      args.push(
        '-f', inputFormat,
        '-video_size', `${this.config.videoWidth}x${this.config.videoHeight}`,
        '-framerate', this.config.frameRate.toString(),
        '-i', inputPath
      );
    }

    // 输出参数 - 缩放到目标分辨率
    args.push(
      '-vf', `scale=${this.config.videoWidth}:${this.config.videoHeight}`,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '28',
      '-t', this.config.segmentDuration.toString(),
      outputPath
    );

    return args;
  }

  /**
   * 停止录制
   */
  stop() {
    this.isRecording = false;

    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    console.log(`[${this.camera.id}] 停止录制`);
    this.emit('stopped', this.camera);
  }

  /**
   * 启动清理定时器
   */
  startCleanupTimer() {
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldSegments();
    }, 5000);
  }

  /**
   * 清理超时的旧片段
   */
  cleanupOldSegments() {
    const maxAge = this.config.bufferSeconds * 1000;
    const now = Date.now();

    const toRemove = [];
    this.segments = this.segments.filter(segment => {
      const age = now - segment.endTime;
      if (age > maxAge) {
        toRemove.push(segment);
        return false;
      }
      return true;
    });

    // 删除文件
    for (const segment of toRemove) {
      try {
        if (fs.existsSync(segment.filePath)) {
          fs.unlinkSync(segment.filePath);
        }
      } catch (e) {
        // 忽略删除错误
      }
    }
  }

  /**
   * 获取指定时间范围内的片段
   * @param {number} startTime - 开始时间戳
   * @param {number} endTime - 结束时间戳
   * @returns {Array} - 片段列表
   */
  getSegmentsInRange(startTime, endTime) {
    return this.segments.filter(segment => {
      // 片段与时间范围有交集
      return segment.endTime >= startTime && segment.startTime <= endTime;
    }).sort((a, b) => a.startTime - b.startTime);
  }

  /**
   * 获取所有当前片段
   */
  getAllSegments() {
    return [...this.segments];
  }
}

/**
 * 多摄像头录制管理器
 */
class RecorderManager extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.recorders = new Map(); // cameraId -> CameraRecorder
    this.cameras = [];
  }

  /**
   * 初始化并启动所有摄像头的录制
   */
  async initialize() {
    // 检测摄像头
    this.cameras = await cameraDetector.detectCameras();
    console.log(`检测到 ${this.cameras.length} 个摄像头:`, this.cameras.map(c => c.name));

    if (this.cameras.length === 0) {
      console.warn('未检测到任何摄像头');
      return;
    }

    // 为每个摄像头创建录制器
    for (const camera of this.cameras) {
      const recorder = new CameraRecorder(camera, this.config);

      recorder.on('started', (cam) => this.emit('camera_started', cam));
      recorder.on('stopped', (cam) => this.emit('camera_stopped', cam));
      recorder.on('segment', (data) => this.emit('segment', data));

      this.recorders.set(camera.id, recorder);
    }

    this.emit('initialized', this.cameras);
  }

  /**
   * 启动所有录制器
   */
  startAll() {
    for (const recorder of this.recorders.values()) {
      recorder.start();
    }
    this.emit('all_started');
  }

  /**
   * 停止所有录制器
   */
  stopAll() {
    for (const recorder of this.recorders.values()) {
      recorder.stop();
    }
    this.emit('all_stopped');
  }

  /**
   * 获取指定摄像头的录制器
   */
  getRecorder(cameraId) {
    return this.recorders.get(cameraId);
  }

  /**
   * 获取所有摄像头信息
   */
  getCameras() {
    return this.cameras;
  }

  /**
   * 获取指定时间范围内所有摄像头的片段
   */
  getSegmentsInRange(startTime, endTime) {
    const result = {};
    for (const [cameraId, recorder] of this.recorders) {
      result[cameraId] = recorder.getSegmentsInRange(startTime, endTime);
    }
    return result;
  }

  /**
   * 获取系统状态
   */
  getStatus() {
    const cameraStatuses = [];
    for (const [cameraId, recorder] of this.recorders) {
      cameraStatuses.push({
        id: recorder.camera.id,
        name: recorder.camera.name,
        isRecording: recorder.isRecording,
        segmentCount: recorder.segments.length
      });
    }

    return {
      recording: Array.from(this.recorders.values()).some(r => r.isRecording),
      cameras: cameraStatuses
    };
  }
}

module.exports = RecorderManager;
module.exports.CameraRecorder = CameraRecorder;
