import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const BASE_URL = "http://127.0.0.1:3107";

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
    env: { ...process.env, PORT: "3107" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  server.stderr.on("data", (d) => {
    stderr += d.toString();
  });

  try {
    await waitForServer();

    const userId = "3007";
    const projectId = `proj_m3_report_${Date.now()}`;
    const createProjectRes = await fetch(`${BASE_URL}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({ userId, name: "M3-Report-Policy", projectId }),
    });
    assert.equal(createProjectRes.status, 200);

    // master 态：报告引擎必须被拒绝
    const setMasterRes = await fetch(`${BASE_URL}/api/projects/${projectId}/agent-state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({ userId, active_agent: "master" }),
    });
    assert.equal(setMasterRes.status, 200);

    const masterReportRes = await fetch(`${BASE_URL}/api/generate-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        projectId,
        schema: "brand_monthly",
        uid: "134209751",
        partition: "202604",
      }),
    });
    const masterReportBody = await readJson(masterReportRes);
    assert.equal(masterReportRes.status, 403, "master must be blocked from report engine");
    assert.equal(masterReportBody.error, "policy_violation");

    // 无身份信息：默认拒绝（default-deny）
    const anonReportRes = await fetch(`${BASE_URL}/api/generate-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema: "brand_monthly" }),
    });
    assert.equal(anonReportRes.status, 403, "anonymous report request must be denied");

    // body.agentMode=sub 覆盖（无 projectId/userId 路径）应放行进入引擎
    const subOverrideRes = await fetch(`${BASE_URL}/api/generate-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentMode: "sub", schema: "brand_monthly", uid: "x", partition: "y" }),
    });
    // 不校验业务结果（引擎可能因 mock 数据返回 200/500），只确认未被策略 403 拦截
    assert.notEqual(subOverrideRes.status, 403, "sub override should pass policy gate");
    await subOverrideRes.body?.cancel?.();

    console.log("M3 report policy integration tests passed.");
  } finally {
    server.kill("SIGTERM");
    await sleep(500);
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
  }
}

run().catch((err) => {
  console.error("M3 report policy integration tests failed:", err);
  process.exit(1);
});
