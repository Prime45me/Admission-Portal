
const express = require("express");
const { randomBytes } = require("crypto");
const pool = require("../db/db");

const router = express.Router();

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
  } = req.body;

  // 1. Validate required fields
  if (
    !first_name ||
    !last_name ||
    !date_of_birth ||
    !gender ||
    !email ||
    !phone ||
    !address ||
    !class_applied_for
  ) {
    return res.status(400).json({
      message: "Please provide all required fields.",
    });
  }

  try {
    // 2. Generate a public application reference
    const application_number =
      `PEN-${new Date().getFullYear()}-${randomBytes(4).toString("hex").toUpperCase()}`;

    // 3. Save the application in PostgreSQL
    const result = await pool.query(
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
        application_number,
        first_name.trim(),
        middle_name?.trim() || null,
        last_name.trim(),
        date_of_birth,
        gender,
        email.trim(),
        phone.trim(),
        address.trim(),
        class_applied_for.trim(),
      ]
    );

    // 4. Return the saved application
    return res.status(201).json({
      message: "Application submitted successfully.",
      application: result.rows[0],
    });
  } catch (error) {
    console.error("Application submission error:", error.message);

    return res.status(500).json({
      message: "Unable to submit application. Please try again.",
    });
  }
});



router.get("/", async (req, res) => {
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
      values.push(status.toUpperCase());
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

    // Count all records matching the filters
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM (${query}) AS filtered_applications`,
      values
    );

    const total = Number(countResult.rows[0].count);

    // Add pagination
    values.push(limit);
    query += ` ORDER BY created_at DESC LIMIT $${values.length}`;

    values.push(offset);
    query += ` OFFSET $${values.length}`;

    const result = await pool.query(query, values);

    res.status(200).json({
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      applications: result.rows,
    });
  } catch (error) {
    console.error("Fetch applications error:", error.message);

    res.status(500).json({
      message: "Unable to retrieve applications.",
    });
  }
});


router.patch("/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const allowedStatuses = [
    "NEW",
    "UNDER_REVIEW",
    "ACCEPTED",
    "REJECTED",
  ];

  if (!Number.isInteger(Number(id)) || Number(id) < 1) {
    return res.status(400).json({
      message: "Invalid application ID.",
    });
  }

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      message: "Invalid status.",
      allowedStatuses,
    });
  }

  try {
    const result = await pool.query(
      `UPDATE applications
       SET status = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, application_number, status, updated_at`,
      [status, Number(id)]
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


router.get("/:id", async (req, res) => {
  const { id } = req.params;

  if (!Number.isInteger(Number(id)) || Number(id) < 1) {
    return res.status(400).json({
      message: "Invalid application ID.",
    });
  }

  try {
    const result = await pool.query(
      `SELECT *
       FROM applications
       WHERE id = $1`,
      [Number(id)]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: "Application not found.",
      });
    }

    return res.status(200).json({
      application: result.rows[0],
    });
  } catch (error) {
    console.error("Fetch application error:", error.message);

    return res.status(500).json({
      message: "Unable to retrieve application.",
    });
  }
});

module.exports = router;
