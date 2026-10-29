const test = require("node:test");
const assert = require("node:assert");
const { startTestServer, createToken } = require("./test_helpers");
const app = require("../server");
const pool = require("../db/db");

test("Application Deletion (DELETE /api/applications/:id)", async (t) => {
  let testEnv;
  const adminToken = createToken({ id: 1, role: "admin" });
  const nonAdminToken = createToken({ id: 2, role: "staff" });
  const authHeaders = {
    Authorization: `Bearer ${adminToken}`,
  };

  t.before(async () => {
    testEnv = await startTestServer(app);
  });

  t.after(async () => {
    await testEnv.close();
  });

  await t.test("rejects unauthorized request without token (401)", async () => {
    const res = await fetch(`${testEnv.baseUrl}/api/applications/1`, {
      method: "DELETE",
    });
    const body = await res.json();
    assert.strictEqual(res.status, 401);
    assert.strictEqual(body.message, "Authentication required");
  });

  await t.test("rejects token with non-admin role (403)", async () => {
    const res = await fetch(`${testEnv.baseUrl}/api/applications/1`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${nonAdminToken}` },
    });
    const body = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(body.message, "Admin access required");
  });

  await t.test("rejects invalid application IDs with 400", async () => {
    const invalidIds = ["abc", "0", "-5", "1.23", "2147483648"];

    for (const id of invalidIds) {
      const res = await fetch(`${testEnv.baseUrl}/api/applications/${id}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      const body = await res.json();
      assert.strictEqual(res.status, 400, `Expected 400 for id=${id}`);
      assert.strictEqual(body.message, "Invalid application ID.");
    }
  });

  await t.test("returns 404 when application does not exist", async () => {
    const originalConnect = pool.connect;
    const mockClient = {
      query: async (sql) => {
        if (sql.includes("SELECT id, application_number")) {
          return { rowCount: 0, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      },
      release: () => {},
    };

    pool.connect = async () => mockClient;

    try {
      const res = await fetch(`${testEnv.baseUrl}/api/applications/99999`, {
        method: "DELETE",
        headers: authHeaders,
      });
      const body = await res.json();
      assert.strictEqual(res.status, 404);
      assert.strictEqual(body.message, "Application not found.");
    } finally {
      pool.connect = originalConnect;
    }
  });

  await t.test("successfully deletes application and related records within transaction", async () => {
    const originalConnect = pool.connect;
    const executedQueries = [];

    const mockClient = {
      query: async (sql, params) => {
        executedQueries.push({ sql, params });

        if (sql.includes("SELECT id, application_number")) {
          return {
            rowCount: 1,
            rows: [{ id: 42, application_number: "PEN-2026-DEL1234" }],
          };
        }
        if (sql.includes("DELETE FROM documents")) {
          return { rowCount: 2, rows: [] };
        }
        if (sql.includes("DELETE FROM guardians")) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes("DELETE FROM applications")) {
          return { rowCount: 1, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      },
      release: () => {},
    };

    pool.connect = async () => mockClient;

    try {
      const res = await fetch(`${testEnv.baseUrl}/api/applications/42`, {
        method: "DELETE",
        headers: authHeaders,
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.message, "Application deleted successfully.");
      assert.strictEqual(body.application.id, 42);
      assert.strictEqual(body.application.application_number, "PEN-2026-DEL1234");

      // Verify transaction flow
      assert.ok(executedQueries.some((q) => q.sql.includes("BEGIN")), "BEGIN should be executed");
      assert.ok(executedQueries.some((q) => q.sql.includes("DELETE FROM documents")), "documents should be deleted");
      assert.ok(executedQueries.some((q) => q.sql.includes("DELETE FROM guardians")), "guardians should be deleted");
      assert.ok(executedQueries.some((q) => q.sql.includes("DELETE FROM applications")), "applications should be deleted");
      assert.ok(executedQueries.some((q) => q.sql.includes("COMMIT")), "COMMIT should be executed");
    } finally {
      pool.connect = originalConnect;
    }
  });

  await t.test("safely rolls back transaction and returns 500 when query fails", async () => {
    const originalConnect = pool.connect;
    const executedQueries = [];

    const mockClient = {
      query: async (sql) => {
        executedQueries.push(sql);
        if (sql.includes("SELECT id, application_number")) {
          return {
            rowCount: 1,
            rows: [{ id: 42, application_number: "PEN-2026-DEL1234" }],
          };
        }
        if (sql.includes("DELETE FROM guardians")) {
          const err = new Error("Database disk failure");
          err.code = "58030";
          throw err;
        }
        return { rowCount: 0, rows: [] };
      },
      release: () => {},
    };

    pool.connect = async () => mockClient;

    try {
      const res = await fetch(`${testEnv.baseUrl}/api/applications/42`, {
        method: "DELETE",
        headers: authHeaders,
      });
      const body = await res.json();
      assert.strictEqual(res.status, 500);
      assert.strictEqual(body.message, "Unable to delete application.");

      assert.ok(executedQueries.some((sql) => sql.includes("ROLLBACK")), "ROLLBACK should be executed");
    } finally {
      pool.connect = originalConnect;
    }
  });
});
