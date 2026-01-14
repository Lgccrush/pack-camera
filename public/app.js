// 应用状态
const state = {
  connected: false,
  cameras: [],
  activeSessions: [],
  videos: [],
  currentOrderId: null
};

// DOM 元素
const elements = {
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  cameraGrid: document.getElementById('cameraGrid'),
  orderIdInput: document.getElementById('orderIdInput'),
  startPackBtn: document.getElementById('startPackBtn'),
  endPackBtn: document.getElementById('endPackBtn'),
  messageArea: document.getElementById('messageArea'),
  activeSessionList: document.getElementById('activeSessionList'),
  videoList: document.getElementById('videoList'),
  videoModal: document.getElementById('videoModal'),
  videoPlayer: document.getElementById('videoPlayer'),
  videoModalTitle: document.getElementById('videoModalTitle'),
  modalClose: document.getElementById('modalClose')
};

// WebSocket 连接
let ws = null;
let reconnectTimer = null;

// 初始化
function init() {
  setupEventListeners();
  connectWebSocket();
  fetchInitialData();
}

// 设置事件监听器
function setupEventListeners() {
  elements.startPackBtn.addEventListener('click', handleStartPack);
  elements.endPackBtn.addEventListener('click', handleEndPack);
  elements.modalClose.addEventListener('click', closeVideoModal);
  elements.videoModal.addEventListener('click', (e) => {
    if (e.target === elements.videoModal) {
      closeVideoModal();
    }
  });

  // 回车键触发
  elements.orderIdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      if (state.currentOrderId) {
        handleEndPack();
      } else {
        handleStartPack();
      }
    }
  });
}

// WebSocket 连接
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    state.connected = true;
    updateConnectionStatus();
    showMessage('已连接到服务器', 'success');
  };

  ws.onclose = () => {
    state.connected = false;
    updateConnectionStatus();
    showMessage('与服务器断开连接，正在重连...', 'error');
    scheduleReconnect();
  };

  ws.onerror = (error) => {
    console.error('WebSocket 错误:', error);
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      handleWebSocketMessage(message);
    } catch (e) {
      console.error('解析 WebSocket 消息失败:', e);
    }
  };
}

// 重连调度
function scheduleReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }
  reconnectTimer = setTimeout(() => {
    connectWebSocket();
  }, 3000);
}

// 处理 WebSocket 消息
function handleWebSocketMessage(message) {
  switch (message.type) {
    case 'connected':
      state.cameras = message.data.cameras || [];
      renderCameras();
      break;

    case 'session_start':
      fetchActiveSessions();
      showMessage(`打包会话开始: ${message.data.orderId}`, 'info');
      break;

    case 'session_completed':
      fetchActiveSessions();
      fetchVideos();
      showMessage(`视频生成完成: ${message.data.orderId}`, 'success');
      break;

    case 'session_failed':
      fetchActiveSessions();
      showMessage(`视频生成失败: ${message.data.orderId} - ${message.data.error}`, 'error');
      break;

    case 'video_generated':
      fetchVideos();
      break;

    case 'camera_started':
      if (!state.cameras.find(c => c.id === message.data.id)) {
        state.cameras.push(message.data);
        renderCameras();
      }
      break;
  }
}

// 更新连接状态
function updateConnectionStatus() {
  if (state.connected) {
    elements.statusDot.className = 'status-dot connected';
    elements.statusText.textContent = '已连接';
  } else {
    elements.statusDot.className = 'status-dot disconnected';
    elements.statusText.textContent = '已断开';
  }
}

// 获取初始数据
async function fetchInitialData() {
  await Promise.all([
    fetchCameras(),
    fetchActiveSessions(),
    fetchVideos()
  ]);
}

// 获取摄像头列表
async function fetchCameras() {
  try {
    const response = await fetch('/api/cameras');
    const data = await response.json();
    if (data.success) {
      state.cameras = data.cameras;
      renderCameras();
    }
  } catch (error) {
    console.error('获取摄像头列表失败:', error);
  }
}

// 获取活跃会话
async function fetchActiveSessions() {
  try {
    const response = await fetch('/api/sessions/active');
    const data = await response.json();
    if (data.success) {
      state.activeSessions = data.sessions;
      renderActiveSessions();
    }
  } catch (error) {
    console.error('获取活跃会话失败:', error);
  }
}

// 获取视频列表
async function fetchVideos() {
  try {
    const response = await fetch('/api/videos');
    const data = await response.json();
    if (data.success) {
      state.videos = data.videos;
      renderVideos();
    }
  } catch (error) {
    console.error('获取视频列表失败:', error);
  }
}

// 渲染摄像头
function renderCameras() {
  if (state.cameras.length === 0) {
    elements.cameraGrid.innerHTML = `
      <div class="camera-placeholder">
        <p>未检测到摄像头</p>
      </div>
    `;
    return;
  }

  elements.cameraGrid.innerHTML = state.cameras.map(camera => `
    <div class="camera-card">
      <div class="camera-header">
        <span class="camera-name">${camera.name}</span>
        <span class="camera-status">录制中</span>
      </div>
      <img src="/stream/${camera.id}" alt="${camera.name}"
           onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 640 480%22><rect fill=%22%231f2937%22 width=%22640%22 height=%22480%22/><text x=%22320%22 y=%22240%22 text-anchor=%22middle%22 fill=%22%236b7280%22 font-size=%2220%22>摄像头离线</text></svg>'" />
    </div>
  `).join('');
}

// 渲染活跃会话
function renderActiveSessions() {
  if (state.activeSessions.length === 0) {
    elements.activeSessionList.innerHTML = `
      <div class="empty-state">暂无活跃会话</div>
    `;
    return;
  }

  const getStatusClass = (status) => {
    if (status === 'generating') return 'generating';
    if (status === 'waiting') return 'waiting';
    return 'in-progress';
  };

  const getStatusText = (status) => {
    if (status === 'generating') return '生成中...';
    if (status === 'waiting') return '等待录制...';
    return '进行中';
  };

  elements.activeSessionList.innerHTML = state.activeSessions.map(session => `
    <div class="session-item">
      <div class="session-info">
        <span class="order-id">${session.orderId}</span>
        <span class="session-time">开始于 ${formatTime(session.startTime)} | 已进行 ${session.duration}秒</span>
      </div>
      <span class="session-status ${getStatusClass(session.status)}">
        ${getStatusText(session.status)}
      </span>
    </div>
  `).join('');
}

// 渲染视频列表
function renderVideos() {
  if (state.videos.length === 0) {
    elements.videoList.innerHTML = `
      <div class="empty-state">暂无视频</div>
    `;
    return;
  }

  elements.videoList.innerHTML = state.videos.map(video => `
    <div class="video-item">
      <div class="video-info">
        <div class="video-name">${video.name}</div>
        <div class="video-meta">${formatFileSize(video.size)} | ${formatTime(video.createdAt)}</div>
      </div>
      <div class="video-actions">
        <button class="btn btn-primary btn-small" onclick="playVideo('${video.path}', '${video.name}')">播放</button>
        <a href="${video.path}" download class="btn btn-success btn-small">下载</a>
        <button class="btn btn-danger btn-small" onclick="deleteVideo('${video.name}')">删除</button>
      </div>
    </div>
  `).join('');
}

// 开始打包
async function handleStartPack() {
  const orderId = elements.orderIdInput.value.trim();

  if (!orderId) {
    showMessage('请输入订单号', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/pack/start/${encodeURIComponent(orderId)}`, {
      method: 'POST'
    });
    const data = await response.json();

    if (data.success) {
      state.currentOrderId = orderId;
      elements.startPackBtn.disabled = true;
      elements.endPackBtn.disabled = false;
      elements.orderIdInput.disabled = true;
      showMessage(`打包开始: ${orderId}`, 'success');
      fetchActiveSessions();
    } else {
      showMessage(data.error || '开始打包失败', 'error');
    }
  } catch (error) {
    showMessage('请求失败: ' + error.message, 'error');
  }
}

// 结束打包
async function handleEndPack() {
  if (!state.currentOrderId) {
    showMessage('没有进行中的打包会话', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/pack/end/${encodeURIComponent(state.currentOrderId)}`, {
      method: 'POST'
    });
    const data = await response.json();

    if (data.success) {
      showMessage(`打包结束: ${state.currentOrderId}，视频生成中...`, 'info');
      state.currentOrderId = null;
      elements.startPackBtn.disabled = false;
      elements.endPackBtn.disabled = true;
      elements.orderIdInput.disabled = false;
      elements.orderIdInput.value = '';
      fetchActiveSessions();
    } else {
      showMessage(data.error || '结束打包失败', 'error');
    }
  } catch (error) {
    showMessage('请求失败: ' + error.message, 'error');
  }
}

// 播放视频
function playVideo(path, name) {
  elements.videoPlayer.src = path;
  elements.videoModalTitle.textContent = name;
  elements.videoModal.classList.add('show');
  elements.videoPlayer.play();
}

// 关闭视频弹窗
function closeVideoModal() {
  elements.videoModal.classList.remove('show');
  elements.videoPlayer.pause();
  elements.videoPlayer.src = '';
}

// 删除视频
async function deleteVideo(filename) {
  if (!confirm(`确定要删除视频 ${filename} 吗？`)) {
    return;
  }

  try {
    const response = await fetch(`/api/videos/${encodeURIComponent(filename)}`, {
      method: 'DELETE'
    });
    const data = await response.json();

    if (data.success) {
      showMessage('视频已删除', 'success');
      fetchVideos();
    } else {
      showMessage(data.error || '删除失败', 'error');
    }
  } catch (error) {
    showMessage('请求失败: ' + error.message, 'error');
  }
}

// 显示消息
function showMessage(text, type = 'info') {
  elements.messageArea.innerHTML = `
    <div class="message ${type}">${text}</div>
  `;

  // 5秒后自动清除
  setTimeout(() => {
    if (elements.messageArea.querySelector('.message')?.textContent === text) {
      elements.messageArea.innerHTML = '';
    }
  }, 5000);
}

// 格式化时间
function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// 格式化文件大小
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// 启动应用
init();

// 定期刷新活跃会话
setInterval(fetchActiveSessions, 5000);
