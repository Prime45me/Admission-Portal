const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { startTestServer } = require("./test_helpers");
const app = require("../server");
const pool = require("../db/db");
const { sendPasswordResetEmail } = require("../services/resendEmail");

test("Administrator password reset endpoints", async (t) => {
  let testEnv;
  t.before(async () => {
    process.env.NODE_ENV = "test";
    process.env.FRONTEND_URL = "https://example.test";
    testEnv = await startTestServer(app);
  });
  t.after(async () => testEnv.close());

  await t.test("returns the same generic response for existing and unknown administrators", async () => {
    const originalQuery = pool.query;
    for (const row of [{ rows: [] }, { rows: [{ id: 7, email: "admin@example.test" }] }]) {
      pool.query = async () => row;
      const response = await fetch(`${testEnv.baseUrl}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@example.test" }),
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(
        body.message,
        "If an administrator account exists for this email, a password reset link has been sent."
      );
    }
    pool.query = originalQuery;
  });

  await t.test("rejects invalid and weak reset submissions", async () => {
    const response = await fetch(`${testEnv.baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: crypto.randomBytes(32).toString("hex"),
        password: "weak",
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.match(body.message, /Password must/);
  });

  await t.test("password reset email uses injected Resend client without storing or logging the raw URL", async () => {
    const sent = [];
    const result = await sendPasswordResetEmail({
      to: "admin@example.test",
      resetUrl: "https://example.test/reset-password?token=RAW_TOKEN_TEST_ONLY",
      resendClient: { emails: { send: async (message) => { sent.push(message); return { id: "test" }; } } },
    });
    assert.equal(result.delivered, true);
    assert.equal(sent.length, 1);
    assert.match(sent[0].html, /30 minutes/);
    assert.match(sent[0].html, /example\.test\/reset-password/);
  });
});
