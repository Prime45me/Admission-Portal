const test = require("node:test");
const assert = require("node:assert");
const { startTestServer, createToken } = require("./test_helpers");
const app = require("../server");
const pool = require("../db/db");

test("Dashboard Application Statistics (GET /api/applications/stats)", async (t) => {
  let testEnv;
  const adminToken = createToken({ id: 1, role: "admin" });
  const authHeaders = { Authorization: `Bearer ${adminToken}` };

  t.before(async () => {
    testEnv = await startTestServer(app);
  });

  t.after(async () => {
    await testEnv.close();
  });

  await t.test("requires admin authentication (401 without token)", async () => {
    const res = await fetch(`${testEnv.baseUrl}/api/applications/stats`);
    assert.strictEqual(res.status, 401);
  });

  await t.test("rejects non-admin role (403)", async () => {
    const staffToken = createToken({ id: 2, role: "teacher" });
    const res = await fetch(`${testEnv.baseUrl}/api/applications/stats`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    assert.strictEqual(res.status, 403);
  });

  await t.test("returns numeric counts for all supported statuses", async () => {
    const originalQuery = pool.query;
    pool.query = async () => ({
      rows: [
        {
          total: "10",
          new: "4",
          under_review: "3",
          accepted: "2",
          rejected: "1",
        },
      ],
    });

    try {
      const res = await fetch(`${testEnv.baseUrl}/api/applications/stats`, {
        headers: authHeaders,
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);

      // Verify strict numeric types
      assert.strictEqual(typeof body.total, "number");
      assert.strictEqual(body.total, 10);
      assert.strictEqual(typeof body.new, "number");
      assert.strictEqual(body.new, 4);
      assert.strictEqual(typeof body.under_review, "number");
      assert.strictEqual(body.under_review, 3);
      assert.strictEqual(typeof body.accepted, "number");
      assert.strictEqual(body.accepted, 2);
      assert.strictEqual(typeof body.rejected, "number");
      assert.strictEqual(body.rejected, 1);
    } finally {
      pool.query = originalQuery;
    }
  });

  await t.test("safely handles database query failures (500 without leaking SQL)", async () => {
    const originalQuery = pool.query;
    pool.query = async () => {
      const error = new Error("Database connection lost");
      error.code = "ECONNREFUSED";
      throw error;
    };

    try {
      const res = await fetch(`${testEnv.baseUrl}/api/applications/stats`, {
        headers: authHeaders,
      });
      const body = await res.json();
      assert.strictEqual(res.status, 500);
      assert.strictEqual(body.message, "Unable to retrieve dashboard statistics.");
      // Ensure raw error is not leaked to client
      assert.strictEqual(body.error, undefined);
    } finally {
      pool.query = originalQuery;
    }
  });
});
