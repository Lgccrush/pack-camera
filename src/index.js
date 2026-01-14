const path = require('path');
const fs = require('fs');

const RecorderManager = require('./recorder');
const SessionManager = require('./session-manager');
const VideoGenerator = require('./video-generator');
const StreamServer = require('./stream-server');
const Server = require('./server');

// 加载配置
const configPath = path.join(__dirname, '../config.json');
let config;

try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
  console.error('无法加载配置文件:', error.message);
  process.exit(1);
}

// 转换为绝对路径
config.videoOutput = path.resolve(__dirname, '..', config.videoOutput);
config.tempDir = path.resolve(__dirname, '..', config.tempDir);

// 确保目录存在
if (!fs.existsSync(config.videoOutput)) {
  fs.mkdirSync(config.videoOutput, { recursive: true });
}
if (!fs.existsSync(config.tempDir)) {
  fs.mkdirSync(config.tempDir, { recursive: true });
}

console.log('=============================================');
console.log('  订单打包视频记录系统');
console.log('=============================================');
console.log(`配置:`);
console.log(`  - 端口: ${config.port}`);
console.log(`  - 缓冲时长: ${config.bufferSeconds}s`);
console.log(`  - 片段时长: ${config.segmentDuration}s`);
console.log(`  - 打包前录制: ${config.prePackSeconds}s`);
console.log(`  - 打包后录制: ${config.postPackSeconds}s`);
console.log(`  - 视频输出: ${config.videoOutput}`);
console.log('');

// 初始化模块
const recorderManager = new RecorderManager(config);
const sessionManager = new SessionManager(config);
const streamServer = new StreamServer(config, recorderManager);
const videoGenerator = new VideoGenerator(config, recorderManager, sessionManager);
const server = new Server(config, recorderManager, sessionManager, videoGenerator, streamServer);

// 启动应用
async function start() {
  try {
    // 初始化录制器（检测摄像头）
    console.log('[启动] 正在检测摄像头...');
    await recorderManager.initialize();

    const cameras = recorderManager.getCameras();
    if (cameras.length === 0) {
      console.warn('[警告] 未检测到摄像头，系统将以无摄像头模式运行');
      console.warn('[警告] 请确保已连接摄像头并重新启动');
    } else {
      console.log(`[启动] 检测到 ${cameras.length} 个摄像头:`);
      cameras.forEach(c => console.log(`  - ${c.id}: ${c.name}`));

      // 启动持续录制
      console.log('[启动] 开始持续录制...');
      recorderManager.startAll();
    }

    // 启动 HTTP 服务
    console.log('[启动] 启动 HTTP 服务...');
    await server.start();

    console.log('');
    console.log('=============================================');
    console.log(`  系统已就绪`);
    console.log(`  Web 界面: http://localhost:${config.port}`);
    console.log('=============================================');
    console.log('');

  } catch (error) {
    console.error('[错误] 启动失败:', error);
    process.exit(1);
  }
}

// 优雅退出
async function shutdown() {
  console.log('');
  console.log('[关闭] 正在停止服务...');

  try {
    // 停止录制
    recorderManager.stopAll();

    // 停止流服务
    streamServer.stopAll();

    // 停止 HTTP 服务
    await server.stop();

    console.log('[关闭] 服务已停止');
    process.exit(0);
  } catch (error) {
    console.error('[关闭] 停止时出错:', error);
    process.exit(1);
  }
}

// 监听退出信号
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('[错误] 未捕获的异常:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[错误] 未处理的 Promise 拒绝:', reason);
});

// 启动
start();
