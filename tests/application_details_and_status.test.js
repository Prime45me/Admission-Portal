const test = require("node:test");
const assert = require("node:assert");
const { startTestServer, createToken } = require("./test_helpers");
const app = require("../server");
const pool = require("../db/db");
const resendEmail = require("../services/resendEmail");

function createStatusClient(application, { updateError } = {}) {
  return {
    committed: false,
    rolledBack: false,
    async query(sql, params) {
      const statement = sql.trim();
      if (statement === "BEGIN") return { rowCount: null, rows: [] };
      if (statement === "COMMIT") {
        this.committed = true;
        return { rowCount: null, rows: [] };
      }
      if (statement === "ROLLBACK") {
        this.rolledBack = true;
        return { rowCount: null, rows: [] };
      }
      if (statement.includes("FOR UPDATE")) {
        return application
          ? { rowCount: 1, rows: [{ ...application }] }
          : { rowCount: 0, rows: [] };
      }
      if (statement.startsWith("UPDATE applications")) {
        if (updateError) throw updateError;
        application.status = params[0];
        application.updated_at = new Date().toISOString();
        return {
          rowCount: 1,
          rows: [{
            id: application.id,
            application_number: application.application_number,
            status: application.status,
            updated_at: application.updated_at,
          }],
        };
      }
      throw new Error("Unexpected status transaction query.");
    },
    release() {},
  };
}

function createStatusApplication(overrides = {}) {
  return {
    id: 1,
    application_number: "PEN-2026-TEST001",
    first_name: "Kwame",
    middle_name: "Kofi",
    last_name: "Mensah",
    email: "applicant@example.test",
    status: "new",
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

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
    const originalConnect = pool.connect;
    pool.connect = async () => createStatusClient(null);

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
      pool.connect = originalConnect;
    }
  });

  await t.test("PATCH /:id/status updates status case-insensitively and normalizes lowercase", async () => {
    const originalConnect = pool.connect;
    const originalSend = resendEmail.sendApplicationStatusNotification;
    const application = createStatusApplication();
    const client = createStatusClient(application);
    const notifications = [];
    pool.connect = async () => client;
    resendEmail.sendApplicationStatusNotification = async (notification) => {
      notifications.push(notification);
      return { delivered: true };
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
      }
      assert.deepStrictEqual(notifications.map(({ status }) => status), [
        "accepted",
        "under_review",
        "rejected",
        "new",
      ]);
      assert.ok(notifications.every((item) =>
        item.to === "applicant@example.test" &&
        item.applicantName === "Kwame Kofi Mensah" &&
        item.applicationNumber === "PEN-2026-TEST001"
      ));
    } finally {
      pool.connect = originalConnect;
      resendEmail.sendApplicationStatusNotification = originalSend;
    }
  });

  await t.test("PATCH /:id/status does not notify when the status is unchanged", async () => {
    const originalConnect = pool.connect;
    const originalSend = resendEmail.sendApplicationStatusNotification;
    const client = createStatusClient(createStatusApplication({ status: "accepted" }));
    let notificationCount = 0;
    pool.connect = async () => client;
    resendEmail.sendApplicationStatusNotification = async () => {
      notificationCount += 1;
      return { delivered: true };
    };

    try {
      const res = await fetch(`${testEnv.baseUrl}/api/applications/1/status`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ status: "ACCEPTED" }),
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual((await res.json()).application.status, "accepted");
      assert.strictEqual(notificationCount, 0);
      assert.strictEqual(client.committed, true);
    } finally {
      pool.connect = originalConnect;
      resendEmail.sendApplicationStatusNotification = originalSend;
    }
  });

  await t.test("email failure does not undo a committed status update", async () => {
    const originalConnect = pool.connect;
    const originalSend = resendEmail.sendApplicationStatusNotification;
    const application = createStatusApplication();
    const client = createStatusClient(application);
    pool.connect = async () => client;
    resendEmail.sendApplicationStatusNotification = async () => {
      return { delivered: false, reason: "RESEND_DELIVERY_FAILED" };
    };

    try {
      const res = await fetch(`${testEnv.baseUrl}/api/applications/1/status`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ status: "accepted" }),
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual((await res.json()).application.status, "accepted");
      assert.strictEqual(application.status, "accepted");
      assert.strictEqual(client.committed, true);
      assert.strictEqual(client.rolledBack, false);
    } finally {
      pool.connect = originalConnect;
      resendEmail.sendApplicationStatusNotification = originalSend;
    }
  });

  await t.test("database update failure rolls back and does not send an email", async () => {
    const originalConnect = pool.connect;
    const originalSend = resendEmail.sendApplicationStatusNotification;
    const application = createStatusApplication();
    const client = createStatusClient(application, {
      updateError: Object.assign(new Error("Mock database failure"), { code: "58030" }),
    });
    let notificationCount = 0;
    pool.connect = async () => client;
    resendEmail.sendApplicationStatusNotification = async () => {
      notificationCount += 1;
      return { delivered: true };
    };

    try {
      const res = await fetch(`${testEnv.baseUrl}/api/applications/1/status`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ status: "accepted" }),
      });
      assert.strictEqual(res.status, 500);
      assert.strictEqual(application.status, "new");
      assert.strictEqual(client.rolledBack, true);
      assert.strictEqual(client.committed, false);
      assert.strictEqual(notificationCount, 0);
    } finally {
      pool.connect = originalConnect;
      resendEmail.sendApplicationStatusNotification = originalSend;
    }
  });

  await t.test("PATCH /:id/status rejects unauthenticated and non-admin callers", async () => {
    const originalConnect = pool.connect;
    const originalSend = resendEmail.sendApplicationStatusNotification;
    let connectCount = 0;
    let notificationCount = 0;
    pool.connect = async () => {
      connectCount += 1;
      throw new Error("Status route must not be reached.");
    };
    resendEmail.sendApplicationStatusNotification = async () => {
      notificationCount += 1;
      return { delivered: true };
    };

    try {
      const unauthenticated = await fetch(`${testEnv.baseUrl}/api/applications/1/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "accepted" }),
      });
      const unauthorized = await fetch(`${testEnv.baseUrl}/api/applications/1/status`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${createToken({ id: 1, role: "teacher" })}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "accepted" }),
      });
      assert.strictEqual(unauthenticated.status, 401);
      assert.strictEqual(unauthorized.status, 403);
      assert.strictEqual(connectCount, 0);
      assert.strictEqual(notificationCount, 0);
    } finally {
      pool.connect = originalConnect;
      resendEmail.sendApplicationStatusNotification = originalSend;
    }
  });
});
