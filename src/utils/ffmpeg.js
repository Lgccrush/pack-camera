const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * FFmpeg 工具封装
 */
class FFmpegUtil {
  constructor() {
    this.ffmpegPath = this.findFFmpeg();
  }

  /**
   * 查找 FFmpeg 可执行文件路径
   */
  findFFmpeg() {
    try {
      // 尝试从 PATH 中找到 ffmpeg
      const which = process.platform === 'win32' ? 'where' : 'which';
      const result = execSync(`${which} ffmpeg`, { encoding: 'utf8' }).trim();
      return result.split('\n')[0];
    } catch (e) {
      console.warn('FFmpeg 未找到，请确保已安装 FFmpeg');
      return 'ffmpeg';
    }
  }

  /**
   * 检查 FFmpeg 是否可用
   */
  isAvailable() {
    try {
      execSync('ffmpeg -version', { stdio: 'ignore' });
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 拼接视频片段
   * @param {string[]} inputFiles - 输入文件列表
   * @param {string} outputFile - 输出文件路径
   * @param {object} options - 选项
   * @returns {Promise<void>}
   */
  async concatVideos(inputFiles, outputFile, options = {}) {
    return new Promise((resolve, reject) => {
      // 创建临时文件列表
      const listFile = outputFile + '.txt';
      const listContent = inputFiles.map(f => `file '${f}'`).join('\n');
      fs.writeFileSync(listFile, listContent);

      const args = [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', listFile,
        '-c', 'copy',
        outputFile
      ];

      const proc = spawn(this.ffmpegPath, args, { stdio: 'pipe' });

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
          reject(new Error(`FFmpeg concat 失败: ${stderr}`));
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
   * 裁剪视频
   * @param {string} inputFile - 输入文件
   * @param {string} outputFile - 输出文件
   * @param {number} startTime - 开始时间（秒）
   * @param {number} duration - 持续时间（秒）
   * @returns {Promise<void>}
   */
  async trimVideo(inputFile, outputFile, startTime, duration) {
    return new Promise((resolve, reject) => {
      const args = [
        '-y',
        '-i', inputFile,
        '-ss', startTime.toString(),
        '-t', duration.toString(),
        '-c', 'copy',
        outputFile
      ];

      const proc = spawn(this.ffmpegPath, args, { stdio: 'pipe' });

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg trim 失败: ${stderr}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * 拼接并裁剪视频（一步完成）
   * @param {string[]} inputFiles - 输入文件列表
   * @param {string} outputFile - 输出文件路径
   * @param {number} startTime - 开始时间（秒）
   * @param {number} duration - 持续时间（秒）
   * @returns {Promise<void>}
   */
  async concatAndTrim(inputFiles, outputFile, startTime, duration) {
    return new Promise((resolve, reject) => {
      // 创建临时文件列表
      const listFile = outputFile + '.txt';
      const listContent = inputFiles.map(f => `file '${f}'`).join('\n');
      fs.writeFileSync(listFile, listContent);

      const args = [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', listFile,
        '-ss', startTime.toString(),
        '-t', duration.toString(),
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-c:a', 'aac',
        outputFile
      ];

      const proc = spawn(this.ffmpegPath, args, { stdio: 'pipe' });

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
          reject(new Error(`FFmpeg concat+trim 失败: ${stderr}`));
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
   * 获取视频时长
   * @param {string} filePath - 视频文件路径
   * @returns {Promise<number>} - 时长（秒）
   */
  async getDuration(filePath) {
    return new Promise((resolve, reject) => {
      const args = [
        '-i', filePath,
        '-show_entries', 'format=duration',
        '-v', 'quiet',
        '-of', 'csv=p=0'
      ];

      const proc = spawn('ffprobe', args, { stdio: 'pipe' });

      let stdout = '';
      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(parseFloat(stdout.trim()) || 0);
        } else {
          resolve(0);
        }
      });

      proc.on('error', () => resolve(0));
    });
  }
}

module.exports = new FFmpegUtil();
module.exports.FFmpegUtil = FFmpegUtil;
