import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = path.resolve(process.cwd(), "..");
const GATEWAY_DIR = path.join(ROOT, "gateway");
const DATA_ROOT = path.join(ROOT, "data", "users");
const LEGACY_SESSIONS_ROOT = path.join(ROOT, "sessions");
const BASE_URL = "http://127.0.0.1:3101";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/sessions?userId=1001`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await sleep(300);
  }
  throw new Error("Server did not start in time");
}

async function createSession({ userId, title, projectId }) {
  const res = await fetch(`${BASE_URL}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, title, projectId }),
  });
  const data = await res.json();
  assert.equal(res.status, 200, `createSession failed: ${JSON.stringify(data)}`);
  return data;
}

async function postMessage({ sessionId, userId, projectId, text }) {
  const res = await fetch(`${BASE_URL}/api/sessions/${sessionId}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      projectId,
      message: { role: "user", content: [{ type: "text", text }] },
    }),
  });
  const data = await res.json();
  assert.equal(res.status, 200, `postMessage failed: ${JSON.stringify(data)}`);
}

function resolveSessionDir(userId, projectId, sessionId) {
  return path.join(DATA_ROOT, userId, "projects", projectId, "sessions", sessionId);
}

async function run() {
  const server = spawn("node", ["server.js"], {
    cwd: GATEWAY_DIR,
    env: { ...process.env, PORT: "3101" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  server.stderr.on("data", (d) => {
    stderr += d.toString();
  });

  try {
    await waitForServer(BASE_URL);

    // 1) 不带 projectId 创建会话 => 自动绑定默认项目
    const s1 = await createSession({ userId: "1001", title: "m2-default-project" });
    assert.ok(s1.project_id?.startsWith("proj_default_"), "default project_id should be assigned");

    // 2) task_contract 模板应存在
    const contractPath = path.join(DATA_ROOT, "1001", "projects", s1.project_id, "task_contract.json");
    assert.equal(fs.existsSync(contractPath), true, "task_contract.json should be bootstrapped");

    // 3) 指定 projectId 创建会话
    const s2 = await createSession({
      userId: "1001",
      title: "m2-custom-project",
      projectId: "proj_omron_hr",
    });
    assert.equal(s2.project_id, "proj_omron_hr");

    // 4) 正常写消息 + 读历史（同用户同项目）
    await postMessage({
      sessionId: s2.session_id,
      userId: "1001",
      projectId: "proj_omron_hr",
      text: "hello-project-history",
    });
    const historyRes = await fetch(
      `${BASE_URL}/api/sessions/${s2.session_id}/history?userId=1001&projectId=proj_omron_hr`
    );
    const history = await historyRes.json();
    assert.equal(historyRes.status, 200);
    assert.ok(Array.isArray(history));
    assert.ok(
      history.some((item) => JSON.stringify(item).includes("hello-project-history")),
      "history should contain newly posted message"
    );

    // 5) 跨项目访问拒绝
    const wrongProjectRes = await fetch(
      `${BASE_URL}/api/sessions/${s2.session_id}/history?userId=1001&projectId=proj_another`
    );
    assert.equal(wrongProjectRes.status, 403, "cross-project access should be rejected");

    // 6) 旧路径兼容读取并迁移
    const s3 = await createSession({
      userId: "1001",
      title: "m2-legacy-migration",
      projectId: "proj_migrate_test",
    });
    const newSessionDir = resolveSessionDir("1001", "proj_migrate_test", s3.session_id);
    const newHistoryFile = path.join(newSessionDir, "messages.json");
    if (fs.existsSync(newHistoryFile)) fs.rmSync(newHistoryFile, { force: true });
    const legacyDir = path.join(LEGACY_SESSIONS_ROOT, s3.session_id);
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, "messages.json"),
      JSON.stringify([{ role: "user", content: [{ type: "text", text: "legacy-content" }] }], null, 2),
      "utf8"
    );
    const legacyRes = await fetch(
      `${BASE_URL}/api/sessions/${s3.session_id}/history?userId=1001&projectId=proj_migrate_test`
    );
    const legacyHistory = await legacyRes.json();
    assert.equal(legacyRes.status, 200);
    assert.ok(
      legacyHistory.some((item) => JSON.stringify(item).includes("legacy-content")),
      "legacy history should be returned"
    );
    assert.equal(fs.existsSync(newHistoryFile), true, "legacy history should be migrated to new path");

    // 7) 上传/下载走新路径
    const fileContent = "m2-upload-file";
    const form = new FormData();
    form.append("file", new Blob([fileContent], { type: "text/plain" }), "m2.txt");
    const uploadRes = await fetch(
      `${BASE_URL}/api/sessions/${s2.session_id}/upload?userId=1001&projectId=proj_omron_hr`,
      { method: "POST", body: form }
    );
    const uploadJson = await uploadRes.json();
    assert.equal(uploadRes.status, 200, `upload failed: ${JSON.stringify(uploadJson)}`);
    const uploadedFile = path.join(
      resolveSessionDir("1001", "proj_omron_hr", s2.session_id),
      "uploads",
      "m2.txt"
    );
    assert.equal(fs.existsSync(uploadedFile), true, "uploaded file should exist in new upload dir");
    const downloadRes = await fetch(
      `${BASE_URL}/api/sessions/${s2.session_id}/download/m2.txt?userId=1001&projectId=proj_omron_hr`
    );
    assert.equal(downloadRes.status, 200);
    const downloaded = await downloadRes.text();
    assert.equal(downloaded, fileContent);

    console.log("M2 step1 integration tests passed.");
  } finally {
    server.kill("SIGTERM");
    await sleep(500);
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
  }
}

run().catch((err) => {
  console.error("M2 step1 integration tests failed:", err);
  process.exit(1);
});
