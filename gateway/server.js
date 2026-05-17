require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');

// 配置 multer 动态存储路径
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const { sessionId } = req.params;
    const workspaceDir = path.join(__dirname, 'sessions', sessionId, 'workspace');
    
    // 确保 workspace 目录存在
    fs.mkdir(workspaceDir, { recursive: true }, (err) => {
      if (err) return cb(err);
      cb(null, workspaceDir);
    });
  },
  filename: function (req, file, cb) {
    // 解决中文文件名乱码问题并保持原始后缀
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, file.originalname);
  }
});

const upload = multer({ storage: storage });

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// 1. 初始化 SQLite 数据库 (Phase 4)
// ==========================================
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database', err);
  } else {
    console.log('✅ SQLite Database connected.');
    db.serialize(() => {
      // 创建员工表
      db.run(`CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        username TEXT,
        total_tokens_used INTEGER DEFAULT 0
      )`);
      // 创建会话表
      db.run(`CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        user_id TEXT,
        title TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(user_id)
      )`);

      // 插入一个测试员工 (如果不存在)
      db.run(`INSERT OR IGNORE INTO users (user_id, username) VALUES ('1001', 'Test_Employee')`);
    });
  }
});

// ==========================================
// 3. 文件上传与下载 API (Phase 6)
// ==========================================

// 上传文件到会话的 workspace
app.post('/api/sessions/:sessionId/upload', (req, res) => {
  const { sessionId } = req.params;
  
  // 1. 验证 Session 是否存在
  db.get(`SELECT * FROM sessions WHERE session_id = ?`, [sessionId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // 2. 如果合法，执行 multer 上传中间件
    upload.single('file')(req, res, function (err) {
      if (err) {
        return res.status(500).json({ error: 'Upload failed', details: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      
      res.json({
        status: 'success',
        message: 'File uploaded successfully',
        filePath: `./workspace/${req.file.filename}`
      });
    });
  });
});

// 从会话的 workspace 下载文件
app.get('/api/sessions/:sessionId/download/:filename', (req, res) => {
  const { sessionId, filename } = req.params;
  
  db.get(`SELECT * FROM sessions WHERE session_id = ?`, [sessionId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // 安全地拼接路径，防止目录穿越 (Directory Traversal)
    const workspaceDir = path.join(__dirname, 'sessions', sessionId, 'workspace');
    const safeFilePath = path.join(workspaceDir, path.normalize(filename).replace(/^(\.\.(\/|\\|$))+/, ''));
    
    if (!safeFilePath.startsWith(workspaceDir)) {
      return res.status(403).json({ error: 'Forbidden path' });
    }
    
    if (!fs.existsSync(safeFilePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    res.download(safeFilePath);
  });
});

// ==========================================
// 4. Server-Sent Events (SSE) 对话路由
// ==========================================

// 获取某员工的所有历史会话
app.get('/api/sessions', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  db.all(`SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC`, [userId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 获取特定会话的历史消息
app.get('/api/sessions/:sessionId/history', (req, res) => {
  const { sessionId } = req.params;
  const historyFile = path.resolve(__dirname, `../sessions/${sessionId}/messages.json`);
  
  if (fs.existsSync(historyFile)) {
    try {
      const history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      res.json(history);
    } catch (e) {
      res.status(500).json({ error: 'Failed to read history' });
    }
  } else {
    res.json([]);
  }
});

// 创建新会话
app.post('/api/sessions', (req, res) => {
  const { userId, title } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const sessionTitle = title || '新对话';

  db.run(`INSERT INTO sessions (session_id, user_id, title) VALUES (?, ?, ?)`, [sessionId, userId, sessionTitle], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ session_id: sessionId, title: sessionTitle });
  });
});

// 子进程 worker.js 的路径
const WORKER_PATH = path.resolve(__dirname, '../open-codex-source/codex-cli/dist/worker.js');

// ==========================================
// 3. 核心流式对话接口
// ==========================================
app.post('/api/chat', (req, res) => {
  // 现在前端必须同时传递 userId 和 sessionId
  const { prompt, sessionId, userId } = req.body;
  if (!prompt || !sessionId || !userId) {
    return res.status(400).json({ error: 'prompt, sessionId, and userId are required' });
  }

  // 验证 session 是否属于该 user
  db.get(`SELECT * FROM sessions WHERE session_id = ? AND user_id = ?`, [sessionId, userId], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(403).json({ error: 'Session not found or belongs to another user' });

    // 确保工作目录存在并隔离
    const sessionDir = path.resolve(__dirname, `../sessions/${sessionId}`);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    // 读取历史记录但不要写回，让 worker 能够读取旧的记录作为 prevItems
    const historyFile = path.join(sessionDir, 'messages.json');
    let history = [];
    if (fs.existsSync(historyFile)) {
      try {
        history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      } catch (e) {
        history = [];
      }
    }
    
    // 把当前用户输入加入内存中的历史
    history.push({ role: 'user', content: [{ type: 'text', text: prompt }] });

    // 返回 SSE 响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Session-Id': sessionId
    });

    // 启动 Headless 隔离的 Agent 子进程
    const worker = spawn('node', [WORKER_PATH], {
      cwd: sessionDir,
      env: {
        ...process.env,
        WORKER_PROMPT: prompt,
        WORKER_CWD: sessionDir,
        WORKER_MODEL: req.body.model || 'MiniMax-M2.7',
        WORKER_PROVIDER: req.body.provider || 'openai'
      }
    });

    // 捕获无头 CLI 的纯净 JSON 流并转发为 SSE
    worker.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim() !== '');
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line); // 尝试解析确保是合法 JSON
          if (parsed.type === 'item') {
            history.push(parsed.data);
            fs.writeFileSync(historyFile, JSON.stringify(history, null, 2), 'utf8');
          }
          res.write(`data: ${line}\n\n`);
        } catch (e) {
          console.log(`Worker stdout (non-json):`, line);
        }
      }
    });

    worker.stderr.on('data', (data) => {
      console.error(`Worker [${sessionId}] STDERR:`, data.toString());
    });

    worker.on('close', (code) => {
      console.log(`Worker [${sessionId}] exited with code ${code}`);
      res.write(`data: {"type": "exit", "code": ${code}}\n\n`);
      res.end();
    });

    // 处理客户端断开连接
    req.connection.on('close', () => {
      if (!res.writableEnded) {
        console.log(`Client disconnected unexpectedly, killing worker [${sessionId}]`);
        worker.kill();
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Gateway listening on port ${PORT}`);
  console.log(`SSE Endpoint ready at http://localhost:${PORT}/api/chat`);
});
