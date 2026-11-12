const { Resend } = require("resend");

function getResendClient() {
  if (!process.env.RESEND_API_KEY) {
    return null;
  }
  return new Resend(process.env.RESEND_API_KEY);
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
  const html = `<p>Dear Applicant,</p>
<p>We have received your application to <strong>${schoolName}</strong>.</p>
<p>Your application number is <strong>${applicationNumber}</strong>.</p>
<p>Thank you.</p>`;
  const text = `Dear Applicant,\n\nWe have received your application to ${schoolName}.\nYour application number is ${applicationNumber}.\n\nThank you.`;

  try {
    const response = await resend.emails.send({
      from,
      to,
      subject: `Application received - ${applicationNumber}`,
      html,
      text,
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
  const html = `<div style="font-family:Arial,sans-serif;color:#0B1437">
<h1 style="font-size:22px">${schoolName}</h1>
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

module.exports = { sendApplicationConfirmation, sendPasswordResetEmail };
