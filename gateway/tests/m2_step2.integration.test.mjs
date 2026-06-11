import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const BASE_URL = "http://127.0.0.1:3102";

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
    env: { ...process.env, PORT: "3102" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  server.stderr.on("data", (d) => {
    stderr += d.toString();
  });

  try {
    await waitForServer();

    const userId = "2001";
    const projectId = `proj_m2_step2_${Date.now()}`;
    const projectRes = await fetch(`${BASE_URL}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({
        userId,
        name: "M2-Step2 项目",
        projectId,
      }),
    });
    const project = await readJson(projectRes);
    assert.equal(projectRes.status, 200, `create project failed: ${JSON.stringify(project)}`);
    assert.equal(project.project_id, projectId);

    const listRes = await fetch(`${BASE_URL}/api/projects?userId=${userId}`, {
      headers: { "x-user-id": userId },
    });
    const list = await readJson(listRes);
    assert.equal(listRes.status, 200);
    assert.ok(Array.isArray(list));
    assert.ok(list.some((p) => p.project_id === projectId), "project should appear in list");

    const sessionRes = await fetch(`${BASE_URL}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        projectId,
        title: "step2-session",
      }),
    });
    const session = await readJson(sessionRes);
    assert.equal(sessionRes.status, 200, `create session failed: ${JSON.stringify(session)}`);

    const filteredSessionsRes = await fetch(
      `${BASE_URL}/api/sessions?userId=${userId}&projectId=${projectId}`
    );
    const filteredSessions = await readJson(filteredSessionsRes);
    assert.equal(filteredSessionsRes.status, 200);
    assert.ok(
      filteredSessions.some((s) => s.session_id === session.session_id),
      "session should be queryable by project filter"
    );

    // user memory
    const userMemoryWriteRes = await fetch(`${BASE_URL}/api/memory/user`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({ userId, content: "user-memory-line-1", mode: "overwrite" }),
    });
    assert.equal(userMemoryWriteRes.status, 200);
    const userMemoryAppendRes = await fetch(`${BASE_URL}/api/memory/user`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({ userId, content: "user-memory-line-2", mode: "append" }),
    });
    assert.equal(userMemoryAppendRes.status, 200);
    const userMemoryReadRes = await fetch(`${BASE_URL}/api/memory/user?userId=${userId}`, {
      headers: { "x-user-id": userId },
    });
    const userMemory = await readJson(userMemoryReadRes);
    assert.equal(userMemoryReadRes.status, 200);
    assert.ok(userMemory.content.includes("user-memory-line-1"));
    assert.ok(userMemory.content.includes("user-memory-line-2"));

    // project memory
    const projectMemoryWriteRes = await fetch(`${BASE_URL}/api/memory/project`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({
        userId,
        projectId,
        content: "project-memory-note",
        mode: "overwrite",
      }),
    });
    assert.equal(projectMemoryWriteRes.status, 200);
    const projectMemoryReadRes = await fetch(
      `${BASE_URL}/api/memory/project?userId=${userId}&projectId=${projectId}`,
      { headers: { "x-user-id": userId } }
    );
    const projectMemory = await readJson(projectMemoryReadRes);
    assert.equal(projectMemoryReadRes.status, 200);
    assert.equal(projectMemory.content, "project-memory-note");

    // session memory
    const sessionMemoryWriteRes = await fetch(`${BASE_URL}/api/memory/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({
        userId,
        projectId,
        sessionId: session.session_id,
        content: "session-memory-note",
        mode: "overwrite",
      }),
    });
    assert.equal(sessionMemoryWriteRes.status, 200);
    const sessionMemoryReadRes = await fetch(
      `${BASE_URL}/api/memory/session?userId=${userId}&projectId=${projectId}&sessionId=${session.session_id}`,
      { headers: { "x-user-id": userId } }
    );
    const sessionMemory = await readJson(sessionMemoryReadRes);
    assert.equal(sessionMemoryReadRes.status, 200);
    assert.equal(sessionMemory.content, "session-memory-note");

    // security checks
    const mismatchUserRes = await fetch(`${BASE_URL}/api/memory/user`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-id": "9999" },
      body: JSON.stringify({ userId, content: "forbidden-write" }),
    });
    assert.equal(mismatchUserRes.status, 403, "header user mismatch should be rejected");

    const wrongProjectOwnerRes = await fetch(
      `${BASE_URL}/api/memory/project?userId=9999&projectId=${projectId}`,
      { headers: { "x-user-id": "9999" } }
    );
    assert.equal(wrongProjectOwnerRes.status, 403, "cross-user project memory read should be rejected");

    const wrongSessionProjectRes = await fetch(`${BASE_URL}/api/memory/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({
        userId,
        projectId: "proj_not_match",
        sessionId: session.session_id,
        content: "forbidden",
      }),
    });
    assert.equal(wrongSessionProjectRes.status, 403, "cross-project session memory write should be rejected");

    console.log("M2 step2 integration tests passed.");
  } finally {
    server.kill("SIGTERM");
    await sleep(500);
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
  }
}

run().catch((err) => {
  console.error("M2 step2 integration tests failed:", err);
  process.exit(1);
});
