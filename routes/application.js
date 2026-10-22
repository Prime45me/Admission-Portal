
const express = require("express");
const { randomBytes } = require("crypto");
const pool = require("../db/db");
const requireAdmin = require("../middleware/requireAdmin");

const router = express.Router();
const applicationStatuses = [
  "new",
  "under_review",
  "accepted",
  "rejected",
];
const ghanaPhonePattern = /^(?:0\d{9}|\+233\d{9})$/;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value, maxLength) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= maxLength
  );
}

function isOptionalText(value, maxLength) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim().length <= maxLength)
  );
}

function isValidDateOfBirth(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  if (year < 1) {
    return false;
  }

  const leapYear =
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) {
    return false;
  }

  const todayParts = new Intl.DateTimeFormat("en", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const todayValues = Object.fromEntries(
    todayParts.map(({ type, value }) => [type, value])
  );
  const today = `${todayValues.year}-${todayValues.month}-${todayValues.day}`;

  return value <= today;
}

function normalizePhone(value) {
  return typeof value === "string" ? value.replace(/[\s().-]/g, "") : "";
}

function isValidGhanaPhone(value) {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = normalizePhone(value.trim());
  return ghanaPhonePattern.test(normalized);
}

function isValidEmail(value) {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 150) {
    return false;
  }

  const [localPart, domain, ...extraParts] = trimmed.split("@");
  if (
    extraParts.length > 0 ||
    !localPart ||
    localPart.length > 64 ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..") ||
    !/^[^\s@]+$/.test(localPart)
  ) {
    return false;
  }

  const domainLabels = domain?.split(".") || [];
  return (
    domainLabels.length >= 2 &&
    domainLabels.every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
    ) &&
    domainLabels[domainLabels.length - 1].length >= 2
  );
}

function parsePositiveInteger(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseApplicationId(value) {
  const parsed = parsePositiveInteger(value);
  return parsed !== null && parsed <= 2147483647 ? parsed : null;
}

function isApplicationNumberCollision(error) {
  return (
    error &&
    error.code === "23505" &&
    (error.constraint === "applications_application_number_key" ||
      (typeof error.message === "string" &&
        error.message.includes("applications_application_number_key")))
  );
}

// POST: Submit a new application.
// PUBLIC ROUTE: Applicants do not need an admin login.
router.post("/", async (req, res) => {
  if (!isPlainObject(req.body)) {
    return res.status(400).json({
      message: "Request body must be a JSON object.",
    });
  }

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

  const applicantPhone = phone !== undefined ? phone : req.body.phone_number;

  // Validate required applicant fields.
  if (
    !isNonEmptyString(first_name, 100) ||
    !isNonEmptyString(last_name, 100) ||
    !isValidDateOfBirth(date_of_birth) ||
    !isNonEmptyString(gender, 20) ||
    !isNonEmptyString(email, 150) ||
    !isNonEmptyString(applicantPhone, 30) ||
    !isNonEmptyString(address, 2000) ||
    !isNonEmptyString(class_applied_for, 100) ||
    !isOptionalText(middle_name, 100)
  ) {
    return res.status(400).json({
      message:
        "Please provide valid required applicant fields, including a real non-future date of birth.",
    });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({
      message: "Please provide a valid applicant email address.",
    });
  }

  if (!isValidGhanaPhone(applicantPhone)) {
    return res.status(400).json({
      message:
        "Please provide a valid Ghanaian phone number using 0XXXXXXXXX or +233XXXXXXXXX format.",
    });
  }

  // Validate required guardian fields.
  if (!isPlainObject(guardian)) {
    return res.status(400).json({
      message: "Please provide valid guardian details.",
    });
  }

  const guardianPhone =
    guardian.phone_number !== undefined
      ? guardian.phone_number
      : guardian.phone;

  if (
    !isNonEmptyString(guardian.full_name, 150) ||
    !isNonEmptyString(guardian.relationship, 50) ||
    !isNonEmptyString(guardianPhone, 30) ||
    !isOptionalText(guardian.address, 2000)
  ) {
    return res.status(400).json({
      message:
        "Please provide valid guardian name, relationship, phone number, and address.",
    });
  }

  if (!isValidGhanaPhone(guardianPhone)) {
    return res.status(400).json({
      message:
        "Please provide a valid Ghanaian guardian phone number using 0XXXXXXXXX or +233XXXXXXXXX format.",
    });
  }

  // Guardian email is optional.
  if (
    guardian.email !== undefined &&
    guardian.email !== null &&
    !isValidEmail(guardian.email)
  ) {
    return res.status(400).json({
      message:
        "Guardian email must be a valid email address if provided.",
    });
  }

  if (
    guardian.address !== undefined &&
    guardian.address !== null &&
    (typeof guardian.address !== "string" || guardian.address.trim().length > 2000)
  ) {
    return res.status(400).json({
      message: "Guardian address must be a string if provided.",
    });
  }

  const guardianEmail =
    typeof guardian.email === "string" && guardian.email.trim()
      ? guardian.email.trim()
      : null;
  const guardianAddress =
    typeof guardian.address === "string" && guardian.address.trim()
      ? guardian.address.trim()
      : null;
  const middleName =
    typeof middle_name === "string" && middle_name.trim()
      ? middle_name.trim()
      : null;

  let client;
  let transactionStarted = false;

  try {
    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    // Savepoint allows a rare reference collision to be retried safely.
    let applicationResult;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const applicationNumber = `PEN-${new Date()
        .getFullYear()}-${randomBytes(4)
        .toString("hex")
        .toUpperCase()}`;

      await client.query("SAVEPOINT application_insert");
      try {
        applicationResult = await client.query(
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
            middleName,
            last_name.trim(),
            date_of_birth,
            gender.trim(),
            email.trim(),
            applicantPhone.trim(),
            address.trim(),
            class_applied_for.trim(),
          ]
        );
        await client.query("RELEASE SAVEPOINT application_insert");
        break;
      } catch (error) {
        if (!isApplicationNumberCollision(error) || attempt === 2) {
          throw error;
        }
        await client.query("ROLLBACK TO SAVEPOINT application_insert");
        await client.query("RELEASE SAVEPOINT application_insert");
      }
    }

    const application = applicationResult.rows[0];

    // Insert the guardian linked to the application.
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
        guardianPhone.trim(),
        guardianEmail,
        guardianAddress,
      ]
    );

    await client.query("COMMIT");
    transactionStarted = false;

    return res.status(201).json({
      message: "Application and guardian submitted successfully.",
      application,
      guardian: guardianResult.rows[0],
    });
  } catch (error) {
    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(
          "Transaction rollback error:",
          rollbackError.code || "UNKNOWN"
        );
      }
    }

    console.error("Application submission error:", error.code || "UNKNOWN");

    return res.status(500).json({
      message: isApplicationNumberCollision(error)
        ? "Unable to generate an application reference. Please try again."
        : "Unable to submit application. Please try again.",
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
    const { status, search } = req.query;
    const rawClass = req.query.class ?? req.query.class_applied_for;
    const page =
      req.query.page === undefined ? 1 : parsePositiveInteger(req.query.page);
    const requestedLimit =
      req.query.limit === undefined
        ? 10
        : parsePositiveInteger(req.query.limit);

    if (page === null || requestedLimit === null) {
      return res.status(400).json({
        message: "Page and limit must be positive integers.",
      });
    }

    if (
      (status !== undefined &&
        (typeof status !== "string" ||
          !applicationStatuses.includes(status.trim().toLowerCase()))) ||
      (rawClass !== undefined &&
        (typeof rawClass !== "string" ||
          rawClass.trim().length > 100)) ||
      (search !== undefined &&
        (typeof search !== "string" || search.trim().length > 150))
    ) {
      return res.status(400).json({
        message: "Invalid application filter.",
        allowedStatuses: applicationStatuses,
      });
    }

    const limit = Math.min(100, requestedLimit);
    const offset = (page - 1) * limit;
    if (!Number.isSafeInteger(offset)) {
      return res.status(400).json({
        message: "Page is too large.",
      });
    }

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

    if (status !== undefined) {
      values.push(status.trim().toLowerCase());
      query += ` AND LOWER(status) = $${values.length}`;
    }

    const normalizedClass = rawClass?.trim();
    if (normalizedClass) {
      values.push(`%${normalizedClass}%`);
      query += ` AND class_applied_for ILIKE $${values.length}`;
    }

    const normalizedSearch = search?.trim();
    if (normalizedSearch) {
      values.push(`%${normalizedSearch}%`);
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

    const applicationValues = [...values, limit];
    query += ` ORDER BY created_at DESC LIMIT $${applicationValues.length}`;

    applicationValues.push(offset);
    query += ` OFFSET $${applicationValues.length}`;

    const result = await pool.query(query, applicationValues);

    return res.status(200).json({
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      applications: result.rows,
    });
  } catch (error) {
    console.error("Fetch applications error:", error.code || "UNKNOWN");

    return res.status(500).json({
      message: "Unable to retrieve applications.",
    });
  }
});

// PATCH: Update an application's status.
// PROTECTED ROUTE: Admin authentication required.
router.patch("/:id/status", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const applicationId = parseApplicationId(id);
  if (applicationId === null) {
    return res.status(400).json({
      message: "Invalid application ID.",
    });
  }

  if (!isPlainObject(req.body)) {
    return res.status(400).json({
      message: "Request body must be a JSON object.",
    });
  }

  const { status } = req.body;

  if (
    typeof status !== "string" ||
    !applicationStatuses.includes(status.trim().toLowerCase())
  ) {
    return res.status(400).json({
      message: "Invalid status.",
      allowedStatuses: applicationStatuses,
    });
  }

  try {
    const normalizedStatus = status.trim().toLowerCase();

    const result = await pool.query(
      `UPDATE applications
       SET status = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, application_number, status, updated_at`,
      [normalizedStatus, applicationId]
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
    console.error("Update status error:", error.code || "UNKNOWN");

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
        COUNT(*) FILTER (WHERE LOWER(status) IN ('new', 'under_review', 'accepted', 'rejected')) AS total,
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
    console.error("Dashboard statistics error:", error.code || "UNKNOWN");

    return res.status(500).json({
      message: "Unable to retrieve dashboard statistics.",
    });
  }
});

// GET: Retrieve one application and all its guardians.
// PROTECTED ROUTE: Admin authentication required.
router.get("/:id", requireAdmin, async (req, res) => {
  const applicationId = parseApplicationId(req.params.id);
  if (applicationId === null) {
    return res.status(400).json({
      message: "Invalid application ID.",
    });
  }

  try {
    const applicationResult = await pool.query(
      `SELECT *
       FROM applications
       WHERE id = $1`,
      [applicationId]
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
      [applicationId]
    );

    return res.status(200).json({
      application: applicationResult.rows[0],
      guardians: guardiansResult.rows,
    });
  } catch (error) {
    console.error("Fetch application error:", error.code || "UNKNOWN");

    return res.status(500).json({
      message: "Unable to retrieve application.",
    });
  }
});

module.exports = router;
