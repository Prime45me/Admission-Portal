require("dotenv").config();

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { Pool } = require("pg");
const app = require("../server");
const pool = require("../db/db");
const resendEmail = require("../services/resendEmail");
const {
  createToken,
  startTestServer,
  setTokenVersionQueryMockEnabled,
} = require("../tests/test_helpers");

test("Application status notifications serialize concurrent PostgreSQL transitions", async (t) => {
  let schemaName;
  let testPool;
  let apiServer;
  let originalQuery;
  let originalConnect;
  const originalStatusNotifier = resendEmail.sendApplicationStatusNotification;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousFrontendUrl = process.env.FRONTEND_URL;
  let adminId;
  let applicationId;
  const deliveredNotifications = [];

  t.before(async () => {
    process.env.NODE_ENV = "test";
    process.env.FRONTEND_URL = "https://school.example.test";
    setTokenVersionQueryMockEnabled(false);

    originalQuery = pool.query.bind(pool);
    originalConnect = pool.connect.bind(pool);
    schemaName = `status_email_${crypto.randomBytes(6).toString("hex")}`;
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
        token_version INTEGER NOT NULL DEFAULT 0
      )
    `);
    await testPool.query(`
      CREATE TABLE applications (
        id SERIAL PRIMARY KEY,
        application_number VARCHAR(30) NOT NULL UNIQUE,
        first_name VARCHAR(100) NOT NULL,
        middle_name VARCHAR(100),
        last_name VARCHAR(100) NOT NULL,
        email VARCHAR(150) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'new'
          CHECK (status IN ('new', 'under_review', 'accepted', 'rejected')),
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const adminResult = await testPool.query(
      "INSERT INTO admins DEFAULT VALUES RETURNING id"
    );
    adminId = adminResult.rows[0].id;
    const applicationResult = await testPool.query(
      `INSERT INTO applications (
         application_number, first_name, middle_name, last_name, email, status
       )
       VALUES ($1, $2, $3, $4, $5, 'new')
       RETURNING id`,
      [
        "PEN-2026-STATUS001",
        "Test",
        "Applicant",
        "Record",
        "status-test@example.test",
      ]
    );
    applicationId = applicationResult.rows[0].id;

    pool.query = testPool.query.bind(testPool);
    pool.connect = testPool.connect.bind(testPool);
    resendEmail.sendApplicationStatusNotification = async (notification) => {
      const state = await testPool.query(
        "SELECT status FROM applications WHERE id = $1",
        [applicationId]
      );
      deliveredNotifications.push({
        ...notification,
        committedStatus: state.rows[0].status,
      });
      return { delivered: true };
    };
    apiServer = await startTestServer(app);
  });

  t.after(async () => {
    if (apiServer) await apiServer.close();
    resendEmail.sendApplicationStatusNotification = originalStatusNotifier;
    if (originalQuery) pool.query = originalQuery;
    if (originalConnect) pool.connect = originalConnect;
    if (testPool) {
      await testPool.end();
      await originalQuery(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    }
    setTokenVersionQueryMockEnabled(true);
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontendUrl;
  });

  await t.test("same-status concurrent requests send one email after commit", async () => {
    const token = createToken({ id: adminId, role: "admin", token_version: 0 });
    const sendUpdate = () => fetch(
      `${apiServer.baseUrl}/api/applications/${applicationId}/status`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "accepted" }),
      }
    );

    const responses = await Promise.all([sendUpdate(), sendUpdate()]);
    assert.deepStrictEqual(responses.map((response) => response.status), [200, 200]);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    assert.ok(bodies.every((body) => body.application.status === "accepted"));

    const state = await testPool.query(
      "SELECT status FROM applications WHERE id = $1",
      [applicationId]
    );
    assert.strictEqual(state.rows[0].status, "accepted");
    assert.strictEqual(deliveredNotifications.length, 1);
    assert.strictEqual(deliveredNotifications[0].committedStatus, "accepted");
    assert.strictEqual(deliveredNotifications[0].to, "status-test@example.test");
    assert.strictEqual(
      deliveredNotifications[0].applicationNumber,
      "PEN-2026-STATUS001"
    );
    assert.strictEqual(
      deliveredNotifications[0].applicantName,
      "Test Applicant Record"
    );
  });
});
