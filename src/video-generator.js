const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const EventEmitter = require('events');

/**
 * 视频生成器
 * 异步拼接视频片段，生成最终 MP4 文件
 */
class VideoGenerator extends EventEmitter {
  constructor(config, recorderManager, sessionManager) {
    super();
    this.config = config;
    this.recorderManager = recorderManager;
    this.sessionManager = sessionManager;
    this.queue = []; // 生成队列
    this.isProcessing = false;

    // 确保输出目录存在
    if (!fs.existsSync(config.videoOutput)) {
      fs.mkdirSync(config.videoOutput, { recursive: true });
    }

    // 监听会话结束事件
    this.sessionManager.on('session_end', (data) => {
      this.enqueue(data);
    });
  }

  /**
   * 将任务添加到队列
   */
  enqueue(data) {
    this.queue.push(data);
    this.processQueue();
  }

  /**
   * 处理队列
   */
  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const task = this.queue.shift();

    try {
      const videoFiles = await this.generateVideos(task);
      this.sessionManager.markCompleted(task.session.orderId, videoFiles);
      this.emit('generated', {
        orderId: task.session.orderId,
        videoFiles
      });
    } catch (error) {
      console.error(`[VideoGenerator] 生成失败:`, error.message);
      this.sessionManager.markFailed(task.session.orderId, error.message);
      this.emit('failed', {
        orderId: task.session.orderId,
        error: error.message
      });
    }

    this.isProcessing = false;
    this.processQueue();
  }

  /**
   * 为所有摄像头生成视频
   */
  async generateVideos(task) {
    const { session, videoStartTime, videoEndTime } = task;
    const cameras = this.recorderManager.getCameras();
    const videoFiles = [];

    console.log(`[VideoGenerator] 开始生成视频: ${session.orderId}`);

    for (const camera of cameras) {
      try {
        const videoFile = await this.generateVideoForCamera(
          camera,
          session.orderId,
          videoStartTime,
          videoEndTime
        );

        if (videoFile) {
          videoFiles.push(videoFile);
        }
      } catch (error) {
        console.error(`[VideoGenerator] 摄像头 ${camera.id} 生成失败:`, error.message);
      }
    }

    return videoFiles;
  }

  /**
   * 为单个摄像头生成视频
   */
  async generateVideoForCamera(camera, orderId, startTime, endTime) {
    const recorder = this.recorderManager.getRecorder(camera.id);
    if (!recorder) {
      throw new Error(`未找到摄像头 ${camera.id} 的录制器`);
    }

    // 获取时间范围内的片段
    const segments = recorder.getSegmentsInRange(startTime, endTime);

    if (segments.length === 0) {
      console.warn(`[VideoGenerator] 摄像头 ${camera.id} 没有找到可用片段`);
      return null;
    }

    console.log(`[VideoGenerator] 摄像头 ${camera.id} 找到 ${segments.length} 个片段`);

    // 生成输出文件名
    const timestamp = Date.now();
    const outputFilename = `${orderId}_${camera.id}_${timestamp}.mp4`;
    const outputPath = path.join(this.config.videoOutput, outputFilename);

    // 计算裁剪时间
    const firstSegmentStart = segments[0].startTime;
    const trimStart = Math.max(0, (startTime - firstSegmentStart) / 1000);
    const duration = (endTime - startTime) / 1000;

    // 拼接并裁剪视频
    await this.concatAndTrimVideos(
      segments.map(s => s.filePath),
      outputPath,
      trimStart,
      duration
    );

    console.log(`[VideoGenerator] 生成完成: ${outputFilename}`);

    return outputFilename;
  }

  /**
   * 拼接并裁剪视频
   */
  async concatAndTrimVideos(inputFiles, outputPath, startTime, duration) {
    return new Promise((resolve, reject) => {
      // 创建临时文件列表
      const listFile = outputPath + '.txt';
      const listContent = inputFiles.map(f => `file '${f}'`).join('\n');
      fs.writeFileSync(listFile, listContent);

      const args = [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', listFile,
        '-ss', startTime.toFixed(3),
        '-t', duration.toFixed(3),
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-movflags', '+faststart',
        outputPath
      ];

      console.log(`[VideoGenerator] 执行: ffmpeg ${args.join(' ')}`);

      const proc = spawn('ffmpeg', args, { stdio: 'pipe' });

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        // 清理临时文件
        try {
          fs.unlinkSync(listFile);
        } catch (e) {}

        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg 失败 (code: ${code}): ${stderr.slice(-500)}`));
        }
      });

      proc.on('error', (err) => {
        try {
          fs.unlinkSync(listFile);
        } catch (e) {}
        reject(err);
      });
    });
  }

  /**
   * 获取已生成的视频列表
   */
  getVideoList() {
    const videoDir = this.config.videoOutput;

    if (!fs.existsSync(videoDir)) {
      return [];
    }

    const files = fs.readdirSync(videoDir)
      .filter(f => f.endsWith('.mp4'))
      .map(f => {
        const filePath = path.join(videoDir, f);
        const stats = fs.statSync(filePath);
        return {
          name: f,
          path: `/videos/${f}`,
          size: stats.size,
          createdAt: stats.birthtime.toISOString()
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return files;
  }

  /**
   * 删除视频文件
   */
  deleteVideo(filename) {
    const filePath = path.join(this.config.videoOutput, filename);

    if (!fs.existsSync(filePath)) {
      throw new Error('文件不存在');
    }

    fs.unlinkSync(filePath);
    return true;
  }
}

module.exports = VideoGenerator;
