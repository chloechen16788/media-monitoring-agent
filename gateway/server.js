require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');

const DATA_ROOT = path.resolve(__dirname, '../data/users');
const LEGACY_SESSIONS_ROOT = path.resolve(__dirname, '../sessions');
const DEFAULT_PROJECT_PREFIX = 'proj_default_';

function safeId(value, fallback = 'unknown') {
  const sanitized = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '');
  return sanitized || fallback;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function buildSessionPaths(userId, projectId, sessionId) {
  const normalizedUserId = safeId(userId, 'user');
  const normalizedProjectId = safeId(projectId, 'project');
  const normalizedSessionId = safeId(sessionId, 'session');
  const sessionDir = path.join(
    DATA_ROOT,
    normalizedUserId,
    'projects',
    normalizedProjectId,
    'sessions',
    normalizedSessionId
  );
  return {
    sessionDir,
    historyFile: path.join(sessionDir, 'messages.json'),
    uploadDir: path.join(sessionDir, 'uploads'),
    projectDir: path.join(DATA_ROOT, normalizedUserId, 'projects', normalizedProjectId),
    taskContractFile: path.join(DATA_ROOT, normalizedUserId, 'projects', normalizedProjectId, 'task_contract.json'),
    legacyHistoryFile: path.join(LEGACY_SESSIONS_ROOT, normalizedSessionId, 'messages.json'),
  };
}

function buildProjectPaths(userId, projectId) {
  const normalizedUserId = safeId(userId, 'user');
  const normalizedProjectId = safeId(projectId, 'project');
  const projectDir = path.join(DATA_ROOT, normalizedUserId, 'projects', normalizedProjectId);
  return {
    projectDir,
    taskContractFile: path.join(projectDir, 'task_contract.json'),
    agentStateFile: path.join(projectDir, 'agent_state.json'),
  };
}

function readJsonFileSafe(filePath, fallbackValue) {
  if (!fs.existsSync(filePath)) return fallbackValue;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallbackValue;
  }
}

function writeJsonFileSafe(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function getPromptFileByMode(agentMode) {
  const mode = agentMode === 'sub' ? 'sub' : 'master';
  return path.resolve(__dirname, `../agents/${mode}/system.md`);
}

function parseAgentRole(role) {
  if (role === 'master' || role === 'sub') return role;
  return null;
}

function withTaskContractDefaults(contract, sessionRow) {
  return {
    task_id: '',
    project_id: sessionRow?.project_id || '',
    owner_user_id: sessionRow?.user_id || '',
    goal: '',
    input_context: {},
    allowed_skills: [],
    acceptance_criteria: [],
    output_schema: {},
    status: 'planned',
    executor_result: {},
    validation_result: {},
    retry_policy: {
      max_retries: 0,
      on_failure: 'return_error',
    },
    ...contract,
  };
}

const TASK_STATUS_TRANSITIONS = {
  planned: ['planned', 'executing', 'failed'],
  executing: ['executing', 'validating', 'failed'],
  validating: ['validating', 'completed', 'failed'],
  completed: ['completed'],
  failed: ['failed', 'planned'],
};

function getDefaultAgentState(userId, projectId) {
  return {
    user_id: userId,
    project_id: projectId,
    active_agent: 'master',
    updated_at: new Date().toISOString(),
  };
}

// 仅当 Sub 正在执行任务（executing）时保持 sub；其余阶段一律回到 master。
function resolveEffectiveAgentMode(contract, persistedAgent) {
  const status = String(contract?.status || 'planned').toLowerCase();
  if (status === 'executing' && persistedAgent === 'sub') {
    return 'sub';
  }
  return 'master';
}

function readProjectAgentState(projectPaths, userId, projectId) {
  const defaultState = getDefaultAgentState(userId, projectId);
  if (!fs.existsSync(projectPaths.agentStateFile)) {
    writeJsonFileSafe(projectPaths.agentStateFile, defaultState);
  }
  return readJsonFileSafe(projectPaths.agentStateFile, defaultState);
}

function syncProjectAgentState(projectPaths, userId, projectId, contract) {
  const state = readProjectAgentState(projectPaths, userId, projectId);
  const effectiveAgent = resolveEffectiveAgentMode(contract, state.active_agent);
  if (state.active_agent === effectiveAgent) {
    return state;
  }
  const nextState = {
    ...state,
    active_agent: effectiveAgent,
    updated_at: new Date().toISOString(),
  };
  writeJsonFileSafe(projectPaths.agentStateFile, nextState);
  return nextState;
}

function loadSkillsRegistry() {
  const registryPath = path.resolve(__dirname, '../skills/registry.json');
  const catalogPath = path.resolve(__dirname, '../skills/catalog.json');
  const registry = readJsonFileSafe(registryPath, { version: 'v2', skills: [] });
  const catalog = readJsonFileSafe(catalogPath, []);
  const briefById = new Map(
    Array.isArray(catalog)
      ? catalog.map((item) => [item.id, item.brief || ''])
      : []
  );
  const skills = Array.isArray(registry.skills) ? registry.skills : [];
  const mergedSkills = skills.map((skill) => ({
    ...skill,
    brief: skill.brief || briefById.get(skill.id) || '',
  }));
  return {
    version: registry.version || 'v2',
    description: registry.description || '',
    skills: mergedSkills,
  };
}

function ensureTaskContractTemplate(taskContractFile, sessionRow) {
  if (fs.existsSync(taskContractFile)) return;
  ensureDir(path.dirname(taskContractFile));
  const template = withTaskContractDefaults({}, sessionRow);
  fs.writeFileSync(taskContractFile, JSON.stringify(template, null, 2), 'utf8');
}

function readHistoryWithCompatibility(paths) {
  if (fs.existsSync(paths.historyFile)) {
    try {
      return JSON.parse(fs.readFileSync(paths.historyFile, 'utf8'));
    } catch (e) {
      return [];
    }
  }
  if (fs.existsSync(paths.legacyHistoryFile)) {
    try {
      const legacy = JSON.parse(fs.readFileSync(paths.legacyHistoryFile, 'utf8'));
      ensureDir(path.dirname(paths.historyFile));
      fs.writeFileSync(paths.historyFile, JSON.stringify(legacy, null, 2), 'utf8');
      return legacy;
    } catch (e) {
      return [];
    }
  }
  return [];
}

function writeHistory(paths, history) {
  ensureDir(path.dirname(paths.historyFile));
  fs.writeFileSync(paths.historyFile, JSON.stringify(history, null, 2), 'utf8');
}

function getProjectIdFromRequest(req) {
  return req.query.projectId || req.body?.projectId || req.headers['x-project-id'];
}

// 配置 multer 动态存储路径
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = req.sessionPaths?.uploadDir;
    
    if (!uploadDir) {
      return cb(new Error('Session upload path not initialized'));
    }

    // 确保 uploads 目录存在
    fs.mkdir(uploadDir, { recursive: true }, (err) => {
      if (err) return cb(err);
      cb(null, uploadDir);
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

function getUserIdFromRequest(req) {
  return req.query.userId || req.body?.userId || req.headers['x-user-id'];
}

function assertRequesterMatchesTarget(req, targetUserId) {
  const headerUser = req.headers['x-user-id'];
  if (!headerUser) return true;
  return String(headerUser) === String(targetUserId);
}

function ensureProjectOwnership(projectId, userId, cb) {
  if (!projectId || !userId) {
    cb(new Error('projectId and userId are required'));
    return;
  }
  db.get(
    `SELECT * FROM projects WHERE project_id = ? AND user_id = ?`,
    [projectId, userId],
    (err, row) => {
      if (err) return cb(err);
      if (!row) return cb(new Error('Project not found or belongs to another user'));
      cb(null, row);
    }
  );
}

function buildMemoryPaths(userId, projectId, sessionId) {
  const safeUser = safeId(userId, 'user');
  const paths = {
    userMemoryFile: path.join(DATA_ROOT, safeUser, 'user_memory.md'),
  };
  if (projectId) {
    const safeProject = safeId(projectId, 'project');
    paths.projectMemoryFile = path.join(DATA_ROOT, safeUser, 'projects', safeProject, 'project_memory.md');
    if (sessionId) {
      const safeSession = safeId(sessionId, 'session');
      paths.sessionMemoryFile = path.join(
        DATA_ROOT,
        safeUser,
        'projects',
        safeProject,
        'sessions',
        safeSession,
        'session_memory.md'
      );
    }
  }
  return paths;
}

function readMemoryFile(filePath) {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

function writeMemoryFile(filePath, content, mode = 'overwrite') {
  ensureDir(path.dirname(filePath));
  const normalized = String(content || '');
  if (mode === 'append' && fs.existsSync(filePath)) {
    const previous = fs.readFileSync(filePath, 'utf8');
    const separator = previous.endsWith('\n') || previous.length === 0 ? '' : '\n';
    fs.writeFileSync(filePath, `${previous}${separator}${normalized}`, 'utf8');
    return;
  }
  fs.writeFileSync(filePath, normalized, 'utf8');
}

function ensureSessionOwnership(sessionId, userId, projectId, cb) {
  if (!userId) {
    cb(new Error('userId is required'));
    return;
  }
  const params = [sessionId, userId];
  let sql = `SELECT * FROM sessions WHERE session_id = ? AND user_id = ?`;
  if (projectId) {
    sql += ` AND project_id = ?`;
    params.push(projectId);
  }
  db.get(sql, params, (err, row) => {
    if (err) return cb(err);
    if (!row) return cb(new Error('Session not found or belongs to another user/project'));
    cb(null, row);
  });
}

function ensureProjectExists(userId, projectId, projectName, cb) {
  db.run(
    `INSERT OR IGNORE INTO projects (project_id, user_id, name) VALUES (?, ?, ?)`,
    [projectId, userId, projectName || '默认项目'],
    function (err) {
      if (err) return cb(err);
      cb(null);
    }
  );
}

function ensureUserExists(userId, cb) {
  db.run(
    `INSERT OR IGNORE INTO users (user_id, username) VALUES (?, ?)`,
    [userId, `User_${userId}`],
    (err) => {
      if (err) return cb(err);
      cb(null);
    }
  );
}

function ensureDefaultProject(userId, cb) {
  const projectId = `${DEFAULT_PROJECT_PREFIX}${safeId(userId)}`;
  ensureProjectExists(userId, projectId, '默认项目', (err) => {
    if (err) return cb(err);
    cb(null, projectId);
  });
}

function ensureSessionsProjectColumn(callback) {
  db.all(`PRAGMA table_info(sessions)`, (err, columns) => {
    if (err) return callback(err);
    const hasProjectId = Array.isArray(columns) && columns.some((col) => col.name === 'project_id');
    if (hasProjectId) return callback(null);
    db.run(`ALTER TABLE sessions ADD COLUMN project_id TEXT`, (alterErr) => {
      if (alterErr) return callback(alterErr);
      db.run(
        `UPDATE sessions SET project_id = ? || user_id WHERE project_id IS NULL OR project_id = ''`,
        [DEFAULT_PROJECT_PREFIX],
        callback
      );
    });
  });
}

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
        project_id TEXT,
        title TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(user_id),
        FOREIGN KEY(project_id) REFERENCES projects(project_id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS projects (
        project_id TEXT PRIMARY KEY,
        user_id TEXT,
        name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(user_id)
      )`);

      // 插入一个测试员工 (如果不存在)
      db.run(`INSERT OR IGNORE INTO users (user_id, username) VALUES ('1001', 'Test_Employee')`);
      db.run(
        `INSERT OR IGNORE INTO projects (project_id, user_id, name) VALUES (?, ?, ?)`,
        [`${DEFAULT_PROJECT_PREFIX}1001`, '1001', '默认项目']
      );

      ensureSessionsProjectColumn((migrationErr) => {
        if (migrationErr) {
          console.error('Failed to migrate sessions.project_id:', migrationErr.message);
          return;
        }
        db.run(
          `UPDATE sessions SET project_id = ? WHERE user_id = '1001' AND (project_id IS NULL OR project_id = '')`,
          [`${DEFAULT_PROJECT_PREFIX}1001`]
        );
      });
    });
  }
});

// ==========================================
// 3. 文件上传与下载 API (Phase 6)
// ==========================================

// 上传文件到会话的 workspace
app.post('/api/sessions/:sessionId/upload', (req, res) => {
  const { sessionId } = req.params;
  const userId = getUserIdFromRequest(req);
  const projectId = getProjectIdFromRequest(req);
  
  // 1. 验证 Session 归属
  ensureSessionOwnership(sessionId, userId, projectId, (ownershipErr, sessionRow) => {
    if (ownershipErr) {
      if (ownershipErr.message === 'userId is required') {
        return res.status(400).json({ error: 'userId is required' });
      }
      if (ownershipErr.message.includes('Session not found')) {
        return res.status(403).json({ error: ownershipErr.message });
      }
      return res.status(500).json({ error: 'Database error' });
    }
    req.sessionPaths = buildSessionPaths(sessionRow.user_id, sessionRow.project_id, sessionId);
    
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
        filePath: `./workspace/${req.file.filename}`,
        project_id: sessionRow.project_id,
      });
    });
  });
});

// 从会话的 workspace 下载文件
app.get('/api/sessions/:sessionId/download/:filename', (req, res) => {
  const { sessionId, filename } = req.params;
  const userId = getUserIdFromRequest(req);
  const projectId = getProjectIdFromRequest(req);
  
  ensureSessionOwnership(sessionId, userId, projectId, (ownershipErr, sessionRow) => {
    if (ownershipErr) {
      if (ownershipErr.message === 'userId is required') {
        return res.status(400).json({ error: 'userId is required' });
      }
      if (ownershipErr.message.includes('Session not found')) {
        return res.status(403).json({ error: ownershipErr.message });
      }
      return res.status(500).json({ error: 'Database error' });
    }
    
    // 安全地拼接路径，防止目录穿越 (Directory Traversal)
    const sessionPaths = buildSessionPaths(sessionRow.user_id, sessionRow.project_id, sessionId);
    const workspaceDir = sessionPaths.uploadDir;
    const safeFilePath = path.join(workspaceDir, path.basename(path.normalize(filename)));
    
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

// 创建项目
app.post('/api/projects', (req, res) => {
  const { userId, name, projectId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  if (!assertRequesterMatchesTarget(req, userId)) {
    return res.status(403).json({ error: 'Forbidden: requester user mismatch' });
  }

  const finalProjectId = safeId(
    projectId || `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    `proj_${Date.now()}`
  );
  const finalName = name || '未命名项目';

  db.run(
    `INSERT OR IGNORE INTO users (user_id, username) VALUES (?, ?)`,
    [userId, `User_${userId}`],
    (userErr) => {
      if (userErr) return res.status(500).json({ error: userErr.message });
      db.run(
        `INSERT INTO projects (project_id, user_id, name) VALUES (?, ?, ?)`,
        [finalProjectId, userId, finalName],
        function(projectErr) {
          if (projectErr) {
            return res.status(500).json({ error: projectErr.message });
          }
          res.json({ project_id: finalProjectId, user_id: userId, name: finalName });
        }
      );
    }
  );
});

// 获取用户项目列表
app.get('/api/projects', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  if (!assertRequesterMatchesTarget(req, userId)) {
    return res.status(403).json({ error: 'Forbidden: requester user mismatch' });
  }
  db.all(
    `SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC`,
    [userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// 动态 skills registry
app.get('/api/skills/registry', (req, res) => {
  try {
    const { role, enabled } = req.query;
    const registry = loadSkillsRegistry();
    let skills = registry.skills;
    if (role) {
      skills = skills.filter((skill) => String(skill.role) === String(role));
    }
    if (enabled !== undefined) {
      const enabledFlag = String(enabled) === 'true';
      skills = skills.filter((skill) => Boolean(skill.enabled) === enabledFlag);
    } else {
      // 默认只返回启用技能，避免 UI 暴露与运行时策略不一致
      skills = skills.filter((skill) => Boolean(skill.enabled) === true);
    }
    res.json({
      version: registry.version,
      description: registry.description,
      role: role || 'all',
      skills,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load skills registry' });
  }
});

// Agent system prompt - read
app.get('/api/agents/:role/system-prompt', (req, res) => {
  const userId = req.query.userId;
  const role = parseAgentRole(req.params.role);
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  if (!role) return res.status(400).json({ error: 'role must be master or sub' });
  if (!assertRequesterMatchesTarget(req, userId)) {
    return res.status(403).json({ error: 'Forbidden: requester user mismatch' });
  }
  try {
    const promptFile = getPromptFileByMode(role);
    const content = fs.existsSync(promptFile) ? fs.readFileSync(promptFile, 'utf8') : '';
    res.json({ role, content, updated_at: fs.existsSync(promptFile) ? fs.statSync(promptFile).mtime.toISOString() : null });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read system prompt' });
  }
});

// Agent system prompt - write
app.put('/api/agents/:role/system-prompt', (req, res) => {
  const role = parseAgentRole(req.params.role);
  const { userId, content } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  if (!role) return res.status(400).json({ error: 'role must be master or sub' });
  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content(non-empty string) is required' });
  }
  if (!assertRequesterMatchesTarget(req, userId)) {
    return res.status(403).json({ error: 'Forbidden: requester user mismatch' });
  }
  try {
    const promptFile = getPromptFileByMode(role);
    ensureDir(path.dirname(promptFile));
    fs.writeFileSync(promptFile, content, 'utf8');
    res.json({
      success: true,
      role,
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to write system prompt' });
  }
});

// 项目级 task contract - read
app.get('/api/projects/:projectId/task-contract', (req, res) => {
  const { projectId } = req.params;
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  if (!assertRequesterMatchesTarget(req, userId)) {
    return res.status(403).json({ error: 'Forbidden: requester user mismatch' });
  }
  ensureProjectOwnership(projectId, userId, (ownershipErr) => {
    if (ownershipErr) {
      if (ownershipErr.message.includes('Project not found')) {
        return res.status(403).json({ error: ownershipErr.message });
      }
      return res.status(500).json({ error: 'Database error' });
    }
    const projectPaths = buildProjectPaths(userId, projectId);
    if (!fs.existsSync(projectPaths.taskContractFile)) {
      ensureTaskContractTemplate(projectPaths.taskContractFile, {
        user_id: userId,
        project_id: projectId,
      });
    }
    const contract = withTaskContractDefaults(
      readJsonFileSafe(projectPaths.taskContractFile, {}),
      { user_id: userId, project_id: projectId }
    );
    writeJsonFileSafe(projectPaths.taskContractFile, contract);
    res.json(contract);
  });
});

// 项目级 task contract - write
app.put('/api/projects/:projectId/task-contract', (req, res) => {
  const { projectId } = req.params;
  const { userId, contract } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  if (!contract || typeof contract !== 'object') {
    return res.status(400).json({ error: 'contract(object) is required' });
  }
  if (!assertRequesterMatchesTarget(req, userId)) {
    return res.status(403).json({ error: 'Forbidden: requester user mismatch' });
  }
  ensureProjectOwnership(projectId, userId, (ownershipErr) => {
    if (ownershipErr) {
      if (ownershipErr.message.includes('Project not found')) {
        return res.status(403).json({ error: ownershipErr.message });
      }
      return res.status(500).json({ error: 'Database error' });
    }
    const projectPaths = buildProjectPaths(userId, projectId);
    const previousContract = withTaskContractDefaults(
      readJsonFileSafe(projectPaths.taskContractFile, {}),
      { user_id: userId, project_id: projectId }
    );
    const normalizedContract = withTaskContractDefaults(contract, {
      user_id: userId,
      project_id: projectId,
    });
    const previousStatus = previousContract.status || 'planned';
    const nextStatus = normalizedContract.status || previousStatus;
    const allowedNextStatuses =
      TASK_STATUS_TRANSITIONS[previousStatus] || TASK_STATUS_TRANSITIONS.planned;
    if (!allowedNextStatuses.includes(nextStatus)) {
      return res.status(400).json({
        error: `invalid task contract status transition: ${previousStatus} -> ${nextStatus}`,
      });
    }
    normalizedContract.project_id = projectId;
    normalizedContract.owner_user_id = userId;
    normalizedContract.status = nextStatus;
    normalizedContract.updated_at = new Date().toISOString();
    writeJsonFileSafe(projectPaths.taskContractFile, normalizedContract);
    res.json({ success: true, contract: normalizedContract });
  });
});

// 项目级 agent mode state - read
app.get('/api/projects/:projectId/agent-state', (req, res) => {
  const { projectId } = req.params;
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  if (!assertRequesterMatchesTarget(req, userId)) {
    return res.status(403).json({ error: 'Forbidden: requester user mismatch' });
  }
  ensureProjectOwnership(projectId, userId, (ownershipErr) => {
    if (ownershipErr) {
      if (ownershipErr.message.includes('Project not found')) {
        return res.status(403).json({ error: ownershipErr.message });
      }
      return res.status(500).json({ error: 'Database error' });
    }
    const projectPaths = buildProjectPaths(userId, projectId);
    const contract = withTaskContractDefaults(
      readJsonFileSafe(projectPaths.taskContractFile, {}),
      { user_id: userId, project_id: projectId }
    );
    const state = syncProjectAgentState(projectPaths, userId, projectId, contract);
    res.json(state);
  });
});

// 项目级 agent mode state - write
app.put('/api/projects/:projectId/agent-state', (req, res) => {
  const { projectId } = req.params;
  const { userId, active_agent } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  if (!['master', 'sub'].includes(active_agent)) {
    return res.status(400).json({ error: 'active_agent must be master or sub' });
  }
  if (!assertRequesterMatchesTarget(req, userId)) {
    return res.status(403).json({ error: 'Forbidden: requester user mismatch' });
  }
  ensureProjectOwnership(projectId, userId, (ownershipErr) => {
    if (ownershipErr) {
      if (ownershipErr.message.includes('Project not found')) {
        return res.status(403).json({ error: ownershipErr.message });
      }
      return res.status(500).json({ error: 'Database error' });
    }
    const projectPaths = buildProjectPaths(userId, projectId);
    const state = {
      user_id: userId,
      project_id: projectId,
      active_agent,
      updated_at: new Date().toISOString(),
    };
    writeJsonFileSafe(projectPaths.agentStateFile, state);
    res.json({ success: true, state });
  });
});

// user memory - read
app.get('/api/memory/user', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  if (!assertRequesterMatchesTarget(req, userId)) {
    return res.status(403).json({ error: 'Forbidden: requester user mismatch' });
  }
  try {
    const memoryPaths = buildMemoryPaths(userId);
    const content = readMemoryFile(memoryPaths.userMemoryFile);
    res.json({ user_id: userId, content });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read user memory' });
  }
});

// user memory - write
app.post('/api/memory/user', (req, res) => {
  const { userId, content, mode } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  if (typeof content !== 'string') return res.status(400).json({ error: 'content(string) is required' });
  if (!assertRequesterMatchesTarget(req, userId)) {
    return res.status(403).json({ error: 'Forbidden: requester user mismatch' });
  }
  try {
    const memoryPaths = buildMemoryPaths(userId);
    writeMemoryFile(memoryPaths.userMemoryFile, content, mode || 'overwrite');
    res.json({ success: true, user_id: userId, mode: mode || 'overwrite' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to write user memory' });
  }
});

// project memory - read
app.get('/api/memory/project', (req, res) => {
  const { userId, projectId } = req.query;
  if (!userId || !projectId) return res.status(400).json({ error: 'userId and projectId are required' });
  if (!assertRequesterMatchesTarget(req, userId)) {
    return res.status(403).json({ error: 'Forbidden: requester user mismatch' });
  }
  ensureProjectOwnership(projectId, userId, (ownershipErr) => {
    if (ownershipErr) {
      if (ownershipErr.message.includes('Project not found')) {
        return res.status(403).json({ error: ownershipErr.message });
      }
      return res.status(500).json({ error: 'Database error' });
    }
    try {
      const memoryPaths = buildMemoryPaths(userId, projectId);
      const content = readMemoryFile(memoryPaths.projectMemoryFile);
      res.json({ user_id: userId, project_id: projectId, content });
    } catch (e) {
      res.status(500).json({ error: 'Failed to read project memory' });
    }
  });
});

// project memory - write
app.post('/api/memory/project', (req, res) => {
  const { userId, projectId, content, mode } = req.body || {};
  if (!userId || !projectId) return res.status(400).json({ error: 'userId and projectId are required' });
  if (typeof content !== 'string') return res.status(400).json({ error: 'content(string) is required' });
  if (!assertRequesterMatchesTarget(req, userId)) {
    return res.status(403).json({ error: 'Forbidden: requester user mismatch' });
  }
  ensureProjectOwnership(projectId, userId, (ownershipErr) => {
    if (ownershipErr) {
      if (ownershipErr.message.includes('Project not found')) {
        return res.status(403).json({ error: ownershipErr.message });
      }
      return res.status(500).json({ error: 'Database error' });
    }
    try {
      const memoryPaths = buildMemoryPaths(userId, projectId);
      writeMemoryFile(memoryPaths.projectMemoryFile, content, mode || 'overwrite');
      res.json({ success: true, user_id: userId, project_id: projectId, mode: mode || 'overwrite' });
    } catch (e) {
      res.status(500).json({ error: 'Failed to write project memory' });
    }
  });
});

// session memory - read
app.get('/api/memory/session', (req, res) => {
  const { userId, projectId, sessionId } = req.query;
  if (!userId || !projectId || !sessionId) {
    return res.status(400).json({ error: 'userId, projectId and sessionId are required' });
  }
  if (!assertRequesterMatchesTarget(req, userId)) {
    return res.status(403).json({ error: 'Forbidden: requester user mismatch' });
  }
  ensureSessionOwnership(sessionId, userId, projectId, (ownershipErr) => {
    if (ownershipErr) {
      if (ownershipErr.message.includes('Session not found')) {
        return res.status(403).json({ error: ownershipErr.message });
      }
      return res.status(500).json({ error: 'Database error' });
    }
    try {
      const memoryPaths = buildMemoryPaths(userId, projectId, sessionId);
      const content = readMemoryFile(memoryPaths.sessionMemoryFile);
      res.json({ user_id: userId, project_id: projectId, session_id: sessionId, content });
    } catch (e) {
      res.status(500).json({ error: 'Failed to read session memory' });
    }
  });
});

// session memory - write
app.post('/api/memory/session', (req, res) => {
  const { userId, projectId, sessionId, content, mode } = req.body || {};
  if (!userId || !projectId || !sessionId) {
    return res.status(400).json({ error: 'userId, projectId and sessionId are required' });
  }
  if (typeof content !== 'string') return res.status(400).json({ error: 'content(string) is required' });
  if (!assertRequesterMatchesTarget(req, userId)) {
    return res.status(403).json({ error: 'Forbidden: requester user mismatch' });
  }
  ensureSessionOwnership(sessionId, userId, projectId, (ownershipErr) => {
    if (ownershipErr) {
      if (ownershipErr.message.includes('Session not found')) {
        return res.status(403).json({ error: ownershipErr.message });
      }
      return res.status(500).json({ error: 'Database error' });
    }
    try {
      const memoryPaths = buildMemoryPaths(userId, projectId, sessionId);
      writeMemoryFile(memoryPaths.sessionMemoryFile, content, mode || 'overwrite');
      res.json({
        success: true,
        user_id: userId,
        project_id: projectId,
        session_id: sessionId,
        mode: mode || 'overwrite',
      });
    } catch (e) {
      res.status(500).json({ error: 'Failed to write session memory' });
    }
  });
});

// 获取某员工的所有历史会话
app.get('/api/sessions', (req, res) => {
  const { userId, projectId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  let sql = `SELECT * FROM sessions WHERE user_id = ?`;
  const params = [userId];
  if (projectId) {
    sql += ` AND project_id = ?`;
    params.push(projectId);
  }
  sql += ` ORDER BY created_at DESC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 获取特定会话的历史消息
app.get('/api/sessions/:sessionId/history', (req, res) => {
  const { sessionId } = req.params;
  const userId = getUserIdFromRequest(req);
  const projectId = getProjectIdFromRequest(req);

  ensureSessionOwnership(sessionId, userId, projectId, (ownershipErr, sessionRow) => {
    if (ownershipErr) {
      if (ownershipErr.message === 'userId is required') {
        return res.status(400).json({ error: 'userId is required' });
      }
      if (ownershipErr.message.includes('Session not found')) {
        return res.status(403).json({ error: ownershipErr.message });
      }
      return res.status(500).json({ error: 'Database error' });
    }

    const sessionPaths = buildSessionPaths(sessionRow.user_id, sessionRow.project_id, sessionId);
    const history = readHistoryWithCompatibility(sessionPaths);
    res.json(history);
  });
});

// 插入单条系统/上下文消息到历史记录
app.post('/api/sessions/:sessionId/message', (req, res) => {
  const { sessionId } = req.params;
  const { message, userId, projectId } = req.body;
  if (!message) return res.status(400).json({ error: 'message object is required' });
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  ensureSessionOwnership(sessionId, userId, projectId, (ownershipErr, sessionRow) => {
    if (ownershipErr) {
      if (ownershipErr.message.includes('Session not found')) {
        return res.status(403).json({ error: ownershipErr.message });
      }
      return res.status(500).json({ error: 'Database error' });
    }

    const sessionPaths = buildSessionPaths(sessionRow.user_id, sessionRow.project_id, sessionId);
    let history = readHistoryWithCompatibility(sessionPaths);
    
    if (Array.isArray(message)) {
      history.push(...message);
    } else {
      history.push(message);
    }
    
    writeHistory(sessionPaths, history);
    res.json({ success: true });
  });
});
app.post('/api/sessions', (req, res) => {
  const { userId, title, projectId, projectName } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const createSession = (targetProjectId) => {
    ensureUserExists(userId, (userErr) => {
      if (userErr) return res.status(500).json({ error: userErr.message });
      ensureProjectExists(userId, targetProjectId, projectName || '默认项目', (projectErr) => {
        if (projectErr) return res.status(500).json({ error: projectErr.message });
        const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const sessionTitle = title || '新对话';

        db.run(
          `INSERT INTO sessions (session_id, user_id, project_id, title) VALUES (?, ?, ?, ?)`,
          [sessionId, userId, targetProjectId, sessionTitle],
          function(err) {
            if (err) return res.status(500).json({ error: err.message });
            const sessionPaths = buildSessionPaths(userId, targetProjectId, sessionId);
            ensureDir(sessionPaths.sessionDir);
            ensureDir(sessionPaths.uploadDir);
            ensureTaskContractTemplate(sessionPaths.taskContractFile, {
              user_id: userId,
              project_id: targetProjectId,
            });
            const projectPaths = buildProjectPaths(userId, targetProjectId);
            writeJsonFileSafe(projectPaths.agentStateFile, getDefaultAgentState(userId, targetProjectId));
            // 新对话从重新规划开始：残留的 executing 契约（如上一轮交接后未完成）归位到 planned，
            // 避免新会话默认显示「执行中」并被误判为 Sub 模式。
            const existingContract = withTaskContractDefaults(
              readJsonFileSafe(projectPaths.taskContractFile, {}),
              { user_id: userId, project_id: targetProjectId }
            );
            if (String(existingContract.status || '').toLowerCase() === 'executing') {
              writeJsonFileSafe(projectPaths.taskContractFile, {
                ...existingContract,
                status: 'planned',
                updated_at: new Date().toISOString(),
              });
            }
            res.json({ session_id: sessionId, title: sessionTitle, project_id: targetProjectId });
          }
        );
      });
    });
  };

  if (projectId) {
    createSession(projectId);
  } else {
    ensureDefaultProject(userId, (defaultErr, defaultProjectId) => {
      if (defaultErr) return res.status(500).json({ error: defaultErr.message });
      createSession(defaultProjectId);
    });
  }
});

// 子进程 worker.js 的路径
const WORKER_PATH = path.resolve(__dirname, '../open-codex-source/codex-cli/dist/worker.js');

// ==========================================
// 3. 核心流式对话接口
// ==========================================
app.post('/api/chat', (req, res) => {
  // 现在前端必须同时传递 userId 和 sessionId
  const { prompt, sessionId, userId, projectId, agentMode } = req.body;
  if (!prompt || !sessionId || !userId) {
    return res.status(400).json({ error: 'prompt, sessionId, and userId are required' });
  }

  // 验证 session 是否属于该 user
  const params = [sessionId, userId];
  let sql = `SELECT * FROM sessions WHERE session_id = ? AND user_id = ?`;
  if (projectId) {
    sql += ` AND project_id = ?`;
    params.push(projectId);
  }
  db.get(sql, params, (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(403).json({ error: 'Session not found or belongs to another user/project' });

    const sessionPaths = buildSessionPaths(row.user_id, row.project_id, sessionId);
    const sessionDir = sessionPaths.sessionDir;
    ensureDir(sessionDir);
    ensureDir(sessionPaths.uploadDir);
    ensureTaskContractTemplate(sessionPaths.taskContractFile, row);

    // 确保工作目录存在并隔离
    // 读取历史记录但不要写回，让 worker 能够读取旧的记录作为 prevItems
    let history = readHistoryWithCompatibility(sessionPaths);
    
    // 把当前用户输入加入内存中的历史
    history.push({ role: 'user', content: [{ type: 'text', text: prompt }] });

    const projectPaths = buildProjectPaths(row.user_id, row.project_id);
    const currentContract = withTaskContractDefaults(
      readJsonFileSafe(projectPaths.taskContractFile, {}),
      row
    );
    const syncedState = syncProjectAgentState(projectPaths, row.user_id, row.project_id, currentContract);
    const requestedMode = ['master', 'sub'].includes(agentMode) ? agentMode : null;
    const resolvedAgentMode = requestedMode
      ? requestedMode
      : resolveEffectiveAgentMode(currentContract, syncedState.active_agent);
    const promptFile = getPromptFileByMode(resolvedAgentMode);
    const rolePrompt = fs.existsSync(promptFile) ? fs.readFileSync(promptFile, 'utf8') : '';
    writeJsonFileSafe(projectPaths.agentStateFile, {
      ...syncedState,
      active_agent: resolvedAgentMode,
      updated_at: new Date().toISOString(),
    });
    const allowedSkills = Array.isArray(currentContract.allowed_skills)
      ? currentContract.allowed_skills
      : [];
    if (resolvedAgentMode === 'sub' && allowedSkills.length === 0) {
      return res.status(400).json({
        error: 'Sub mode requires non-empty task_contract.allowed_skills',
      });
    }
    const nextStatus = resolvedAgentMode === 'sub' ? 'executing' : 'planned';
    writeJsonFileSafe(projectPaths.taskContractFile, {
      ...currentContract,
      status: nextStatus,
      updated_at: new Date().toISOString(),
    });
    const promptHash = crypto.createHash('sha1').update(rolePrompt || '').digest('hex').slice(0, 12);

    // 返回 SSE 响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Session-Id': sessionId,
      'X-Agent-Mode': resolvedAgentMode,
      'X-Agent-Prompt-Hash': promptHash,
      'X-Agent-Policy': resolvedAgentMode === 'master' ? 'plan_only' : 'execute_contract',
    });

    // 启动 Headless 隔离的 Agent 子进程
    const worker = spawn('node', [WORKER_PATH], {
      cwd: sessionDir,
      env: {
        ...process.env,
        WORKER_PROMPT: prompt,
        WORKER_CWD: sessionDir,
        WORKER_PROJECT_ROOT: path.resolve(__dirname, '..'),
        WORKER_SKILLS_DIR: path.resolve(__dirname, '../skills'),
        WORKER_PYTHON_BIN: process.env.WORKER_PYTHON_BIN || 'python3',
        WORKER_MODEL: req.body.model || 'MiniMax-M2.7',
        WORKER_PROVIDER: req.body.provider || 'openai',
        WORKER_AGENT_MODE: resolvedAgentMode,
        WORKER_AGENT_SYSTEM_PROMPT: rolePrompt,
        WORKER_TASK_CONTRACT_FILE: projectPaths.taskContractFile,
        WORKER_ALLOWED_SKILLS: JSON.stringify(allowedSkills),
      }
    });

    // worker 输出 done 后理应自行退出；若残留句柄导致进程挂着，超时强杀并按成功收尾，
    // 否则 SSE 流永不结束，前端一直处于运行状态。
    let workerDoneCleanly = false;
    let doneKillTimer = null;

    // 捕获无头 CLI 的纯净 JSON 流并转发为 SSE
    worker.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim() !== '');
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line); // 尝试解析确保是合法 JSON
          if (parsed.type === 'item') {
            history.push(parsed.data);
            writeHistory(sessionPaths, history);
          }
          if (parsed.type === 'done') {
            workerDoneCleanly = true;
            if (!doneKillTimer) {
              doneKillTimer = setTimeout(() => {
                console.log(`Worker [${sessionId}] done but still alive, force killing`);
                worker.kill();
              }, 3000);
            }
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
      if (doneKillTimer) {
        clearTimeout(doneKillTimer);
        doneKillTimer = null;
      }
      // worker 已发出 done 事件即视为任务正常完成，即使是被超时兜底强杀（code null）
      const succeeded = code === 0 || workerDoneCleanly;
      const latestContract = withTaskContractDefaults(
        readJsonFileSafe(projectPaths.taskContractFile, {}),
        row
      );
      if (resolvedAgentMode === 'sub') {
        const finalStatus = succeeded ? 'validating' : 'failed';
        writeJsonFileSafe(projectPaths.taskContractFile, {
          ...latestContract,
          status: finalStatus,
          executor_result: {
            ...(latestContract.executor_result || {}),
            last_exit_code: succeeded ? 0 : code,
            finished_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        });
        writeJsonFileSafe(projectPaths.agentStateFile, {
          ...readProjectAgentState(projectPaths, row.user_id, row.project_id),
          active_agent: 'master',
          updated_at: new Date().toISOString(),
        });
      }
      console.log(`Worker [${sessionId}] exited with code ${code}${workerDoneCleanly ? ' (done cleanly)' : ''}`);
      res.write(`data: {"type": "exit", "code": ${succeeded ? 0 : code}}\n\n`);
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

// ==========================================
// 5. 报告生成与数据抽取接口
// ==========================================
app.post('/api/generate-report', (req, res) => {
  const config = req.body;

  if (!config) {
    return res.status(400).json({ error: 'Config body is required' });
  }

  // 报告引擎属于“执行”能力：仅允许 sub 触发，master 必须委派 sub。
  const { userId, projectId, agentMode } = config;
  let activeAgent = null;
  if (userId && projectId) {
    const projectPaths = buildProjectPaths(userId, projectId);
    const state = readJsonFileSafe(
      projectPaths.agentStateFile,
      getDefaultAgentState(userId, projectId)
    );
    activeAgent = state.active_agent || 'master';
  } else if (agentMode) {
    activeAgent = agentMode;
  }

  if (activeAgent !== 'sub') {
    return res.status(403).json({
      error: 'policy_violation',
      reason: 'report engine is sub-only; master must delegate execution to sub',
      active_agent: activeAgent || 'unknown',
    });
  }

  // 仅把引擎需要的字段透传给 Python，剔除策略/路由字段。
  const enginePayload = { ...config };
  delete enginePayload.userId;
  delete enginePayload.projectId;
  delete enginePayload.agentMode;

  const runnerPath = path.resolve(__dirname, '../skills/run_es_agent.py');

  // 启动 Python 子进程
  const runner = spawn('python3', [runnerPath], {
    cwd: path.resolve(__dirname, '../skills')
  });

  let output = '';
  let errorOutput = '';

  runner.stdout.on('data', (data) => {
    output += data.toString();
  });

  runner.stderr.on('data', (data) => {
    errorOutput += data.toString();
  });

  runner.on('close', (code) => {
    if (code !== 0) {
      console.error(`Python runner exited with code ${code}. Error: ${errorOutput}`);
      return res.status(500).json({ error: 'Data generation failed', details: errorOutput });
    }

    try {
      const parsedData = JSON.parse(output);
      // 执行成功：写入 executor_result，并推进 contract 状态 executing -> validating。
      if (userId && projectId) {
        try {
          const projectPaths = buildProjectPaths(userId, projectId);
          const contract = withTaskContractDefaults(
            readJsonFileSafe(projectPaths.taskContractFile, {}),
            { user_id: userId, project_id: projectId }
          );
          writeJsonFileSafe(projectPaths.taskContractFile, {
            ...contract,
            status: 'validating',
            executor_result: {
              ...(contract.executor_result || {}),
              report_generated: true,
              schema: enginePayload.schema || '',
              finished_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          });
          writeJsonFileSafe(projectPaths.agentStateFile, {
            ...readProjectAgentState(projectPaths, userId, projectId),
            active_agent: 'master',
            updated_at: new Date().toISOString(),
          });
        } catch (contractErr) {
          console.error('Failed to update task contract after report:', contractErr.message);
        }
      }
      res.json(parsedData);
    } catch (e) {
      console.error('Failed to parse python output:', output);
      res.status(500).json({ error: 'Invalid JSON from python script', rawOutput: output });
    }
  });

  // 向 Python 脚本写入 JSON 配置
  runner.stdin.write(JSON.stringify(enginePayload));
  runner.stdin.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Gateway listening on port ${PORT}`);
  console.log(`SSE Endpoint ready at http://localhost:${PORT}/api/chat`);
});
