import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const BASE_URL = "http://127.0.0.1:3106";

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
    env: { ...process.env, PORT: "3106" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  server.stderr.on("data", (d) => {
    stderr += d.toString();
  });

  try {
    await waitForServer();

    const userId = "3006";
    const projectId = `proj_m3_flow_${Date.now()}`;
    const createProjectRes = await fetch(`${BASE_URL}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({ userId, name: "M3-Contract-Flow", projectId }),
    });
    assert.equal(createProjectRes.status, 200);

    const initialContractRes = await fetch(
      `${BASE_URL}/api/projects/${projectId}/task-contract?userId=${userId}`,
      { headers: { "x-user-id": userId } }
    );
    const initialContract = await readJson(initialContractRes);
    assert.equal(initialContractRes.status, 200);
    assert.equal(initialContract.status, "planned");
    assert.equal(typeof initialContract.executor_result, "object");
    assert.equal(typeof initialContract.validation_result, "object");

    const setExecutingRes = await fetch(`${BASE_URL}/api/projects/${projectId}/task-contract`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({
        userId,
        contract: {
          task_id: "flow_task_1",
          goal: "状态机流转验证",
          allowed_skills: ["web_search"],
          acceptance_criteria: ["状态可顺序推进"],
          status: "executing",
        },
      }),
    });
    assert.equal(setExecutingRes.status, 200);

    const setValidatingRes = await fetch(`${BASE_URL}/api/projects/${projectId}/task-contract`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({
        userId,
        contract: {
          task_id: "flow_task_1",
          goal: "状态机流转验证",
          allowed_skills: ["web_search"],
          acceptance_criteria: ["状态可顺序推进"],
          status: "validating",
          executor_result: {
            summary: "sub done",
          },
        },
      }),
    });
    assert.equal(setValidatingRes.status, 200);

    const setCompletedRes = await fetch(`${BASE_URL}/api/projects/${projectId}/task-contract`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({
        userId,
        contract: {
          task_id: "flow_task_1",
          goal: "状态机流转验证",
          allowed_skills: ["web_search"],
          acceptance_criteria: ["状态可顺序推进"],
          status: "completed",
          validation_result: {
            passed: true,
          },
        },
      }),
    });
    assert.equal(setCompletedRes.status, 200);

    const invalidTransitionRes = await fetch(`${BASE_URL}/api/projects/${projectId}/task-contract`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({
        userId,
        contract: {
          task_id: "flow_task_1",
          goal: "状态机流转验证",
          allowed_skills: ["web_search"],
          acceptance_criteria: ["状态可顺序推进"],
          status: "executing",
        },
      }),
    });
    const invalidTransitionBody = await readJson(invalidTransitionRes);
    assert.equal(invalidTransitionRes.status, 400);
    assert.match(invalidTransitionBody.error || "", /status transition/i);

    console.log("M3 contract flow integration tests passed.");
  } finally {
    server.kill("SIGTERM");
    await sleep(500);
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
  }
}

run().catch((err) => {
  console.error("M3 contract flow integration tests failed:", err);
  process.exit(1);
});
