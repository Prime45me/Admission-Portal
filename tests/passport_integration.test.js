const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer, validApplicationPayload, createToken } = require("./test_helpers");
const app = require("../server");
const pool = require("../db/db");
const { sendApplicationConfirmation } = require("../services/resendEmail");
const storage = require("../services/supabaseStorage");

function jpegFile() {
  return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])], {
    type: "image/jpeg",
  });
}

function multipartPayload(payload = validApplicationPayload()) {
  const form = new FormData();
  form.append("application", JSON.stringify(payload));
  return form;
}

test("Passport upload validation and integration", async (t) => {
  let testEnv;

  t.before(async () => {
    testEnv = await startTestServer(app);
  });
  t.after(async () => {
    await testEnv.close();
  });

  await t.test("accepts a valid JPEG multipart application", async () => {
    const originalConnect = pool.connect;
    pool.connect = async () => ({
      query: async (sql) => {
        if (sql.includes("INSERT INTO applications")) {
          return { rowCount: 1, rows: [{ id: 901, application_number: "PEN-2026-PASS", first_name: "Kwame", last_name: "Mensah", status: "new", created_at: new Date().toISOString() }] };
        }
        if (sql.includes("INSERT INTO guardians")) {
          return { rowCount: 1, rows: [{ id: 902, full_name: "Ama Mensah", relationship: "Mother", phone_number: "0247654321", email: null, address: null }] };
        }
        return { rowCount: 0, rows: [] };
      },
      release: () => {},
    });

    const form = multipartPayload();
    form.append("passport", jpegFile(), "photo.jpg");
    try {
      const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
        method: "POST",
        body: form,
      });
      assert.equal(res.status, 201);
    } finally {
      pool.connect = originalConnect;
    }
  });

  await t.test("rejects missing required photograph", async () => {
    const form = multipartPayload();
    const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
      method: "POST",
      body: form,
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).message, /passport photograph/i);
  });

  await t.test("rejects spoofed JPEG contents", async () => {
    const form = multipartPayload();
    form.append("passport", new Blob(["not an image"], { type: "image/jpeg" }), "photo.jpg");
    const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
      method: "POST",
      body: form,
    });
    assert.equal(res.status, 400);
  });

  await t.test("rejects files over 5 MB", async () => {
    const form = multipartPayload();
    form.append("passport", new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/jpeg" }), "large.jpg");
    const res = await fetch(`${testEnv.baseUrl}/api/applications`, {
      method: "POST",
      body: form,
    });
    assert.equal(res.status, 400);
  });

  await t.test("missing configured email is handled safely", async () => {
    const previousKey = process.env.RESEND_API_KEY;
    const previousFrom = process.env.RESEND_FROM_EMAIL;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    try {
      const result = await sendApplicationConfirmation({
        to: "applicant@example.com",
        applicationNumber: "PEN-2026-TEST",
      });
      assert.equal(result.delivered, false);
      assert.equal(result.reason, "RESEND_NOT_CONFIGURED");
    } finally {
      if (previousKey) process.env.RESEND_API_KEY = previousKey;
      if (previousFrom) process.env.RESEND_FROM_EMAIL = previousFrom;
    }
  });

  await t.test("Resend error responses do not invalidate application submission", async () => {
    const previousFrom = process.env.RESEND_FROM_EMAIL;
    process.env.RESEND_FROM_EMAIL = "Peniel Admissions <admissions@example.com>";
    try {
      const result = await sendApplicationConfirmation({
        to: "applicant@example.com",
        applicationNumber: "PEN-2026-TEST",
        resendClient: {
          emails: {
            send: async () => ({
              error: { name: "validation_error" },
            }),
          },
        },
      });
      assert.equal(result.delivered, false);
      assert.equal(result.reason, "RESEND_DELIVERY_FAILED");
    } finally {
      if (previousFrom) {
        process.env.RESEND_FROM_EMAIL = previousFrom;
      } else {
        delete process.env.RESEND_FROM_EMAIL;
      }
    }
  });

  await t.test("returns 404 for a missing passport document", async () => {
    const originalQuery = pool.query;
    pool.query = async () => ({ rowCount: 0, rows: [] });
    try {
      const res = await fetch(`${testEnv.baseUrl}/api/applications/901/passport`, {
        headers: { Authorization: `Bearer ${createToken({ id: 1, role: "admin" })}` },
      });
      assert.equal(res.status, 404);
    } finally {
      pool.query = originalQuery;
    }
  });

  await t.test("storage test adapter and missing configuration are explicit", async () => {
    const uploaded = await storage.uploadPassport({
      objectPath: "applications/1/test.jpg",
      buffer: Buffer.from([0xff, 0xd8, 0xff]),
      contentType: "image/jpeg",
    });
    assert.equal(uploaded.path, "applications/1/test.jpg");

    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await assert.rejects(
      storage.createPassportSignedUrl("applications/1/test.jpg"),
      /SUPABASE_STORAGE_NOT_CONFIGURED/
    );
  });
});
