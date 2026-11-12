const { Resend } = require("resend");
const fs = require("fs");
const path = require("path");

const SCHOOL_LOGO_CONTENT_ID = "peniel-school-logo";
const SCHOOL_LOGO_PATH = path.resolve(
  __dirname,
  "../../frontend/public/images/logo.jpeg"
);
let schoolLogoBuffer;
let schoolLogoLoaded = false;

function getResendClient() {
  if (!process.env.RESEND_API_KEY) {
    return null;
  }
  return new Resend(process.env.RESEND_API_KEY);
}

function getSchoolLogoAttachment() {
  if (!schoolLogoLoaded) {
    schoolLogoLoaded = true;
    try {
      const content = fs.readFileSync(SCHOOL_LOGO_PATH);
      if (content.length === 0) {
        console.error("Peniel email logo asset is empty.");
      } else {
        schoolLogoBuffer = content;
      }
    } catch (error) {
      console.error(
        "Peniel email logo asset could not be loaded:",
        error?.code || error?.name || "UNKNOWN"
      );
    }
  }

  if (!schoolLogoBuffer) {
    return null;
  }

  return {
    filename: "peniel-school-logo.jpeg",
    content: schoolLogoBuffer,
    contentType: "image/jpeg",
    contentId: SCHOOL_LOGO_CONTENT_ID,
  };
}

function createSchoolEmailHeader(schoolName, logoAttachment) {
  const logo = logoAttachment
    ? `<img src="cid:${SCHOOL_LOGO_CONTENT_ID}" alt="${escapeHtml(schoolName)} logo" width="64" height="64" style="display:block;width:64px;height:64px;max-width:100%;object-fit:contain;border-radius:50%;background:#fff">`
    : `<div style="width:64px;height:64px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#0B1437;color:#C9A84C;font-weight:bold">P</div>`;

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
  <tr>
    <td width="76" valign="middle">${logo}</td>
    <td valign="middle" style="padding-left:12px">
      <div style="font-family:Georgia,serif;font-size:20px;font-weight:bold;line-height:1.3;color:#0B1437">${escapeHtml(schoolName)}</div>
      <div style="margin-top:5px;font-size:11px;letter-spacing:1px;color:#8A6A1F">EXCELLENCE IN EDUCATION</div>
    </td>
  </tr>
</table>`;
}

async function sendApplicationConfirmation({
  to,
  applicationNumber,
  resendClient,
}) {
  const resend = resendClient || getResendClient();
  const from = process.env.RESEND_FROM_EMAIL;
  if (!resend || !from) {
    return { delivered: false, reason: "RESEND_NOT_CONFIGURED" };
  }
  if (!resendClient && process.env.NODE_ENV === "test") {
    return { delivered: false, reason: "RESEND_DISABLED_IN_TESTS" };
  }

  const schoolName = "Peniel Educational Complex and Kiddy Care";
  const logoAttachment = getSchoolLogoAttachment();
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#172033">
${createSchoolEmailHeader(schoolName, logoAttachment)}
<div style="height:1px;margin:20px 0;background:#E6E0D3"></div>
<p>Dear Applicant,</p>
<p>We have received your application to <strong>${schoolName}</strong>.</p>
<p>Your application number is <strong>${applicationNumber}</strong>.</p>
<p>Thank you.</p>
</div>`;
  const text = `Dear Applicant,\n\nWe have received your application to ${schoolName}.\nYour application number is ${applicationNumber}.\n\nThank you.`;

  try {
    const response = await resend.emails.send({
      from,
      to,
      subject: `Application received - ${applicationNumber}`,
      html,
      text,
      attachments: logoAttachment ? [logoAttachment] : undefined,
    });
    if (response?.error) {
      console.error(
        "Application confirmation email failed:",
        response.error.name || response.error.code || "UNKNOWN"
      );
      return { delivered: false, reason: "RESEND_DELIVERY_FAILED" };
    }
    return { delivered: true };
  } catch (error) {
    console.error("Application confirmation email failed:", error?.name || "UNKNOWN");
    return { delivered: false, reason: "RESEND_DELIVERY_FAILED" };
  }
}

async function sendPasswordResetEmail({
  to,
  resetUrl,
  resendClient,
}) {
  const resend = resendClient || getResendClient();
  const from = process.env.RESEND_FROM_EMAIL;
  if (!resend || !from) {
    return { delivered: false, reason: "RESEND_NOT_CONFIGURED" };
  }
  if (!resendClient && process.env.NODE_ENV === "test") {
    return { delivered: false, reason: "RESEND_DISABLED_IN_TESTS" };
  }

  const schoolName = "Peniel Educational Complex and Kiddy Care";
  const logoAttachment = getSchoolLogoAttachment();
  const html = `<div style="font-family:Arial,sans-serif;color:#0B1437">
${createSchoolEmailHeader(schoolName, logoAttachment)}
<div style="height:1px;margin:20px 0;background:#E6E0D3"></div>
<p>An administrator password reset was requested for your Peniel admin account.</p>
<p><a href="${resetUrl}" style="display:inline-block;background:#C9A84C;color:#0B1437;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Reset Password</a></p>
<p>This link expires in <strong>30 minutes</strong>.</p>
<p>If you did not request this reset, you can safely ignore this email.</p>
</div>`;
  const text = `Peniel Educational Complex and Kiddy Care\n\nAn administrator password reset was requested.\nReset your password: ${resetUrl}\n\nThis link expires in 30 minutes.\nIf you did not request this reset, ignore this email.`;

  try {
    const response = await resend.emails.send({
      from,
      to,
      subject: "Reset your Peniel administrator password",
      html,
      text,
      attachments: logoAttachment ? [logoAttachment] : undefined,
    });
    if (response?.error) {
      console.error(
        "Password reset email failed:",
        response.error.name || response.error.code || "UNKNOWN"
      );
      return { delivered: false, reason: "RESEND_DELIVERY_FAILED" };
    }
    return { delivered: true };
  } catch (error) {
    console.error("Password reset email failed:", error?.name || "UNKNOWN");
    return { delivered: false, reason: "RESEND_DELIVERY_FAILED" };
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

const applicationStatusContent = {
  new: {
    label: "New",
    message:
      "The admissions board reviews application data within five working days. The primary guardian will be contacted by telephone or email.",
  },
  under_review: {
    label: "Under review",
    message:
      "The application is currently under review. The primary guardian will be contacted by telephone or email.",
  },
  accepted: {
    label: "Accepted",
    message:
      "This status notification is not a formal offer of admission. Formal admission letters are issued after satisfactory completion of entrance assessments, document verification, and seat placement.",
  },
  rejected: {
    label: "Rejected",
    message:
      "The application has been marked as rejected in the portal. Please contact the school using the details below if you need clarification.",
  },
};

async function sendApplicationStatusNotification({
  to,
  applicantName,
  applicationNumber,
  status,
  resendClient,
}) {
  const resend = resendClient || getResendClient();
  const from = process.env.RESEND_FROM_EMAIL;
  if (!resend || !from) {
    return { delivered: false, reason: "RESEND_NOT_CONFIGURED" };
  }
  if (!resendClient && process.env.NODE_ENV === "test") {
    return { delivered: false, reason: "RESEND_DISABLED_IN_TESTS" };
  }

  const statusContent = Object.prototype.hasOwnProperty.call(
    applicationStatusContent,
    status
  ) ? applicationStatusContent[status] : null;
  if (!statusContent) {
    return { delivered: false, reason: "INVALID_STATUS" };
  }

  const schoolName = "Peniel Educational Complex and Kiddy Care";
  const address = "Galloway 148 Cherry Road, Koforidua - E/R Ghana.";
  const phone = "+233 (0) 24 940 3249";
  const contactEmail = "penieleducationalcomplex2013@gmail.com";
  const frontendUrl = (process.env.FRONTEND_URL || "").trim().replace(/\/+$/, "");
  const logoAttachment = getSchoolLogoAttachment();
  const normalizedApplicantName =
    typeof applicantName === "string" ? applicantName.trim() : "";
  const safeName = escapeHtml(normalizedApplicantName || "Applicant");
  const safeApplicationNumber = escapeHtml(applicationNumber);
  const safeStatus = escapeHtml(statusContent.label);
  const safeMessage = escapeHtml(statusContent.message);
  const schoolHeader = createSchoolEmailHeader(schoolName, logoAttachment);
  const websiteMarkup = frontendUrl
    ? `<a href="${escapeHtml(frontendUrl)}" style="color:#C9A84C;text-decoration:underline">${escapeHtml(frontendUrl)}</a>`
    : "";
  const websiteText = frontendUrl ? `\nWebsite: ${frontendUrl}` : "";
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    @media only screen and (max-width: 600px) {
      .email-shell { width: 100% !important; }
      .email-content { padding: 22px 18px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:24px 10px;background:#F6F4EF;font-family:Arial,Helvetica,sans-serif;color:#172033">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr><td align="center">
      <table role="presentation" class="email-shell" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#fff;border-top:5px solid #C9A84C">
        <tr><td class="email-content" style="padding:28px 32px">
          ${schoolHeader}
          <div style="height:1px;margin:22px 0;background:#E6E0D3"></div>
          <p style="font-size:16px;line-height:1.6">Dear ${safeName},</p>
          <p style="font-size:15px;line-height:1.7">The application status for reference <strong style="color:#0B1437">${safeApplicationNumber}</strong> has been updated:</p>
          <div style="margin:20px 0;padding:16px;background:#F6F4EF;border-left:4px solid #C9A84C">
            <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#5D6472">Current status</div>
            <div style="margin-top:6px;font-size:21px;font-weight:bold;color:#0B1437">${safeStatus}</div>
          </div>
          <p style="font-size:14px;line-height:1.7">${safeMessage}</p>
          <p style="font-size:14px;line-height:1.7">Please keep your application reference number for any enquiries.</p>
        </td></tr>
        <tr><td class="email-content" style="padding:20px 32px;background:#0B1437;color:#fff">
          <div style="font-family:Georgia,serif;font-size:16px;font-weight:bold;color:#fff">${schoolName}</div>
          <div style="margin-top:10px;font-size:12px;line-height:1.8;color:#E7E8ED">
            ${escapeHtml(address)}<br>
            <a href="tel:+233249403249" style="color:#F0D080;text-decoration:none">${phone}</a><br>
            <a href="mailto:${contactEmail}" style="color:#F0D080;text-decoration:none">${contactEmail}</a>
            ${websiteMarkup ? `<br>${websiteMarkup}` : ""}
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  const text = `Dear ${normalizedApplicantName || "Applicant"},

The application status for reference ${applicationNumber} has been updated: ${statusContent.label}.

${statusContent.message}

Please keep your application reference number for any enquiries.

${schoolName}
${address}
${phone}
${contactEmail}${websiteText}`;

  try {
    const response = await resend.emails.send({
      from,
      to,
      subject: `Application status update - ${applicationNumber}`,
      html,
      text,
      attachments: logoAttachment ? [logoAttachment] : undefined,
    });
    if (response?.error) {
      console.error(
        "Application status email failed:",
        response.error.name || response.error.code || "UNKNOWN"
      );
      return { delivered: false, reason: "RESEND_DELIVERY_FAILED" };
    }
    return { delivered: true };
  } catch (error) {
    console.error("Application status email failed:", error?.name || "UNKNOWN");
    return { delivered: false, reason: "RESEND_DELIVERY_FAILED" };
  }
}

module.exports = {
  sendApplicationConfirmation,
  sendPasswordResetEmail,
  sendApplicationStatusNotification,
};
