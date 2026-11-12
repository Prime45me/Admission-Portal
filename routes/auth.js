const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { rateLimit } = require("express-rate-limit");
const pool = require("../db/db");
const { sendPasswordResetEmail } = require("../services/resendEmail");

const router = express.Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skip: () => process.env.NODE_ENV === "test",
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Try again later." }
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skip: () => process.env.NODE_ENV === "test",
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many password reset requests. Try again later." }
});

const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skip: () => process.env.NODE_ENV === "test",
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many password reset attempts. Try again later." }
});

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function validateNewPassword(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 128) {
    return "Password must be between 12 and 128 characters.";
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return "Password must include an uppercase letter, a lowercase letter, and a number.";
  }
  return null;
}

router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      email.trim().length > 150 ||
      !emailPattern.test(email.trim()) ||
      email.trim().includes("..") ||
      !password
    ) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const result = await pool.query(
      `SELECT id, full_name, email, password_hash, role
       FROM admins
       WHERE LOWER(email) = $1`,
      [email.trim().toLowerCase()]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const admin = result.rows[0];
    const passwordMatches = await bcrypt.compare(password, admin.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ message: "Invalid email or password." });
    }
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is not configured.");
    }

    const token = jwt.sign(
      { id: admin.id, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    return res.status(200).json({
      message: "Login successful.",
      token,
      admin: {
        id: admin.id,
        full_name: admin.full_name,
        email: admin.email,
        role: admin.role
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "An internal server error occurred." });
  }
});

router.post("/forgot-password", forgotPasswordLimiter, async (req, res) => {
  const genericMessage = "If an administrator account exists for this email, a password reset link has been sent.";
  try {
    const { email } = req.body ?? {};
    if (typeof email !== "string" || !email.trim() || email.trim().length > 150 || !emailPattern.test(email.trim())) {
      return res.status(400).json({ message: "Please enter a valid administrator email address." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const adminResult = await pool.query(
      "SELECT id, email FROM admins WHERE LOWER(email) = $1",
      [normalizedEmail]
    );
    const admin = adminResult.rows[0];

    if (admin) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashResetToken(rawToken);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE admin_password_reset_tokens
           SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP)
           WHERE admin_id = $1 AND used_at IS NULL`,
          [admin.id]
        );
        await client.query(
          `INSERT INTO admin_password_reset_tokens (admin_id, token_hash, expires_at)
           VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '30 minutes')`,
          [admin.id, tokenHash]
        );
        await client.query("COMMIT");

        const frontendUrl = (process.env.FRONTEND_URL || "").replace(/\/+$/, "");
        if (frontendUrl) {
          const resetUrl = `${frontendUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
          await sendPasswordResetEmail({ to: admin.email, resetUrl });
        }
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        throw error;
      } finally {
        client.release();
      }
    }
    return res.status(200).json({ message: genericMessage });
  } catch (error) {
    console.error("Password reset request could not be completed:", error.code || "UNKNOWN");
    return res.status(200).json({ message: genericMessage });
  }
});

router.post("/reset-password", resetPasswordLimiter, async (req, res) => {
  try {
    const { token, password } = req.body ?? {};
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token.trim())) {
      return res.status(400).json({ message: "The password reset link is invalid or has expired." });
    }
    const passwordError = validateNewPassword(password);
    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    const tokenHash = hashResetToken(token.trim().toLowerCase());
    const passwordHash = await bcrypt.hash(password, 12);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const tokenResult = await client.query(
        `SELECT id, admin_id
         FROM admin_password_reset_tokens
         WHERE token_hash = $1
           AND used_at IS NULL
           AND expires_at > CURRENT_TIMESTAMP
         FOR UPDATE`,
        [tokenHash]
      );
      if (tokenResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "The password reset link is invalid or has expired." });
      }

      const resetRecord = tokenResult.rows[0];
      await client.query(
        "UPDATE admins SET password_hash = $1 WHERE id = $2",
        [passwordHash, resetRecord.admin_id]
      );
      await client.query(
        `UPDATE admin_password_reset_tokens
         SET used_at = CURRENT_TIMESTAMP
         WHERE admin_id = $1 AND used_at IS NULL`,
        [resetRecord.admin_id]
      );
      await client.query("COMMIT");
      return res.status(200).json({
        message: "Password reset successful. You can now sign in with your new password."
      });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Password reset could not be completed:", error.code || "UNKNOWN");
    return res.status(500).json({ message: "An internal server error occurred." });
  }
});

module.exports = router;
