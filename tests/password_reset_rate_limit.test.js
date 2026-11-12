const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const authRoutes = require("../routes/auth");
const { startTestServer } = require("./test_helpers");

const GENERIC_MESSAGE =
  "If an administrator account exists for this email, a password reset link has been sent.";

test("Password-reset account limiter keys normalized email independent of IP", () => {
  let time = 1000;
  const limiter = authRoutes.createAccountResetRateLimiter({
    limit: 2,
    windowMs: 1000,
    maxKeys: 10,
    now: () => time,
    secret: "unit-test-only-secret",
  });

  function isLimited(email, ip) {
    const request = { body: { email }, ip };
    limiter(request, null, () => {});
    return request.accountResetRateLimited === true;
  }

  try {
    assert.equal(isLimited(" Admin@Example.test ", "192.0.2.1"), false);
    assert.equal(isLimited("admin@example.test", "198.51.100.8"), false);
    assert.equal(isLimited("ADMIN@example.test", "203.0.113.4"), true);
    assert.equal(isLimited("unknown@example.test", "203.0.113.4"), false);
    time += 1001;
    assert.equal(isLimited("admin@example.test", "192.0.2.1"), false);
  } finally {
    limiter.close();
  }
});

test("account limiter fails closed when its bounded key store is full", () => {
  const limiter = authRoutes.createAccountResetRateLimiter({
    limit: 3,
    windowMs: 1000,
    maxKeys: 1,
    secret: "unit-test-capacity-secret",
  });
  function isLimited(email) {
    const request = { body: { email } };
    limiter(request, null, () => {});
    return request.accountResetRateLimited === true;
  }
  try {
    assert.equal(isLimited("first@example.test"), false);
    assert.equal(isLimited("second@example.test"), true);
    assert.equal(isLimited("first@example.test"), false);
  } finally {
    limiter.close();
  }
});

test("forgot-password IP limiter keeps its generic 429 response", async (t) => {
  const limiter = authRoutes.createForgotPasswordIpLimiter({
    limit: 2,
    skip: () => false,
  });
  const app = express();
  app.use(express.json());
  app.post("/forgot", limiter, (req, res) => {
    res.status(200).json({ message: GENERIC_MESSAGE });
  });
  const server = await startTestServer(app);

  t.after(async () => {
    await server.close();
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${server.baseUrl}/forgot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `address-${attempt}@example.test` }),
    });
    assert.equal(response.status, 200);
  }

  const limited = await fetch(`${server.baseUrl}/forgot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "another@example.test" }),
  });
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), {
    message: "Too many password reset requests. Try again later.",
  });
});
