const test = require("node:test");
const assert = require("node:assert");
const { startTestServer, validApplicationPayload } = require("./test_helpers");
const app = require("../server");
const pool = require("../db/db");

test("Public Application Submission (POST /api/applications)", async (t) => {
  let testEnv;

  t.before(async () => {
    testEnv = await startTestServer(app);
  });

  t.after(async () => {
    await testEnv.close();
  });

  await t.test("rejects non-object request body with 400", async () => {
    const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["invalid", "array"]),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.message, "Request body must be a JSON object.");
  });

  await t.test("rejects missing required applicant fields with 400", async () => {
    const requiredFields = [
      "first_name",
      "last_name",
      "date_of_birth",
      "gender",
      "email",
      "phone",
      "address",
      "class_applied_for",
    ];

    for (const field of requiredFields) {
      const payload = validApplicationPayload();
      delete payload[field];

      const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.strictEqual(
        res.status,
        400,
        `Expected 400 when ${field} is missing, got ${res.status}`
      );
    }
  });

  await t.test("rejects whitespace-only applicant fields with 400", async () => {
    const fields = ["first_name", "last_name", "gender", "address", "class_applied_for"];
    for (const field of fields) {
      const payload = validApplicationPayload({ [field]: "    " });
      const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.strictEqual(res.status, 400, `Expected 400 when ${field} is whitespace`);
    }
  });

  await t.test("rejects applicant text exceeding schema limits with 400", async () => {
    const invalidFields = [
      { first_name: "a".repeat(101) },
      { middle_name: "a".repeat(101) },
      { last_name: "a".repeat(101) },
      { gender: "a".repeat(21) },
      { email: `${"a".repeat(145)}@example.com` },
      { phone: "0".repeat(31) },
      { address: "a".repeat(2001) },
      { class_applied_for: "a".repeat(101) },
    ];

    for (const patch of invalidFields) {
      const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validApplicationPayload(patch)),
      });
      assert.strictEqual(
        res.status,
        400,
        `Expected 400 for invalid field lengths: ${Object.keys(patch).join(", ")}`
      );
    }
  });

  await t.test("rejects invalid field types with 400", async () => {
    const cases = [
      { first_name: 12345 },
      { last_name: true },
      { date_of_birth: { year: 2015, month: 5, day: 12 } },
      { gender: ["Male"] },
      { email: 999 },
      { phone: 241234567 },
      { address: null },
      { class_applied_for: false },
      { middle_name: 123 },
      { guardian: "Not an object" },
      { guardian: null },
    ];

    for (const patch of cases) {
      const payload = validApplicationPayload(patch);
      const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.strictEqual(res.status, 400, `Expected 400 for ${JSON.stringify(patch)}`);
    }
  });

  await t.test("rejects invalid applicant emails with 400", async () => {
    const invalidEmails = [
      "plainaddress",
      "@missinguser.com",
      "user@domain",
      "user@domain.",
      "user@.com",
      "user space@example.com",
      "user@example..com",
      "a".repeat(151) + "@example.com",
    ];

    for (const email of invalidEmails) {
      const payload = validApplicationPayload({ email });
      const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.strictEqual(res.status, 400, `Expected 400 for invalid email: ${email}`);
    }
  });

  await t.test("rejects impossible dates of birth with 400", async () => {
    const impossibleDates = [
      "2019-02-30",
      "2021-02-29",
      "2023-04-31",
      "2023-13-01",
      "2023-00-10",
      "2023-05-32",
      "0000-12-31",
      "invalid-date",
      "15-05-2015",
    ];

    for (const date_of_birth of impossibleDates) {
      const payload = validApplicationPayload({ date_of_birth });
      const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.strictEqual(res.status, 400, `Expected 400 for impossible DOB: ${date_of_birth}`);
    }
  });

  await t.test("rejects future dates of birth with 400", async () => {
    const futureDate = "2099-01-01";
    const payload = validApplicationPayload({ date_of_birth: futureDate });
    const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.strictEqual(res.status, 400, `Expected 400 for future DOB`);
  });

  await t.test("rejects invalid Ghanaian phone formats with 400", async () => {
    const invalidPhones = [
      "12345",
      "02412345678",
      "+2330241234567",
      "+1234567890",
      "phone_number",
    ];

    for (const phone of invalidPhones) {
      const payload = validApplicationPayload({ phone });
      const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.strictEqual(res.status, 400, `Expected 400 for invalid phone: ${phone}`);
    }
  });

  await t.test("rejects missing or invalid required guardian fields with 400", async () => {
    const guardianChecks = [
      { full_name: "" },
      { full_name: "   " },
      { full_name: 123 },
      { relationship: "" },
      { relationship: "a".repeat(51) }, // exceeding varchar(50)
      { phone_number: "" },
      { phone_number: "invalid" },
      { address: 12345 }, // invalid address type
      { address: "a".repeat(2001) },
    ];

    for (const patch of guardianChecks) {
      const payload = validApplicationPayload();
      payload.guardian = { ...payload.guardian, ...patch };

      const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.strictEqual(
        res.status,
        400,
        `Expected 400 for guardian patch: ${JSON.stringify(patch)}`
      );
    }
  });

  await t.test("rejects invalid optional guardian email when supplied with 400", async () => {
    const invalidGuardianEmails = ["invalid-email", "user@domain..com", ""];

    for (const email of invalidGuardianEmails) {
      const payload = validApplicationPayload();
      payload.guardian.email = email;

      const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.strictEqual(res.status, 400, `Expected 400 for guardian email: ${email}`);
    }
  });

  await t.test("accepts omitted guardian email and writes NULL", async () => {
    const originalConnect = pool.connect;
    let guardianEmailParam;
    let released = false;
    const mockClient = {
      query: async (sql, params) => {
        if (sql.includes("INSERT INTO applications")) {
          return { rows: [{ id: 104, application_number: "PEN-2026-OPTIONAL" }] };
        }
        if (sql.includes("INSERT INTO guardians")) {
          guardianEmailParam = params[4];
          return { rows: [{ id: 204, email: null }] };
        }
        return { rows: [] };
      },
      release: () => {
        released = true;
      },
    };
    pool.connect = async () => mockClient;

    try {
      const payload = validApplicationPayload();
      delete payload.guardian.email;

      const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(guardianEmailParam, null);
      assert.strictEqual(released, true);
    } finally {
      pool.connect = originalConnect;
    }
  });

  await t.test("accepts null guardian email and address as optional values", async () => {
    const originalConnect = pool.connect;
    let guardianParams;
    const mockClient = {
      query: async (sql, params) => {
        if (sql.includes("INSERT INTO applications")) {
          return { rows: [{ id: 105, application_number: "PEN-2026-NULLABLE" }] };
        }
        if (sql.includes("INSERT INTO guardians")) {
          guardianParams = params;
          return { rows: [{ id: 205, email: null, address: null }] };
        }
        return { rows: [] };
      },
      release: () => {},
    };
    pool.connect = async () => mockClient;

    try {
      const payload = validApplicationPayload();
      payload.guardian.email = null;
      payload.guardian.address = null;
      const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(guardianParams[4], null);
      assert.strictEqual(guardianParams[5], null);
    } finally {
      pool.connect = originalConnect;
    }
  });

  await t.test("submits valid application and guardian successfully (mocked DB transaction)", async () => {
    const originalConnect = pool.connect;

    const queriesExecuted = [];
    const mockClient = {
      query: async (sql, params) => {
        queriesExecuted.push({ sql: sql.trim(), params });
        if (sql.includes("BEGIN") || sql.includes("SAVEPOINT") || sql.includes("RELEASE") || sql.includes("COMMIT")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("INSERT INTO applications")) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 101,
                application_number: "PEN-2026-TEST1234",
                first_name: "Kwame",
                last_name: "Mensah",
                status: "new",
                created_at: new Date().toISOString(),
              },
            ],
          };
        }
        if (sql.includes("INSERT INTO guardians")) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 201,
                full_name: "Ama Mensah",
                relationship: "Mother",
                phone_number: "0247654321",
                email: "ama.mensah@example.com",
                address: "123 Independence Avenue, Accra",
              },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      },
      release: () => {},
    };

    pool.connect = async () => mockClient;

    try {
      const payload = validApplicationPayload();
      const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 201);
      assert.strictEqual(body.message, "Application and guardian submitted successfully.");
      assert.strictEqual(body.application.id, 101);
      assert.strictEqual(body.application.status, "new");
      assert.strictEqual(body.guardian.id, 201);

      // Verify BEGIN and COMMIT executed
      assert.ok(queriesExecuted.some((q) => q.sql.includes("BEGIN")));
      assert.ok(queriesExecuted.some((q) => q.sql.includes("COMMIT")));
    } finally {
      pool.connect = originalConnect;
    }
  });

  await t.test("rolls back transaction when guardian insert fails", async () => {
    const originalConnect = pool.connect;

    const queriesExecuted = [];
    const mockClient = {
      query: async (sql, params) => {
        queriesExecuted.push({ sql: sql.trim(), params });
        if (sql.includes("BEGIN") || sql.includes("SAVEPOINT") || sql.includes("RELEASE")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("INSERT INTO applications")) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 102,
                application_number: "PEN-2026-TEST5678",
                first_name: "Kwame",
                last_name: "Mensah",
                status: "new",
                created_at: new Date().toISOString(),
              },
            ],
          };
        }
        if (sql.includes("INSERT INTO guardians")) {
          const err = new Error("Guardian insert failed: DB disk error");
          err.code = "58030";
          throw err;
        }
        if (sql.includes("ROLLBACK")) {
          return { rowCount: 0, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      },
      release: () => {},
    };

    pool.connect = async () => mockClient;

    try {
      const payload = validApplicationPayload();
      const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 500);
      assert.strictEqual(body.message, "Unable to submit application. Please try again.");

      // Verify ROLLBACK was triggered
      assert.ok(queriesExecuted.some((q) => q.sql.includes("ROLLBACK")));
    } finally {
      pool.connect = originalConnect;
    }
  });

  await t.test("does not roll back when BEGIN fails and always releases the client", async () => {
    const originalConnect = pool.connect;
    const queriesExecuted = [];
    let released = false;
    const mockClient = {
      query: async (sql) => {
        queriesExecuted.push(sql);
        if (sql === "BEGIN") {
          const error = new Error("Connection failed");
          error.code = "08006";
          throw error;
        }
        return { rows: [] };
      },
      release: () => {
        released = true;
      },
    };
    pool.connect = async () => mockClient;

    try {
      const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validApplicationPayload()),
      });
      assert.strictEqual(res.status, 500);
      assert.strictEqual(queriesExecuted.includes("ROLLBACK"), false);
      assert.strictEqual(released, true);
    } finally {
      pool.connect = originalConnect;
    }
  });

  await t.test("safely handles application number collision with retry", async () => {
    const originalConnect = pool.connect;

    let attempt = 0;
    const queriesExecuted = [];
    const mockClient = {
      query: async (sql, params) => {
        queriesExecuted.push({ sql: sql.trim(), params });
        if (sql.includes("BEGIN") || sql.includes("SAVEPOINT") || sql.includes("RELEASE") || sql.includes("COMMIT")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("INSERT INTO applications")) {
          attempt += 1;
          if (attempt === 1) {
            // First attempt causes unique collision
            const err = new Error("duplicate key value violates unique constraint");
            err.code = "23505";
            err.constraint = "applications_application_number_key";
            throw err;
          }
          return {
            rowCount: 1,
            rows: [
              {
                id: 103,
                application_number: "PEN-2026-RETRY123",
                first_name: "Kwame",
                last_name: "Mensah",
                status: "new",
                created_at: new Date().toISOString(),
              },
            ],
          };
        }
        if (sql.includes("INSERT INTO guardians")) {
          return {
            rowCount: 1,
            rows: [{ id: 203, full_name: "Ama Mensah" }],
          };
        }
        return { rowCount: 0, rows: [] };
      },
      release: () => {},
    };

    pool.connect = async () => mockClient;

    try {
      const payload = validApplicationPayload();
      const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 201);
      assert.strictEqual(attempt, 2); // Retried successfully
      assert.strictEqual(body.application.id, 103);
    } finally {
      pool.connect = originalConnect;
    }
  });
});
