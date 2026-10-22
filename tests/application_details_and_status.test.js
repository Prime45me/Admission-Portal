const test = require("node:test");
const assert = require("node:assert");
const { startTestServer, createToken } = require("./test_helpers");
const app = require("../server");
const pool = require("../db/db");

test("Application Details (GET /:id) & Status Updates (PATCH /:id/status)", async (t) => {
  let testEnv;
  const adminToken = createToken({ id: 1, role: "admin" });
  const authHeaders = {
    Authorization: `Bearer ${adminToken}`,
    "Content-Type": "application/json",
  };

  t.before(async () => {
    testEnv = await startTestServer(app);
  });

  t.after(async () => {
    await testEnv.close();
  });

  // GET /api/applications/:id tests
  await t.test("GET /:id rejects invalid application IDs with 400", async () => {
    const invalidIds = ["abc", "0", "-1", "1.5", "1e5", "2147483648"];

    for (const id of invalidIds) {
      const res = await fetch(`${testEnv.baseUrl}/api/applications/${id}`, {
        headers: authHeaders,
      });
      const body = await res.json();
      assert.strictEqual(res.status, 400, `Expected 400 for id=${id}`);
      assert.strictEqual(body.message, "Invalid application ID.");
    }
  });

  await t.test("GET /:id returns 404 when application does not exist", async () => {
    const originalQuery = pool.query;
    pool.query = async () => ({ rowCount: 0, rows: [] });

    try {
      const res = await fetch(`${testEnv.baseUrl}/api/applications/99999`, {
        headers: authHeaders,
      });
      const body = await res.json();
      assert.strictEqual(res.status, 404);
      assert.strictEqual(body.message, "Application not found.");
    } finally {
      pool.query = originalQuery;
    }
  });

  await t.test("GET /:id returns application and all guardians when found", async () => {
    const originalQuery = pool.query;
    pool.query = async (sql) => {
      if (sql.includes("FROM applications")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 1,
              application_number: "PEN-2026-TEST001",
              first_name: "Kwame",
              last_name: "Mensah",
              status: "new",
            },
          ],
        };
      }
      if (sql.includes("FROM guardians")) {
        return {
          rowCount: 2,
          rows: [
            { id: 10, full_name: "Ama Mensah", relationship: "Mother" },
            { id: 11, full_name: "Kofi Mensah", relationship: "Father" },
          ],
        };
      }
      return { rowCount: 0, rows: [] };
    };

    try {
      const res = await fetch(`${testEnv.baseUrl}/api/applications/1`, {
        headers: authHeaders,
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.application.id, 1);
      assert.strictEqual(body.application.first_name, "Kwame");
      assert.strictEqual(body.guardians.length, 2);
      assert.strictEqual(body.guardians[0].full_name, "Ama Mensah");
      assert.strictEqual(body.guardians[1].full_name, "Kofi Mensah");
    } finally {
      pool.query = originalQuery;
    }
  });

  // PATCH /api/applications/:id/status tests
  await t.test("PATCH /:id/status rejects invalid application ID with 400", async () => {
    const res = await fetch(`${testEnv.baseUrl}/api/applications/invalid/status`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ status: "accepted" }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.message, "Invalid application ID.");
  });

  await t.test("PATCH /:id/status rejects non-object or invalid status with 400", async () => {
    const invalidStatuses = [
      { status: "approved" },
      { status: "pending" },
      { status: 123 },
      { status: "" },
      { status: "   " },
      {},
    ];

    for (const payload of invalidStatuses) {
      const res = await fetch(`${testEnv.baseUrl}/api/applications/1/status`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      assert.strictEqual(res.status, 400);
      assert.strictEqual(body.message, "Invalid status.");
      assert.ok(Array.isArray(body.allowedStatuses));
    }
  });

  await t.test("PATCH /:id/status returns 404 when application does not exist", async () => {
    const originalQuery = pool.query;
    pool.query = async () => ({ rowCount: 0, rows: [] });

    try {
      const res = await fetch(`${testEnv.baseUrl}/api/applications/99999/status`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ status: "accepted" }),
      });
      const body = await res.json();
      assert.strictEqual(res.status, 404);
      assert.strictEqual(body.message, "Application not found.");
    } finally {
      pool.query = originalQuery;
    }
  });

  await t.test("PATCH /:id/status updates status case-insensitively and normalizes lowercase", async () => {
    const originalQuery = pool.query;
    let updateParams = null;

    pool.query = async (sql, params) => {
      updateParams = params;
      return {
        rowCount: 1,
        rows: [
          {
            id: 1,
            application_number: "PEN-2026-TEST001",
            status: params[0],
            updated_at: new Date().toISOString(),
          },
        ],
      };
    };

    try {
      // Test each supported status with mixed case
      const testCases = [
        { input: "ACCEPTED", expected: "accepted" },
        { input: "Under_Review", expected: "under_review" },
        { input: "REJECTED", expected: "rejected" },
        { input: "New", expected: "new" },
      ];

      for (const tc of testCases) {
        const res = await fetch(`${testEnv.baseUrl}/api/applications/1/status`, {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify({ status: tc.input }),
        });
        const body = await res.json();
        assert.strictEqual(res.status, 200);
        assert.strictEqual(body.message, "Application status updated successfully.");
        assert.strictEqual(body.application.status, tc.expected);
        assert.strictEqual(updateParams[0], tc.expected);
      }
    } finally {
      pool.query = originalQuery;
    }
  });

  await t.test("PATCH /:id/status rejects unauthorized requests without token (401)", async () => {
    const res = await fetch(`${testEnv.baseUrl}/api/applications/1/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "accepted" }),
    });
    assert.strictEqual(res.status, 401);
  });
});
