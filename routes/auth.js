const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { rateLimit } = require("express-rate-limit");
const pool = require("../db/db");
const resendEmail = require("../services/resendEmail");

const router = express.Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_REQUEST_MESSAGE =
  "If an administrator account exists for this email, a password reset link has been sent.";
const RESET_REQUEST_MIN_RESPONSE_MS = 500;
const ACCOUNT_RESET_RATE_WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_RESET_RATE_LIMIT = 3;
const ACCOUNT_RESET_RATE_MAX_KEYS = 10000;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skip: () => process.env.NODE_ENV === "test",
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Try again later." }
});

function createForgotPasswordIpLimiter({
  limit = 5,
  skip = () => process.env.NODE_ENV === "test"
} = {}) {
  return rateLimit({
    windowMs: ACCOUNT_RESET_RATE_WINDOW_MS,
    limit,
    skip,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many password reset requests. Try again later." }
  });
}

const forgotPasswordLimiter = createForgotPasswordIpLimiter();

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

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function createAccountResetRateLimiter({
  limit = ACCOUNT_RESET_RATE_LIMIT,
  windowMs = ACCOUNT_RESET_RATE_WINDOW_MS,
  maxKeys = ACCOUNT_RESET_RATE_MAX_KEYS,
  now = Date.now,
  secret
} = {}) {
  const entries = new Map();
  const localSecret = secret || process.env.RESET_RATE_LIMIT_SECRET ||
    process.env.JWT_SECRET || crypto.randomBytes(32);

  const cleanup = setInterval(() => {
    const time = now();
    for (const [key, entry] of entries) {
      if (entry.resetAt <= time) entries.delete(key);
    }
  }, Math.min(windowMs, 60 * 1000));
  cleanup.unref();

  const middleware = (req, res, next) => {
    const email = normalizeEmail(req.body?.email);
    if (!email || email.length > 150 || !emailPattern.test(email)) {
      return next();
    }

    const key = crypto.createHmac("sha256", localSecret).update(email).digest("hex");
    const time = now();
    let entry = entries.get(key);
    if (!entry || entry.resetAt <= time) {
      if (entries.size >= maxKeys) {
        for (const [candidate, candidateEntry] of entries) {
          if (candidateEntry.resetAt <= time) entries.delete(candidate);
        }
        if (entries.size >= maxKeys) {
          req.accountResetRateLimited = true;
          return next();
        }
      }
      entry = { count: 0, resetAt: time + windowMs };
      entries.set(key, entry);
    }

    if (entry.count >= limit) {
      req.accountResetRateLimited = true;
    } else {
      entry.count += 1;
    }
    return next();
  };

  middleware.clear = () => entries.clear();
  middleware.close = () => clearInterval(cleanup);
  return middleware;
}

const accountResetLimiter = createAccountResetRateLimiter();

function waitForMinimumResponseTime(startedAt) {
  const remaining = RESET_REQUEST_MIN_RESPONSE_MS - (Date.now() - startedAt);
  return remaining > 0
    ? new Promise((resolve) => setTimeout(resolve, remaining))
    : Promise.resolve();
}

function isRetryableTransactionError(error) {
  return error?.code === "40P01" || error?.code === "40001";
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
      `SELECT id, full_name, email, password_hash, role, token_version
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
      {
        id: admin.id,
        role: admin.role,
        token_version: Number(admin.token_version ?? 0)
      },
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

router.post("/forgot-password", forgotPasswordLimiter, accountResetLimiter, async (req, res) => {
  const startedAt = Date.now();
  let emailDelivery;

  try {
    const { email } = req.body ?? {};
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || normalizedEmail.length > 150 || !emailPattern.test(normalizedEmail)) {
      return res.status(400).json({ message: "Please enter a valid administrator email address." });
    }

    if (req.accountResetRateLimited) {
      await waitForMinimumResponseTime(startedAt);
      return res.status(200).json({ message: RESET_REQUEST_MESSAGE });
    }

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
        // All reset-token writes lock the administrator row before token rows.
        const lockedAdmin = await client.query(
          "SELECT id, email FROM admins WHERE id = $1 FOR UPDATE",
          [admin.id]
        );
        if (lockedAdmin.rows.length === 0) {
          await client.query("ROLLBACK");
          await waitForMinimumResponseTime(startedAt);
          return res.status(200).json({ message: RESET_REQUEST_MESSAGE });
        }
        await client.query(
          `UPDATE admin_password_reset_tokens
           SET used_at = CURRENT_TIMESTAMP
           WHERE admin_id = $1 AND used_at IS NULL`,
          [lockedAdmin.rows[0].id]
        );
        await client.query(
          `INSERT INTO admin_password_reset_tokens (admin_id, token_hash, expires_at)
           VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '30 minutes')`,
          [lockedAdmin.rows[0].id, tokenHash]
        );
        await client.query("COMMIT");

        const frontendUrl = (process.env.FRONTEND_URL || "").replace(/\/+$/, "");
        if (frontendUrl) {
          const resetUrl = `${frontendUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
          emailDelivery = { to: lockedAdmin.rows[0].email, resetUrl };
        }
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        throw error;
      } finally {
        client.release();
      }
    }
  } catch (error) {
    console.error("Password reset request could not be completed:", error.code || "UNKNOWN");
  }

  await waitForMinimumResponseTime(startedAt);
  const response = res.status(200).json({ message: RESET_REQUEST_MESSAGE });
  if (emailDelivery) {
    setImmediate(() => {
      Promise.resolve()
        .then(() => resendEmail.sendPasswordResetEmail(emailDelivery))
        .catch((error) => {
          console.error("Password reset email failed:", error?.name || "UNKNOWN");
        });
    });
  }
  return response;
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

      // Resolve the owner without a row lock, then acquire locks in admin-first order.
      const candidateResult = await client.query(
        `SELECT admin_id
         FROM admin_password_reset_tokens
         WHERE token_hash = $1
           AND used_at IS NULL
           AND expires_at > clock_timestamp()`,
        [tokenHash]
      );
      if (candidateResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "The password reset link is invalid or has expired." });
      }

      const adminId = candidateResult.rows[0].admin_id;
      const adminResult = await client.query(
        "SELECT id FROM admins WHERE id = $1 FOR UPDATE",
        [adminId]
      );
      if (adminResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "The password reset link is invalid or has expired." });
      }

      const tokenResult = await client.query(
        `SELECT id
         FROM admin_password_reset_tokens
         WHERE token_hash = $1
           AND admin_id = $2
           AND used_at IS NULL
           AND expires_at > clock_timestamp()
         FOR UPDATE`,
        [tokenHash, adminId]
      );
      if (tokenResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "The password reset link is invalid or has expired." });
      }

      const tokenId = tokenResult.rows[0].id;
      await client.query(
        `UPDATE admins
         SET password_hash = $1, token_version = token_version + 1
         WHERE id = $2`,
        [passwordHash, adminId]
      );
      await client.query(
        `UPDATE admin_password_reset_tokens
         SET used_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND used_at IS NULL`,
        [tokenId]
      );
      await client.query(
        `UPDATE admin_password_reset_tokens
         SET used_at = CURRENT_TIMESTAMP
         WHERE admin_id = $1 AND used_at IS NULL`,
        [adminId]
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
    if (isRetryableTransactionError(error)) {
      return res.status(503).json({
        message: "Password reset could not be completed. Please try again."
      });
    }
    return res.status(500).json({ message: "An internal server error occurred." });
  }
});

router.createAccountResetRateLimiter = createAccountResetRateLimiter;
router.createForgotPasswordIpLimiter = createForgotPasswordIpLimiter;
router.normalizeEmail = normalizeEmail;
router.accountResetLimiter = accountResetLimiter;

module.exports = router;
