require("dotenv").config();

const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const express = require("express");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const app = require("../server");
const pool = require("../db/db");
const requireAdmin = require("../middleware/requireAdmin");
const { startTestServer, setTokenVersionQueryMockEnabled } = require("../tests/test_helpers");

const GENERIC_RESET_ERROR = "The password reset link is invalid or has expired.";

test("Admin password reset PostgreSQL integration tests", async (t) => {
  let schemaName;
  let testPool;
  let apiServer;
  let protectedServer;
  let originalQuery;
  let originalConnect;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousFrontendUrl = process.env.FRONTEND_URL;

  t.before(async () => {
    process.env.NODE_ENV = "test";
    process.env.FRONTEND_URL = "https://example.test";
    setTokenVersionQueryMockEnabled(false);

    originalQuery = pool.query.bind(pool);
    originalConnect = pool.connect.bind(pool);
    schemaName = `reset_integration_${crypto.randomBytes(6).toString("hex")}`;
    await originalQuery(`CREATE SCHEMA "${schemaName}"`);

    testPool = new Pool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      max: 8,
      options: `-c search_path=${schemaName}`,
    });
    await testPool.query(`
      CREATE TABLE admins (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(150) NOT NULL,
        email VARCHAR(150) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(30) NOT NULL DEFAULT 'admin',
        token_version INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await testPool.query(`
      CREATE TABLE admin_password_reset_tokens (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    pool.query = testPool.query.bind(testPool);
    pool.connect = testPool.connect.bind(testPool);
    apiServer = await startTestServer(app);

    const protectedApp = express();
    protectedApp.get("/protected", requireAdmin, (req, res) => {
      res.json({ id: req.admin.id, role: req.admin.role });
    });
    protectedServer = await startTestServer(protectedApp);
  });

  t.after(async () => {
    if (apiServer) await apiServer.close();
    if (protectedServer) await protectedServer.close();
    if (originalQuery) pool.query = originalQuery;
    if (originalConnect) pool.connect = originalConnect;
    if (testPool) {
      await testPool.end();
      await originalQuery(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    }
    setTokenVersionQueryMockEnabled(true);
    process.env.NODE_ENV = previousNodeEnv;
    if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontendUrl;
  });

  async function createAdmin(tag, password) {
    const passwordHash = await bcrypt.hash(password, 4);
    const result = await testPool.query(
      `INSERT INTO admins (full_name, email, password_hash)
       VALUES ($1, $2, $3) RETURNING id`,
      ["Integration Test Administrator", `${tag}@example.test`, passwordHash]
    );
    return { id: result.rows[0].id, email: `${tag}@example.test` };
  }

  async function createResetToken(adminId, expiresIn = "30 minutes") {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await testPool.query(
      `INSERT INTO admin_password_reset_tokens (admin_id, token_hash, expires_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP + $3::interval)`,
      [adminId, tokenHash, expiresIn]
    );
    return rawToken;
  }

  async function postReset(token, password) {
    return fetch(`${apiServer.baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
  }

  async function checkProtected(token) {
    return fetch(`${protectedServer.baseUrl}/protected`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  await t.test("login version is enforced before and after password reset", async () => {
    const oldPassword = "OldPassword1234";
    const newPassword = "NewPassword5678";
    const admin = await createAdmin("jwt-reset", oldPassword);

    const login = await fetch(`${apiServer.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: admin.email, password: oldPassword }),
    });
    const loginBody = await login.json();
    assert.equal(login.status, 200);
    assert.equal(jwt.verify(loginBody.token, process.env.JWT_SECRET).token_version, 0);
    assert.equal((await checkProtected(loginBody.token)).status, 200);

    const resetToken = await createResetToken(admin.id);
    const reset = await postReset(resetToken, newPassword);
    assert.equal(reset.status, 200);
    assert.equal((await checkProtected(loginBody.token)).status, 401);

    const oldPasswordLogin = await fetch(`${apiServer.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: admin.email, password: oldPassword }),
    });
    assert.equal(oldPasswordLogin.status, 401);

    const newLogin = await fetch(`${apiServer.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: admin.email, password: newPassword }),
    });
    const newLoginBody = await newLogin.json();
    assert.equal(newLogin.status, 200);
    assert.equal(jwt.verify(newLoginBody.token, process.env.JWT_SECRET).token_version, 1);
    assert.equal((await checkProtected(newLoginBody.token)).status, 200);

    const state = await testPool.query(
      "SELECT token_version FROM admins WHERE id = $1",
      [admin.id]
    );
    assert.equal(state.rows[0].token_version, 1);
  });

  await t.test("expired, invalid, and reused tokens are rejected", async () => {
    const admin = await createAdmin("token-states", "ValidPassword1234");
    const expiredToken = await createResetToken(admin.id, "-1 minute");

    const invalid = await postReset(crypto.randomBytes(32).toString("hex"), "ValidPassword5678");
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).message, GENERIC_RESET_ERROR);

    const expired = await postReset(expiredToken, "ValidPassword5678");
    assert.equal(expired.status, 400);
    assert.equal((await expired.json()).message, GENERIC_RESET_ERROR);

    const validToken = await createResetToken(admin.id);
    assert.equal((await postReset(validToken, "ValidPassword5678")).status, 200);
    const reused = await postReset(validToken, "AnotherPassword9876");
    assert.equal(reused.status, 400);
    assert.equal((await reused.json()).message, GENERIC_RESET_ERROR);
  });

  await t.test("simultaneous forgot requests leave only one active token", async () => {
    const admin = await createAdmin("parallel-forgot", "ValidPassword1234");
    const sendRequest = () => fetch(`${apiServer.baseUrl}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: admin.email }),
    });
    const responses = await Promise.all([sendRequest(), sendRequest()]);
    assert.deepEqual(responses.map((response) => response.status), [200, 200]);
    for (const response of responses) {
      assert.deepEqual(await response.json(), {
        message: "If an administrator account exists for this email, a password reset link has been sent.",
      });
    }

    const tokens = await testPool.query(
      `SELECT COUNT(*) FILTER (WHERE used_at IS NULL)::integer AS active,
              COUNT(*)::integer AS total,
              BOOL_AND(token_hash ~ '^[0-9a-f]{64}$') AS hashes_only
       FROM admin_password_reset_tokens
       WHERE admin_id = $1`,
      [admin.id]
    );
    assert.equal(tokens.rows[0].active, 1);
    assert.equal(tokens.rows[0].total, 2);
    assert.equal(tokens.rows[0].hashes_only, true);
  });

  await t.test("simultaneous use of the same token permits exactly one reset", async () => {
    const admin = await createAdmin("parallel-same-token", "ValidPassword1234");
    const token = await createResetToken(admin.id);
    const responses = await Promise.all([
      postReset(token, "ConcurrentPasswordA123"),
      postReset(token, "ConcurrentPasswordB123"),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);

    const state = await testPool.query(
      `SELECT a.token_version, a.password_hash,
              COUNT(*) FILTER (WHERE t.used_at IS NULL)::integer AS active_tokens
       FROM admins a
       LEFT JOIN admin_password_reset_tokens t ON t.admin_id = a.id
       WHERE a.id = $1
       GROUP BY a.id`,
      [admin.id]
    );
    assert.equal(state.rows[0].token_version, 1);
    assert.equal(state.rows[0].active_tokens, 0);
    assert.ok(
      await bcrypt.compare("ConcurrentPasswordA123", state.rows[0].password_hash) ||
      await bcrypt.compare("ConcurrentPasswordB123", state.rows[0].password_hash)
    );
  });

  await t.test("simultaneous use of different outstanding tokens serializes without 500s", async () => {
    const admin = await createAdmin("parallel-two-tokens", "ValidPassword1234");
    const tokenOne = await createResetToken(admin.id);
    const tokenTwo = await createResetToken(admin.id);
    const responses = await Promise.all([
      postReset(tokenOne, "ConcurrentPasswordC123"),
      postReset(tokenTwo, "ConcurrentPasswordD123"),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);

    const state = await testPool.query(
      `SELECT a.token_version,
              a.password_hash,
              COUNT(*) FILTER (WHERE t.used_at IS NULL)::integer AS active_tokens
       FROM admins a
       LEFT JOIN admin_password_reset_tokens t ON t.admin_id = a.id
       WHERE a.id = $1
       GROUP BY a.id`,
      [admin.id]
    );
    assert.equal(state.rows[0].token_version, 1);
    assert.equal(state.rows[0].active_tokens, 0);
    assert.ok(
      await bcrypt.compare("ConcurrentPasswordC123", state.rows[0].password_hash) ||
      await bcrypt.compare("ConcurrentPasswordD123", state.rows[0].password_hash)
    );
  });
});
