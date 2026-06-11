import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const BASE_URL = "http://127.0.0.1:3105";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/sessions?userId=1001`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await sleep(300);
  }
  throw new Error("Server did not start in time");
}

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function run() {
  const server = spawn("node", ["server.js"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, PORT: "3105" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  server.stderr.on("data", (d) => {
    stderr += d.toString();
  });

  try {
    await waitForServer();

    const userId = "3005";
    const projectId = `proj_m3_guard_${Date.now()}`;
    const createProjectRes = await fetch(`${BASE_URL}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({ userId, name: "M3-Policy-Guard", projectId }),
    });
    assert.equal(createProjectRes.status, 200);

    const createSessionRes = await fetch(`${BASE_URL}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, projectId, title: "guard-session" }),
    });
    const session = await readJson(createSessionRes);
    assert.equal(createSessionRes.status, 200);

    const setMasterStateRes = await fetch(`${BASE_URL}/api/projects/${projectId}/agent-state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({ userId, active_agent: "master" }),
    });
    assert.equal(setMasterStateRes.status, 200);

    const setContractRes = await fetch(`${BASE_URL}/api/projects/${projectId}/task-contract`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({
        userId,
        contract: {
          task_id: "guard_task_1",
          goal: "验证 Master/Sub 约束",
          allowed_skills: ["web_search"],
          acceptance_criteria: ["Sub 仅可执行白名单技能"],
          status: "planned",
        },
      }),
    });
    assert.equal(setContractRes.status, 200);

    const masterChatRes = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "仅生成计划，不要执行技能",
        userId,
        projectId,
        sessionId: session.session_id,
      }),
    });
    assert.equal(masterChatRes.status, 200);
    assert.equal(masterChatRes.headers.get("x-agent-mode"), "master");
    assert.equal(masterChatRes.headers.get("x-agent-policy"), "plan_only");
    await masterChatRes.body?.cancel();

    const setSubStateRes = await fetch(`${BASE_URL}/api/projects/${projectId}/agent-state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({ userId, active_agent: "sub" }),
    });
    assert.equal(setSubStateRes.status, 200);

    const clearContractRes = await fetch(`${BASE_URL}/api/projects/${projectId}/task-contract`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({
        userId,
        contract: {
          task_id: "guard_task_2",
          goal: "空白名单应被阻断",
          allowed_skills: [],
          acceptance_criteria: ["应返回 400"],
          status: "planned",
        },
      }),
    });
    assert.equal(clearContractRes.status, 200);

    const subBlockedRes = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "执行任务",
        userId,
        projectId,
        sessionId: session.session_id,
        agentMode: "sub",
      }),
    });
    const subBlockedBody = await readJson(subBlockedRes);
    assert.equal(subBlockedRes.status, 400);
    assert.match(subBlockedBody.error || "", /allowed_skills/i);

    console.log("M3 policy guard integration tests passed.");
  } finally {
    server.kill("SIGTERM");
    await sleep(500);
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
  }
}

run().catch((err) => {
  console.error("M3 policy guard integration tests failed:", err);
  process.exit(1);
});
