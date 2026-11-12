const test = require("node:test");
const assert = require("node:assert/strict");
const { sendApplicationStatusNotification } = require("../services/resendEmail");

test("status notification emails use the applicant, reference, school branding, and supported guidance", async () => {
  const previousFrontendUrl = process.env.FRONTEND_URL;
  const previousFromEmail = process.env.RESEND_FROM_EMAIL;
  process.env.FRONTEND_URL = "http://localhost:5173";
  process.env.RESEND_FROM_EMAIL = "Peniel Admissions <admissions@example.test>";

  const cases = [
    {
      status: "new",
      label: "New",
      guidance: "within five working days",
    },
    {
      status: "under_review",
      label: "Under review",
      guidance: "currently under review",
    },
    {
      status: "accepted",
      label: "Accepted",
      guidance: "not a formal offer of admission",
    },
    {
      status: "rejected",
      label: "Rejected",
      guidance: "marked as rejected in the portal",
    },
  ];

  try {
    for (const item of cases) {
      let sentEmail;
      const result = await sendApplicationStatusNotification({
        to: "applicant@example.test",
        applicantName: "Ada Applicant",
        applicationNumber: "PEN-2026-TEST001",
        status: item.status,
        resendClient: {
          emails: {
            send: async (email) => {
              sentEmail = email;
              return { id: "mock-email-id" };
            },
          },
        },
      });

      assert.deepStrictEqual(result, { delivered: true });
      assert.strictEqual(sentEmail.to, "applicant@example.test");
      assert.match(sentEmail.subject, /PEN-2026-TEST001/);
      assert.match(sentEmail.html, /Ada Applicant/);
      assert.match(sentEmail.html, /PEN-2026-TEST001/);
      assert.match(sentEmail.html, new RegExp(item.label));
      assert.match(sentEmail.html, new RegExp(item.guidance));
      assert.match(sentEmail.html, /Peniel Educational Complex and Kiddy Care/);
      assert.match(sentEmail.html, /Galloway 148 Cherry Road/);
      assert.match(sentEmail.html, /\+233 \(0\) 24 940 3249/);
      assert.match(sentEmail.html, /penieleducationalcomplex2013@gmail\.com/);
      assert.match(sentEmail.html, /src="cid:peniel-school-logo"/);
      assert.ok(Buffer.isBuffer(sentEmail.attachments[0].content));
      assert.strictEqual(sentEmail.attachments[0].contentId, "peniel-school-logo");
      assert.strictEqual(sentEmail.attachments[0].contentType, "image/jpeg");
      assert.doesNotMatch(
        sentEmail.html,
        /src="(?:http:\/\/localhost:5173|https:\/\/school\.example\.test)\/images\/logo\.jpeg"/
      );
      assert.match(sentEmail.text, new RegExp(item.label));
      assert.match(sentEmail.text, new RegExp(item.guidance));
    }
  } finally {
    if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontendUrl;
    if (previousFromEmail === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previousFromEmail;
  }
});

test("status notification email escapes applicant-controlled HTML fields", async () => {
  const previousFromEmail = process.env.RESEND_FROM_EMAIL;
  process.env.RESEND_FROM_EMAIL = "Peniel Admissions <admissions@example.test>";
  let sentEmail;
  try {
    const result = await sendApplicationStatusNotification({
      to: "applicant@example.test",
      applicantName: "<Applicant>",
      applicationNumber: "REF&123",
      status: "accepted",
      resendClient: {
        emails: {
          send: async (email) => {
            sentEmail = email;
            return {};
          },
        },
      },
    });

    assert.deepStrictEqual(result, { delivered: true });
    assert.match(sentEmail.html, /&lt;Applicant&gt;/);
    assert.match(sentEmail.html, /REF&amp;123/);
    assert.doesNotMatch(sentEmail.html, /<Applicant>/);
    assert.doesNotMatch(sentEmail.html, /REF&123/);
  } finally {
    if (previousFromEmail === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previousFromEmail;
  }
});

test("status notification provider failure is reported without applicant details", async () => {
  const previousFromEmail = process.env.RESEND_FROM_EMAIL;
  process.env.RESEND_FROM_EMAIL = "Peniel Admissions <admissions@example.test>";

  try {
    const result = await sendApplicationStatusNotification({
      to: "applicant@example.test",
      applicantName: "Synthetic Applicant",
      applicationNumber: "PEN-TEST-FAILURE",
      status: "rejected",
      resendClient: {
        emails: {
          send: async () => {
            throw new Error("Mock provider failure");
          },
        },
      },
    });

    assert.deepStrictEqual(result, {
      delivered: false,
      reason: "RESEND_DELIVERY_FAILED",
    });
  } finally {
    if (previousFromEmail === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previousFromEmail;
  }
});
