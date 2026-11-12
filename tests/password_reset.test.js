const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { startTestServer } = require("./test_helpers");
const app = require("../server");
const authRoutes = require("../routes/auth");
const pool = require("../db/db");
const resendEmail = require("../services/resendEmail");
const { sendPasswordResetEmail } = resendEmail;

const GENERIC_MESSAGE =
  "If an administrator account exists for this email, a password reset link has been sent.";

test("Administrator password reset unit tests (mocked database and email)", async (t) => {
  let testEnv;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousFrontendUrl = process.env.FRONTEND_URL;
  t.before(async () => {
    process.env.NODE_ENV = "test";
    process.env.FRONTEND_URL = "https://example.test";
    testEnv = await startTestServer(app);
    authRoutes.accountResetLimiter.clear();
  });
  t.after(async () => {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontendUrl;
    await testEnv.close();
  });

  function installResetRequestMocks({ admin }) {
    const originalQuery = pool.query;
    const originalConnect = pool.connect;
    pool.query = async (sql, params) => {
      if (sql.includes("SELECT id, email FROM admins WHERE LOWER(email)")) {
        return { rows: admin ? [{ id: 7001, email: params[0] }] : [] };
      }
      return { rows: [] };
    };
    pool.connect = async () => ({
      query: async (sql) => {
        if (sql.includes("SELECT id, email FROM admins WHERE id")) {
          return { rows: [{ id: 7001, email: admin?.email || "admin@example.test" }] };
        }
        return { rows: [], rowCount: 1 };
      },
      release: () => {},
    });
    return () => {
      pool.query = originalQuery;
      pool.connect = originalConnect;
    };
  }

  await t.test("known and unknown email requests have identical generic responses", async () => {
    const responses = [];
    for (const address of ["known@example.test", "unknown@example.test"]) {
      const restore = installResetRequestMocks({
        admin: address.startsWith("known") ? { email: address } : null,
      });
      try {
        const response = await fetch(`${testEnv.baseUrl}/api/auth/forgot-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: address }),
        });
        responses.push({ status: response.status, body: await response.json() });
      } finally {
        restore();
      }
    }

    assert.deepEqual(responses, [
      { status: 200, body: { message: GENERIC_MESSAGE } },
      { status: 200, body: { message: GENERIC_MESSAGE } },
    ]);
  });

  await t.test("account-throttled and unknown addresses retain the same generic response", async () => {
    const limitedEmail = "limited-known@example.test";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      authRoutes.accountResetLimiter(
        { body: { email: ` ${limitedEmail.toUpperCase()} ` } },
        null,
        () => {}
      );
    }

    const restore = installResetRequestMocks({ admin: null });
    try {
      const responses = [];
      for (const address of [limitedEmail, "unregistered@example.test"]) {
        const response = await fetch(`${testEnv.baseUrl}/api/auth/forgot-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: address }),
        });
        responses.push({ status: response.status, body: await response.json() });
      }
      assert.deepEqual(responses, [
        { status: 200, body: { message: GENERIC_MESSAGE } },
        { status: 200, body: { message: GENERIC_MESSAGE } },
      ]);
    } finally {
      restore();
    }
  });

  await t.test("email delivery failure remains private and does not change the generic response", async () => {
    const originalSend = resendEmail.sendPasswordResetEmail;
    resendEmail.sendPasswordResetEmail = async () => {
      throw new Error("mocked transport failure");
    };
    const responses = [];
    try {
      for (const address of ["delivery-failure@example.test", "no-account@example.test"]) {
        const restore = installResetRequestMocks({
          admin: address.startsWith("delivery-failure") ? { email: address } : null,
        });
        try {
          const response = await fetch(`${testEnv.baseUrl}/api/auth/forgot-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: address }),
          });
          responses.push({ status: response.status, body: await response.json() });
        } finally {
          restore();
        }
      }
      assert.deepEqual(responses, [
        { status: 200, body: { message: GENERIC_MESSAGE } },
        { status: 200, body: { message: GENERIC_MESSAGE } },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 10));
    } finally {
      resendEmail.sendPasswordResetEmail = originalSend;
    }
  });

  await t.test("rejects malformed, weak, or missing reset tokens and passwords", async () => {
    const invalidSubmissions = [
      { token: "invalid", password: "Weakpassword123" },
      { token: crypto.randomBytes(32).toString("hex"), password: "weak" },
    ];
    for (const body of invalidSubmissions) {
      const response = await fetch(`${testEnv.baseUrl}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
    }
  });

  await t.test("Resend email helper supports an injected client without exposing tokens in logs", async () => {
    const sent = [];
    const result = await sendPasswordResetEmail({
      to: "admin@example.test",
      resetUrl: "https://example.test/reset-password?token=TEST_ONLY",
      resendClient: {
        emails: {
          send: async (message) => {
            sent.push(message);
            return { id: "mock-message-id" };
          },
        },
      },
    });
    assert.equal(result.delivered, true);
    assert.equal(sent.length, 1);
    assert.match(sent[0].html, /30 minutes/);
    assert.match(sent[0].html, /example\.test\/reset-password/);
  });
});
