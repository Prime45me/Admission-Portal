
const express = require("express");
const { randomBytes } = require("crypto");
const pool = require("../db/db");
const requireAdmin = require("../middleware/requireAdmin");

const router = express.Router();

// POST: Submit a new application.
// PUBLIC ROUTE: Applicants do not need an admin login.
router.post("/", async (req, res) => {
  const {
    first_name,
    middle_name,
    last_name,
    date_of_birth,
    gender,
    email,
    phone,
    address,
    class_applied_for,
    guardian,
  } = req.body;

  if (
    !first_name?.trim() ||
    !last_name?.trim() ||
    !date_of_birth ||
    !gender ||
    !email?.trim() ||
    !phone?.trim() ||
    !address?.trim() ||
    !class_applied_for?.trim()
  ) {
    return res.status(400).json({
      message: "Please provide all required applicant fields.",
    });
  }

  if (
    !guardian?.full_name?.trim() ||
    !guardian?.relationship?.trim() ||
    !guardian?.phone_number?.trim()
  ) {
    return res.status(400).json({
      message:
        "Guardian name, relationship, and phone number are required.",
    });
  }

  // Email is optional, but if supplied, it must be a non-empty string.
  if (
    guardian.email !== undefined &&
    guardian.email !== null &&
    (typeof guardian.email !== "string" ||
      !guardian.email.trim())
  ) {
    return res.status(400).json({
      message: "Guardian email must be a valid non-empty string if provided.",
    });
  }

  const guardianEmail = guardian.email?.trim() || null;

  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const applicationNumber =
      `PEN-${new Date().getFullYear()}-${randomBytes(4)
        .toString("hex")
        .toUpperCase()}`;

    const applicationResult = await client.query(
      `INSERT INTO applications (
        application_number,
        first_name,
        middle_name,
        last_name,
        date_of_birth,
        gender,
        email,
        phone_number,
        address,
        class_applied_for
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, application_number, first_name, last_name, status, created_at`,
      [
        applicationNumber,
        first_name.trim(),
        middle_name?.trim() || null,
        last_name.trim(),
        date_of_birth,
        gender.trim(),
        email.trim(),
        phone.trim(),
        address.trim(),
        class_applied_for.trim(),
      ]
    );

    const application = applicationResult.rows[0];

    const guardianResult = await client.query(
      `INSERT INTO guardians (
        application_id,
        full_name,
        relationship,
        phone_number,
        email,
        address
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, full_name, relationship, phone_number, email, address`,
      [
        application.id,
        guardian.full_name.trim(),
        guardian.relationship.trim(),
        guardian.phone_number.trim(),
        guardianEmail,
        guardian.address?.trim() || null,
      ]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Application and guardian submitted successfully.",
      application,
      guardian: guardianResult.rows[0],
    });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(
          "Transaction rollback error:",
          rollbackError.message
        );
      }
    }

    console.error("Application submission error:", error.message);

    return res.status(500).json({
      message: "Unable to submit application. Please try again.",
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// GET: Retrieve applications with filtering and pagination.
// PROTECTED ROUTE: Admin authentication required.
router.get("/", requireAdmin, async (req, res) => {
  try {
    const { status, class: classAppliedFor, search } = req.query;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 10)
    );
    const offset = (page - 1) * limit;

    let query = `
      SELECT
        id,
        application_number,
        first_name,
        middle_name,
        last_name,
        email,
        phone_number,
        class_applied_for,
        status,
        created_at
      FROM applications
      WHERE 1=1
    `;

    const values = [];

    if (status) {
      values.push(status.toLowerCase());
      query += ` AND status = $${values.length}`;
    }

    if (classAppliedFor) {
      values.push(classAppliedFor);
      query += ` AND class_applied_for ILIKE $${values.length}`;
    }

    if (search) {
      values.push(`%${search}%`);
      query += ` AND (
        first_name ILIKE $${values.length}
        OR last_name ILIKE $${values.length}
        OR email ILIKE $${values.length}
        OR application_number ILIKE $${values.length}
      )`;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM (${query}) AS filtered_applications`,
      values
    );

    const total = Number(countResult.rows[0].count);

    values.push(limit);
    query += ` ORDER BY created_at DESC LIMIT $${values.length}`;

    values.push(offset);
    query += ` OFFSET $${values.length}`;

    const result = await pool.query(query, values);

    return res.status(200).json({
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      applications: result.rows,
    });
  } catch (error) {
    console.error("Fetch applications error:", error.message);

    return res.status(500).json({
      message: "Unable to retrieve applications.",
    });
  }
});

// PATCH: Update an application's status.
// PROTECTED ROUTE: Admin authentication required.
router.patch("/:id/status", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const allowedStatuses = [
    "NEW",
    "UNDER_REVIEW",
    "ACCEPTED",
    "REJECTED",
  ];

  if (!/^[1-9]\d*$/.test(id)) {
    return res.status(400).json({
      message: "Invalid application ID.",
    });
  }

  if (
    typeof status !== "string" ||
    !allowedStatuses.includes(status.toUpperCase())
  ) {
    return res.status(400).json({
      message: "Invalid status.",
      allowedStatuses,
    });
  }

  try {
    const normalizedStatus = status.toUpperCase();

    const result = await pool.query(
      `UPDATE applications
       SET status = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, application_number, status, updated_at`,
      [normalizedStatus.toLowerCase(), Number(id)]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: "Application not found.",
      });
    }

    return res.status(200).json({
      message: "Application status updated successfully.",
      application: result.rows[0],
    });
  } catch (error) {
    console.error("Update status error:", error.message);

    return res.status(500).json({
      message: "Unable to update application status.",
    });
  }
});

// GET: Dashboard application statistics.
// PROTECTED ROUTE: Admin authentication required.
router.get("/stats", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE LOWER(status) = 'new') AS new,
        COUNT(*) FILTER (WHERE LOWER(status) = 'under_review') AS under_review,
        COUNT(*) FILTER (WHERE LOWER(status) = 'accepted') AS accepted,
        COUNT(*) FILTER (WHERE LOWER(status) = 'rejected') AS rejected
      FROM applications
    `);

    const row = result.rows[0];

    return res.status(200).json({
      total: Number(row.total),
      new: Number(row.new),
      under_review: Number(row.under_review),
      accepted: Number(row.accepted),
      rejected: Number(row.rejected),
    });
  } catch (error) {
    console.error("Dashboard statistics error:", error.message);

    return res.status(500).json({
      message: "Unable to retrieve dashboard statistics.",
    });
  }
});

// GET: Retrieve one application and all its guardians.
// PROTECTED ROUTE: Admin authentication required.
router.get("/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;

  if (!/^[1-9]\d*$/.test(id)) {
    return res.status(400).json({
      message: "Invalid application ID.",
    });
  }

  try {
    const applicationResult = await pool.query(
      `SELECT *
       FROM applications
       WHERE id = $1`,
      [Number(id)]
    );

    if (applicationResult.rowCount === 0) {
      return res.status(404).json({
        message: "Application not found.",
      });
    }

    const guardiansResult = await pool.query(
      `SELECT
        id,
        full_name,
        relationship,
        phone_number,
        email,
        address,
        created_at
       FROM guardians
       WHERE application_id = $1
       ORDER BY id`,
      [Number(id)]
    );

    return res.status(200).json({
      application: applicationResult.rows[0],
      guardians: guardiansResult.rows,
    });
  } catch (error) {
    console.error("Fetch application error:", error.message);

    return res.status(500).json({
      message: "Unable to retrieve application.",
    });
  }
});



module.exports = router;
