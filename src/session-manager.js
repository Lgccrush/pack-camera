const EventEmitter = require('events');

/**
 * 打包会话管理器
 * 管理打包会话，记录开始/结束时间，触发视频生成
 */
class SessionManager extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.sessions = new Map(); // orderId -> session
    this.completedSessions = []; // 已完成的会话历史
  }

  /**
   * 开始打包会话
   * @param {string} orderId - 订单ID
   * @returns {object} - 会话信息
   */
  startSession(orderId) {
    if (this.sessions.has(orderId)) {
      const existing = this.sessions.get(orderId);
      return {
        success: false,
        error: '该订单已有进行中的打包会话',
        session: existing
      };
    }

    const session = {
      orderId,
      startTime: Date.now(),
      endTime: null,
      status: 'in_progress',
      videoFiles: []
    };

    this.sessions.set(orderId, session);
    this.emit('session_start', session);

    console.log(`[Session] 打包开始: ${orderId}`);

    return {
      success: true,
      orderId,
      startTime: new Date(session.startTime).toISOString(),
      session
    };
  }

  /**
   * 结束打包会话
   * @param {string} orderId - 订单ID
   * @returns {object} - 会话信息和时间范围
   */
  endSession(orderId) {
    const session = this.sessions.get(orderId);

    if (!session) {
      return {
        success: false,
        error: '未找到该订单的打包会话'
      };
    }

    session.endTime = Date.now();
    session.status = 'waiting';  // 等待后续录制完成

    // 计算需要的视频时间范围
    const videoStartTime = session.startTime - (this.config.prePackSeconds * 1000);
    const videoEndTime = session.endTime + (this.config.postPackSeconds * 1000);

    console.log(`[Session] 打包结束: ${orderId}`);
    console.log(`[Session] 等待 ${this.config.postPackSeconds} 秒后生成视频...`);
    console.log(`[Session] 视频范围: ${new Date(videoStartTime).toISOString()} - ${new Date(videoEndTime).toISOString()}`);

    // 延迟 postPackSeconds 秒后再触发视频生成，确保后续录制完成
    setTimeout(() => {
      session.status = 'generating';
      console.log(`[Session] 开始生成视频: ${orderId}`);

      this.emit('session_end', {
        session,
        videoStartTime,
        videoEndTime
      });
    }, this.config.postPackSeconds * 1000);

    return {
      success: true,
      orderId,
      startTime: new Date(session.startTime).toISOString(),
      endTime: new Date(session.endTime).toISOString(),
      videoStartTime,
      videoEndTime,
      waitSeconds: this.config.postPackSeconds,
      session
    };
  }

  /**
   * 标记会话视频生成完成
   * @param {string} orderId - 订单ID
   * @param {string[]} videoFiles - 生成的视频文件列表
   */
  markCompleted(orderId, videoFiles) {
    const session = this.sessions.get(orderId);

    if (!session) {
      return;
    }

    session.status = 'completed';
    session.videoFiles = videoFiles;
    session.completedAt = Date.now();

    // 移至已完成列表
    this.completedSessions.push({ ...session });
    this.sessions.delete(orderId);

    // 保留最近100条历史
    if (this.completedSessions.length > 100) {
      this.completedSessions.shift();
    }

    console.log(`[Session] 视频生成完成: ${orderId}, 文件: ${videoFiles.join(', ')}`);

    this.emit('session_completed', {
      orderId,
      videoFiles,
      session
    });
  }

  /**
   * 标记会话视频生成失败
   * @param {string} orderId - 订单ID
   * @param {string} error - 错误信息
   */
  markFailed(orderId, error) {
    const session = this.sessions.get(orderId);

    if (!session) {
      return;
    }

    session.status = 'failed';
    session.error = error;

    // 移至已完成列表（带失败状态）
    this.completedSessions.push({ ...session });
    this.sessions.delete(orderId);

    console.error(`[Session] 视频生成失败: ${orderId}, 错误: ${error}`);

    this.emit('session_failed', {
      orderId,
      error,
      session
    });
  }

  /**
   * 获取活跃会话列表
   */
  getActiveSessions() {
    return Array.from(this.sessions.values()).map(session => ({
      orderId: session.orderId,
      startTime: new Date(session.startTime).toISOString(),
      status: session.status,
      duration: Math.round((Date.now() - session.startTime) / 1000)
    }));
  }

  /**
   * 获取已完成会话列表
   */
  getCompletedSessions() {
    return this.completedSessions.slice(-20).reverse().map(session => ({
      orderId: session.orderId,
      startTime: new Date(session.startTime).toISOString(),
      endTime: session.endTime ? new Date(session.endTime).toISOString() : null,
      status: session.status,
      videoFiles: session.videoFiles || [],
      error: session.error
    }));
  }

  /**
   * 获取指定订单的会话信息
   */
  getSession(orderId) {
    const active = this.sessions.get(orderId);
    if (active) {
      return { ...active, isActive: true };
    }

    const completed = this.completedSessions.find(s => s.orderId === orderId);
    if (completed) {
      return { ...completed, isActive: false };
    }

    return null;
  }

  /**
   * 检查订单是否有活跃会话
   */
  hasActiveSession(orderId) {
    return this.sessions.has(orderId);
  }
}

module.exports = SessionManager;
