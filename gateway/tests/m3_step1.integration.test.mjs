import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const BASE_URL = "http://127.0.0.1:3103";

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
    env: { ...process.env, PORT: "3103" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  server.stderr.on("data", (d) => {
    stderr += d.toString();
  });

  try {
    await waitForServer();

    const userId = "3001";
    const projectId = `proj_m3_${Date.now()}`;

    const createProjectRes = await fetch(`${BASE_URL}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({ userId, name: "M3测试项目", projectId }),
    });
    assert.equal(createProjectRes.status, 200);

    const skillsRes = await fetch(`${BASE_URL}/api/skills/registry?role=sub&enabled=true`);
    const skillsData = await readJson(skillsRes);
    assert.equal(skillsRes.status, 200);
    assert.ok(Array.isArray(skillsData.skills));
    assert.ok(skillsData.skills.every((s) => s.role === "sub"), "registry role filter should work");

    const agentStateRes = await fetch(
      `${BASE_URL}/api/projects/${projectId}/agent-state?userId=${userId}`,
      { headers: { "x-user-id": userId } }
    );
    const agentState = await readJson(agentStateRes);
    assert.equal(agentStateRes.status, 200);
    assert.equal(agentState.active_agent, "master");

    const setAgentStateRes = await fetch(`${BASE_URL}/api/projects/${projectId}/agent-state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({ userId, active_agent: "sub" }),
    });
    assert.equal(setAgentStateRes.status, 200);

    const getContractRes = await fetch(
      `${BASE_URL}/api/projects/${projectId}/task-contract?userId=${userId}`,
      { headers: { "x-user-id": userId } }
    );
    const contract = await readJson(getContractRes);
    assert.equal(getContractRes.status, 200);
    assert.equal(contract.project_id, projectId);

    const updateContractRes = await fetch(`${BASE_URL}/api/projects/${projectId}/task-contract`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({
        userId,
        contract: {
          task_id: "task_m3_1",
          goal: "验证 M3 看板数据链路",
          allowed_skills: ["es_agg_search"],
          acceptance_criteria: ["返回成功"],
        },
      }),
    });
    assert.equal(updateContractRes.status, 200);

    const createSessionRes = await fetch(`${BASE_URL}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, projectId, title: "m3-runtime" }),
    });
    const session = await readJson(createSessionRes);
    assert.equal(createSessionRes.status, 200);

    const chatRes = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "ping",
        userId,
        projectId,
        sessionId: session.session_id,
        agentMode: "sub",
        model: "MiniMax-M2.7",
        provider: "openai",
      }),
    });
    assert.equal(chatRes.status, 200);
    assert.equal(chatRes.headers.get("x-agent-mode"), "sub");
    await chatRes.body?.cancel();

    console.log("M3 step1 integration tests passed.");
  } finally {
    server.kill("SIGTERM");
    await sleep(500);
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
  }
}

run().catch((err) => {
  console.error("M3 step1 integration tests failed:", err);
  process.exit(1);
});
