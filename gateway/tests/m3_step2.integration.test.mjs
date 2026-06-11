import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const BASE_URL = "http://127.0.0.1:3104";

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

function promptHash(content) {
  return crypto.createHash("sha1").update(content || "").digest("hex").slice(0, 12);
}

async function run() {
  const server = spawn("node", ["server.js"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, PORT: "3104" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  server.stderr.on("data", (d) => {
    stderr += d.toString();
  });

  const userId = "3002";
  const projectId = `proj_m3_step2_${Date.now()}`;
  let originalMasterPrompt = "";

  try {
    await waitForServer();

    const createProjectRes = await fetch(`${BASE_URL}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({ userId, name: "M3-Step2", projectId }),
    });
    assert.equal(createProjectRes.status, 200);

    const invalidRoleRes = await fetch(
      `${BASE_URL}/api/agents/invalid/system-prompt?userId=${userId}`,
      { headers: { "x-user-id": userId } }
    );
    assert.equal(invalidRoleRes.status, 400);

    const getMasterRes = await fetch(
      `${BASE_URL}/api/agents/master/system-prompt?userId=${userId}`,
      { headers: { "x-user-id": userId } }
    );
    const getMasterData = await readJson(getMasterRes);
    assert.equal(getMasterRes.status, 200);
    originalMasterPrompt = getMasterData.content || "";

    const emptyPromptRes = await fetch(`${BASE_URL}/api/agents/master/system-prompt`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({ userId, content: "   " }),
    });
    assert.equal(emptyPromptRes.status, 400);

    const mismatchUserRes = await fetch(
      `${BASE_URL}/api/agents/master/system-prompt?userId=${userId}`,
      { headers: { "x-user-id": "9999" } }
    );
    assert.equal(mismatchUserRes.status, 403);

    const updatedPrompt = `${originalMasterPrompt}\n\n# m3-step2-test-${Date.now()}\n`;
    const putPromptRes = await fetch(`${BASE_URL}/api/agents/master/system-prompt`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({ userId, content: updatedPrompt }),
    });
    assert.equal(putPromptRes.status, 200);

    const verifyPromptRes = await fetch(
      `${BASE_URL}/api/agents/master/system-prompt?userId=${userId}`,
      { headers: { "x-user-id": userId } }
    );
    const verifyPromptData = await readJson(verifyPromptRes);
    assert.equal(verifyPromptRes.status, 200);
    assert.equal(verifyPromptData.content, updatedPrompt);

    const setMasterStateRes = await fetch(`${BASE_URL}/api/projects/${projectId}/agent-state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({ userId, active_agent: "master" }),
    });
    assert.equal(setMasterStateRes.status, 200);

    const createSessionRes = await fetch(`${BASE_URL}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, projectId, title: "m3-step2-session" }),
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
        model: "MiniMax-M2.7",
        provider: "openai",
      }),
    });
    assert.equal(chatRes.status, 200);
    assert.equal(chatRes.headers.get("x-agent-mode"), "master");
    assert.equal(chatRes.headers.get("x-agent-prompt-hash"), promptHash(updatedPrompt));
    await chatRes.body?.cancel();

    console.log("M3 step2 integration tests passed.");
  } finally {
    if (originalMasterPrompt) {
      await fetch(`${BASE_URL}/api/agents/master/system-prompt`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-user-id": userId },
        body: JSON.stringify({ userId, content: originalMasterPrompt }),
      }).catch(() => {});
    }
    server.kill("SIGTERM");
    await sleep(500);
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
  }
}

run().catch((err) => {
  console.error("M3 step2 integration tests failed:", err);
  process.exit(1);
});
