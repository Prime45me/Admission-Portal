const test = require("node:test");
const assert = require("node:assert");
const { startTestServer, createToken } = require("./test_helpers");
const app = require("../server");
const pool = require("../db/db");

test("Admin Authentication & Route Protection", async (t) => {
  let testEnv;

  t.before(async () => {
    testEnv = await startTestServer(app);
  });

  t.after(async () => {
    await testEnv.close();
  });

  await t.test("rejects request with missing Authorization header (401)", async () => {
    const res = await fetch(`${testEnv.baseUrl}/api/applications`);
    const body = await res.json();
    assert.strictEqual(res.status, 401);
    assert.strictEqual(body.message, "Authentication required");
  });

  await t.test("rejects request with malformed Authorization header (401)", async () => {
    const malformedHeaders = [
      "Basic dXNlcjpwYXNz",
      "Bearer",
      "Bearer ",
      "Token abcdef",
      "Bearer not-a-valid-jwt-token",
    ];

    for (const authHeader of malformedHeaders) {
      const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
        headers: { Authorization: authHeader },
      });
      const body = await res.json();
      assert.strictEqual(res.status, 401);
      assert.ok(
        body.message === "Authentication required" ||
          body.message === "Invalid or expired token"
      );
    }
  });

  await t.test("rejects request with expired token (401)", async () => {
    const expiredToken = createToken({ id: 1, role: "admin" }, { expiresIn: "-1s" });
    const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    const body = await res.json();
    assert.strictEqual(res.status, 401);
    assert.strictEqual(body.message, "Invalid or expired token");
  });

  await t.test("rejects request with token signed by different secret (401)", async () => {
    const jwt = require("jsonwebtoken");
    const wrongSecretToken = jwt.sign({ id: 1, role: "admin" }, "wrong_secret_12345");
    const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
      headers: { Authorization: `Bearer ${wrongSecretToken}` },
    });
    const body = await res.json();
    assert.strictEqual(res.status, 401);
    assert.strictEqual(body.message, "Invalid or expired token");
  });

  await t.test("rejects token with non-admin role (403)", async () => {
    const nonAdminToken = createToken({ id: 2, role: "staff" });
    const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
      headers: { Authorization: `Bearer ${nonAdminToken}` },
    });
    const body = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(body.message, "Admin access required");
  });

  await t.test("rejects token with invalid admin ID (401)", async () => {
    const invalidIdToken = createToken({ id: -1, role: "admin" });
    const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
      headers: { Authorization: `Bearer ${invalidIdToken}` },
    });
    const body = await res.json();
    assert.strictEqual(res.status, 401);
    assert.strictEqual(body.message, "Invalid or expired token");
  });

  await t.test("allows protected route access with valid admin token (200)", async () => {
    const originalQuery = pool.query;
    pool.query = async (sql) => {
      if (sql.includes("COUNT(*)")) {
        return { rows: [{ count: "0" }] };
      }
      return { rows: [] };
    };

    try {
      const adminToken = createToken({ id: 1, role: "admin" });
      const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.total, 0);
      assert.deepStrictEqual(body.applications, []);
    } finally {
      pool.query = originalQuery;
    }
  });

  await t.test("public submission route is accessible without any token (400 validation, not 401)", async () => {
    // Sending empty body to POST /api/applications without Authorization header
    const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 400); // 400 Bad Request, NOT 401 Unauthorized
  });
});
