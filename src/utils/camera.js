const { execSync, exec } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

/**
 * 跨平台摄像头检测模块
 */
class CameraDetector {
  constructor() {
    this.platform = os.platform();
  }

  /**
   * 检测所有可用的摄像头
   * @returns {Promise<Array<{id: string, name: string, devicePath: string}>>}
   */
  async detectCameras() {
    switch (this.platform) {
      case 'darwin':
        return this.detectMacCameras();
      case 'win32':
        return this.detectWindowsCameras();
      case 'linux':
        return this.detectLinuxCameras();
      default:
        console.warn(`不支持的平台: ${this.platform}`);
        return [];
    }
  }

  /**
   * Mac 摄像头检测 (AVFoundation)
   */
  async detectMacCameras() {
    return new Promise((resolve) => {
      exec('ffmpeg -f avfoundation -list_devices true -i "" 2>&1', (error, stdout, stderr) => {
        const output = stdout + stderr;
        const cameras = [];
        const lines = output.split('\n');

        let inVideoSection = false;
        let deviceIndex = 0;

        for (const line of lines) {
          // 检测视频设备部分开始
          if (line.includes('AVFoundation video devices:')) {
            inVideoSection = true;
            continue;
          }

          // 检测音频设备部分（视频部分结束）
          if (line.includes('AVFoundation audio devices:')) {
            break;
          }

          if (inVideoSection) {
            // 匹配设备行，格式如: [AVFoundation indev @ 0x...] [0] FaceTime HD Camera
            const match = line.match(/\[(\d+)\]\s+(.+?)$/);
            if (match) {
              const index = match[1];
              const name = match[2].trim();

              // 过滤掉屏幕捕获设备
              if (!name.toLowerCase().includes('screen')) {
                cameras.push({
                  id: `cam${index}`,
                  name: name,
                  devicePath: index,
                  deviceIndex: parseInt(index)
                });
              }
            }
          }
        }

        resolve(cameras);
      });
    });
  }

  /**
   * Windows 摄像头检测 (DirectShow)
   */
  async detectWindowsCameras() {
    return new Promise((resolve) => {
      exec('ffmpeg -list_devices true -f dshow -i dummy 2>&1', (error, stdout, stderr) => {
        const output = stdout + stderr;
        const cameras = [];
        const lines = output.split('\n');

        let inVideoSection = false;
        let deviceIndex = 0;

        for (const line of lines) {
          // DirectShow 设备列表格式
          if (line.includes('DirectShow video devices')) {
            inVideoSection = true;
            continue;
          }

          if (line.includes('DirectShow audio devices')) {
            break;
          }

          if (inVideoSection) {
            // 匹配设备名称，格式如: [dshow @ ...] "设备名称"
            const match = line.match(/"([^"]+)"/);
            if (match && !line.includes('Alternative name')) {
              const name = match[1];
              cameras.push({
                id: `cam${deviceIndex}`,
                name: name,
                devicePath: `video=${name}`,
                deviceIndex: deviceIndex
              });
              deviceIndex++;
            }
          }
        }

        resolve(cameras);
      });
    });
  }

  /**
   * Linux 摄像头检测 (Video4Linux2)
   */
  async detectLinuxCameras() {
    const cameras = [];

    try {
      // 扫描 /dev/video* 设备
      const videoDevices = fs.readdirSync('/dev')
        .filter(f => f.startsWith('video'))
        .sort();

      for (const device of videoDevices) {
        const devicePath = `/dev/${device}`;
        const index = device.replace('video', '');

        // 尝试获取设备名称
        let name = `Camera ${index}`;
        try {
          const v4l2Output = execSync(`v4l2-ctl -d ${devicePath} --info 2>/dev/null`, {
            encoding: 'utf8',
            timeout: 2000
          });
          const nameMatch = v4l2Output.match(/Card type\s*:\s*(.+)/);
          if (nameMatch) {
            name = nameMatch[1].trim();
          }
        } catch (e) {
          // 忽略错误，使用默认名称
        }

        cameras.push({
          id: `cam${index}`,
          name: name,
          devicePath: devicePath,
          deviceIndex: parseInt(index)
        });
      }
    } catch (e) {
      console.warn('无法读取 /dev 目录:', e.message);
    }

    return cameras;
  }

  /**
   * 获取平台对应的 FFmpeg 输入格式
   */
  getInputFormat() {
    switch (this.platform) {
      case 'darwin':
        return 'avfoundation';
      case 'win32':
        return 'dshow';
      case 'linux':
        return 'v4l2';
      default:
        return null;
    }
  }

  /**
   * 获取摄像头的 FFmpeg 输入参数
   * @param {object} camera - 摄像头对象
   * @returns {string}
   */
  getFFmpegInput(camera) {
    switch (this.platform) {
      case 'darwin':
        return camera.devicePath;
      case 'win32':
        return camera.devicePath;
      case 'linux':
        return camera.devicePath;
      default:
        return null;
    }
  }
}

module.exports = new CameraDetector();
module.exports.CameraDetector = CameraDetector;
