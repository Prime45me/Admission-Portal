const test = require("node:test");
const assert = require("node:assert");
const { startTestServer, createToken } = require("./test_helpers");
const app = require("../server");
const pool = require("../db/db");

test("Application Listing (GET /api/applications)", async (t) => {
  let testEnv;
  const adminToken = createToken({ id: 1, role: "admin" });
  const authHeaders = { Authorization: `Bearer ${adminToken}` };

  t.before(async () => {
    testEnv = await startTestServer(app);
  });

  t.after(async () => {
    await testEnv.close();
  });

  await t.test("rejects invalid status filter with 400", async () => {
    const invalidStatuses = ["pending", "active", "deleted", "", "123"];

    for (const status of invalidStatuses) {
      const res = await fetch(
        `${testEnv.baseUrl}/api/applications?status=${encodeURIComponent(status)}`,
        { headers: authHeaders }
      );
      const body = await res.json();
      assert.strictEqual(
        res.status,
        400,
        `Expected 400 for status=${status}, got ${res.status}`
      );
      assert.strictEqual(body.message, "Invalid application filter.");
      assert.ok(Array.isArray(body.allowedStatuses));
    }
  });

  await t.test("accepts valid status filter case-insensitively", async () => {
    const originalQuery = pool.query;
    const executedQueries = [];

    pool.query = async (sql, params) => {
      executedQueries.push({ sql, params });
      if (sql.includes("COUNT(*)")) {
        return { rows: [{ count: "2" }] };
      }
      return {
        rows: [
          { id: 1, status: "new" },
          { id: 2, status: "new" },
        ],
      };
    };

    try {
      const res = await fetch(`${testEnv.baseUrl}/api/applications?status=NEW`, {
        headers: authHeaders,
      });
      assert.strictEqual(res.status, 200);

      // Verify LOWER(status) parameter was lowercased
      const countQuery = executedQueries.find((q) => q.sql.includes("COUNT(*)"));
      assert.ok(countQuery);
      assert.strictEqual(countQuery.params[0], "new");
    } finally {
      pool.query = originalQuery;
    }
  });

  await t.test("rejects invalid pagination parameters with 400", async () => {
    const invalidPagination = [
      "?page=0",
      "?page=-1",
      "?page=abc",
      "?page=1.5",
      "?limit=0",
      "?limit=-10",
      "?limit=xyz",
      "?limit=0.5",
      "?page=0&limit=10",
      "?page=1&limit=0",
    ];

    for (const qs of invalidPagination) {
      const res = await fetch(`${testEnv.baseUrl}/api/applications${qs}`, {
        headers: authHeaders,
      });
      const body = await res.json();
      assert.strictEqual(res.status, 400, `Expected 400 for ${qs}`);
      assert.strictEqual(body.message, "Page and limit must be positive integers.");
    }
  });

  await t.test("caps limit at 100 for large requested limits", async () => {
    const originalQuery = pool.query;
    let actualLimitParam = null;

    pool.query = async (sql, params) => {
      if (!sql.includes("COUNT(*)")) {
        // params: [...filters, limit, offset]
        actualLimitParam = params[params.length - 2];
      }
      return { rows: [{ count: "0" }] };
    };

    try {
      const res = await fetch(`${testEnv.baseUrl}/api/applications?limit=250`, {
        headers: authHeaders,
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(actualLimitParam, 100);
    } finally {
      pool.query = originalQuery;
    }
  });

  await t.test("applies class and search filters with parameterization and trims whitespace", async () => {
    const originalQuery = pool.query;
    const executedQueries = [];

    pool.query = async (sql, params) => {
      executedQueries.push({ sql, params });
      if (sql.includes("COUNT(*)")) {
        return { rows: [{ count: "1" }] };
      }
      return {
        rows: [{ id: 1, first_name: "Kwame", class_applied_for: "Basic 1" }],
      };
    };

    try {
      const res = await fetch(
        `${testEnv.baseUrl}/api/applications?class=%20Basic%201%20&search=%20Kwame%20`,
        { headers: authHeaders }
      );
      assert.strictEqual(res.status, 200);

      const countQuery = executedQueries.find((q) => q.sql.includes("COUNT(*)"));
      assert.ok(countQuery);
      // Both filters should be trimmed and wrapped in % for ILIKE
      assert.strictEqual(countQuery.params[0], "%Basic 1%");
      assert.strictEqual(countQuery.params[1], "%Kwame%");
    } finally {
      pool.query = originalQuery;
    }
  });

  await t.test("handles empty search and class filter strings consistently", async () => {
    const originalQuery = pool.query;
    const executedQueries = [];

    pool.query = async (sql, params) => {
      executedQueries.push({ sql, params });
      if (sql.includes("COUNT(*)")) {
        return { rows: [{ count: "0" }] };
      }
      return { rows: [] };
    };

    try {
      const res = await fetch(
        `${testEnv.baseUrl}/api/applications?search=%20%20%20&class=%20%20`,
        { headers: authHeaders }
      );
      assert.strictEqual(res.status, 200);

      // Since search and class are whitespace only, no ILIKE filter should be added
      const countQuery = executedQueries.find((q) => q.sql.includes("COUNT(*)"));
      assert.ok(countQuery);
      assert.strictEqual(countQuery.params.length, 0);
    } finally {
      pool.query = originalQuery;
    }
  });

  await t.test("calculates totalPages accurately", async () => {
    const originalQuery = pool.query;

    pool.query = async (sql) => {
      if (sql.includes("COUNT(*)")) {
        return { rows: [{ count: "25" }] };
      }
      return { rows: [] };
    };

    try {
      const res = await fetch(`${testEnv.baseUrl}/api/applications?page=2&limit=10`, {
        headers: authHeaders,
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.page, 2);
      assert.strictEqual(body.limit, 10);
      assert.strictEqual(body.total, 25);
      assert.strictEqual(body.totalPages, 3);
    } finally {
      pool.query = originalQuery;
    }
  });
});
