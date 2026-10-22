const test = require("node:test");
const assert = require("node:assert");
const bcrypt = require("bcrypt");
const { startTestServer } = require("./test_helpers");
const app = require("../server");
const pool = require("../db/db");

test("Admin Login (POST /api/auth/login)", async (t) => {
  let testEnv;
  const previousNodeEnv = process.env.NODE_ENV;

  t.before(async () => {
    process.env.NODE_ENV = "test";
    testEnv = await startTestServer(app);
  });

  t.after(async () => {
    process.env.NODE_ENV = previousNodeEnv;
    await testEnv.close();
  });

  await t.test("rejects missing or empty email/password with 400", async () => {
    const invalidInputs = [
      {},
      { email: "" },
      { email: "admin@example.com" }, // missing password
      { password: "password123" }, // missing email
      { email: "   ", password: "password123" },
      { email: "admin@example.com", password: "" },
      { email: 12345, password: "password" },
      { email: "admin@example.com", password: 12345 },
    ];

    for (const body of invalidInputs) {
      const res = await fetch(`${testEnv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      assert.strictEqual(res.status, 400);
      assert.strictEqual(data.message, "Email and password are required.");
    }
  });

  await t.test("rejects malformed email format with 400", async () => {
    const malformedEmails = [
      "notanemail",
      "user@domain",
      "@domain.com",
      "user@domain.",
      "user@.com",
      "user@domain..com",
    ];

    for (const email of malformedEmails) {
      const res = await fetch(`${testEnv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "validpassword" }),
      });
      const data = await res.json();
      assert.strictEqual(res.status, 400, `Expected 400 for email: ${email}`);
      assert.strictEqual(data.message, "Email and password are required.");
    }
  });

  await t.test("returns generic 401 when email is not found", async () => {
    const originalQuery = pool.query;
    pool.query = async () => ({ rows: [] });

    try {
      const res = await fetch(`${testEnv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "nonexistent@example.com", password: "password" }),
      });
      const data = await res.json();
      assert.strictEqual(res.status, 401);
      assert.strictEqual(data.message, "Invalid email or password.");
    } finally {
      pool.query = originalQuery;
    }
  });

  await t.test("returns generic 401 when password does not match", async () => {
    const originalQuery = pool.query;
    const realHash = await bcrypt.hash("correct_password", 10);

    pool.query = async () => ({
      rows: [
        {
          id: 1,
          full_name: "Admin User",
          email: "admin@example.com",
          password_hash: realHash,
          role: "admin",
        },
      ],
    });

    try {
      const res = await fetch(`${testEnv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@example.com", password: "wrong_password" }),
      });
      const data = await res.json();
      assert.strictEqual(res.status, 401);
      assert.strictEqual(data.message, "Invalid email or password.");
    } finally {
      pool.query = originalQuery;
    }
  });

  await t.test("authenticates valid credentials and issues 1-hour JWT token", async () => {
    const originalQuery = pool.query;
    const realPassword = "StrongAdminPassword123!";
    const realHash = await bcrypt.hash(realPassword, 10);

    pool.query = async () => ({
      rows: [
        {
          id: 42,
          full_name: "Headmaster",
          email: "headmaster@peniel.edu.gh",
          password_hash: realHash,
          role: "admin",
        },
      ],
    });

    try {
      const res = await fetch(`${testEnv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "headmaster@peniel.edu.gh", password: realPassword }),
      });
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.message, "Login successful.");
      assert.ok(typeof data.token === "string" && data.token.length > 20);
      assert.strictEqual(data.admin.id, 42);
      assert.strictEqual(data.admin.full_name, "Headmaster");
      assert.strictEqual(data.admin.email, "headmaster@peniel.edu.gh");
      assert.strictEqual(data.admin.role, "admin");
      // Password hash must never be returned
      assert.strictEqual(data.admin.password_hash, undefined);
    } finally {
      pool.query = originalQuery;
    }
  });

  await t.test("rate limits repeated login attempts when NODE_ENV is development (429)", async () => {
    process.env.NODE_ENV = "development";
    try {
      const responses = [];
      for (let i = 0; i < 12; i += 1) {
        const res = await fetch(`${testEnv.baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "invalid@example.com", password: "wrong" }),
        });
        responses.push(res.status);
      }
      // After 10 attempts, 11th and 12th should be 429
      assert.strictEqual(responses[10], 429);
      assert.strictEqual(responses[11], 429);
    } finally {
      process.env.NODE_ENV = "test";
    }
  });
});
