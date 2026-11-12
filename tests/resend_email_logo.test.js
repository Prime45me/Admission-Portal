const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  sendApplicationConfirmation,
  sendPasswordResetEmail,
  sendApplicationStatusNotification,
} = require("../services/resendEmail");

test("all Peniel email templates inline the repository logo as a CID attachment", async () => {
  const previousFromEmail = process.env.RESEND_FROM_EMAIL;
  const previousFrontendUrl = process.env.FRONTEND_URL;
  process.env.RESEND_FROM_EMAIL = "Peniel Admissions <admissions@example.test>";
  process.env.FRONTEND_URL = "http://localhost:5173";
  const logoPath = path.resolve(
    __dirname,
    "../../frontend/public/images/logo.jpeg"
  );
  const expectedLogo = fs.readFileSync(logoPath);
  const templates = [
    () => captureEmail((resendClient) => sendApplicationConfirmation({
      to: "applicant@example.test",
      applicationNumber: "PEN-TEST-CONFIRMATION",
      resendClient,
    })),
    () => captureEmail((resendClient) => sendPasswordResetEmail({
      to: "admin@example.test",
      resetUrl: "https://school.example.test/reset-password?token=mock-token",
      resendClient,
    })),
    () => captureEmail((resendClient) => sendApplicationStatusNotification({
      to: "applicant@example.test",
      applicantName: "Synthetic Applicant",
      applicationNumber: "PEN-TEST-STATUS",
      status: "accepted",
      resendClient,
    })),
  ];

  try {
    for (const sendTemplate of templates) {
      const { result, message } = await sendTemplate();
      assert.deepStrictEqual(result, { delivered: true });
      assert.match(message.html, /src="cid:peniel-school-logo"/);
      assert.match(
        message.html,
        /alt="Peniel Educational Complex and Kiddy Care logo"/
      );
      assert.doesNotMatch(message.html, /\/images\/logo\.jpeg/);
      assert.strictEqual(message.attachments.length, 1);
      assert.strictEqual(message.attachments[0].filename, "peniel-school-logo.jpeg");
      assert.strictEqual(message.attachments[0].contentId, "peniel-school-logo");
      assert.strictEqual(message.attachments[0].contentType, "image/jpeg");
      assert.ok(Buffer.isBuffer(message.attachments[0].content));
      assert.deepStrictEqual(message.attachments[0].content, expectedLogo);
    }
  } finally {
    if (previousFromEmail === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previousFromEmail;
    if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontendUrl;
  }
});

async function captureEmail(sendEmail) {
  let message;
  const result = await sendEmail({
    emails: {
      send: async (email) => {
        message = email;
        return { id: "mock-email-id" };
      },
    },
  });
  return { result, message };
}
