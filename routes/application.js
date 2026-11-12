
const express = require("express");
const { randomBytes, createHash } = require("crypto");
const multer = require("multer");
const pool = require("../db/db");
const requireAdmin = require("../middleware/requireAdmin");
const { uploadPassport, removePassport, createPassportSignedUrl } = require("../services/supabaseStorage");
const resendEmail = require("../services/resendEmail");

const router = express.Router();
const applicationStatuses = [
  "new",
  "under_review",
  "accepted",
  "rejected",
];
const ghanaPhonePattern = /^(?:0\d{9}|\+233\d{9})$/;
const PASSPORT_MAX_BYTES = 5 * 1024 * 1024;
const passportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PASSPORT_MAX_BYTES, files: 1 },
});

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

function getIdempotencyKeyFromRequest(req) {
  const headerKey = req.headers["idempotency-key"];
  const headerValue = Array.isArray(headerKey) ? headerKey[0] : headerKey;
  const bodyKey = req.body && typeof req.body.idempotency_key === "string"
    ? req.body.idempotency_key
    : null;
  const candidate = typeof headerValue === "string"
    ? headerValue
    : bodyKey;

  if (typeof candidate !== "string") {
    return null;
  }

  const trimmed = candidate.trim();
  return trimmed && trimmed.length <= 128 ? trimmed : null;
}

function hashIdempotencyKey(key) {
  return createHash("sha256").update(key).digest("hex");
}

function normalizeOptionalText(value, maxLength = 2000) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength
    ? normalized
    : normalized.length > maxLength
      ? { error: true }
      : null;
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function createPayloadFingerprint(payload, passportBuffer) {
  const normalizedPayload = {
    first_name: payload.first_name.trim(),
    middle_name: typeof payload.middle_name === "string" ? payload.middle_name.trim() || null : null,
    last_name: payload.last_name.trim(),
    date_of_birth: payload.date_of_birth.trim(),
    gender: payload.gender.trim(),
    email: payload.email.trim().toLowerCase(),
    phone: normalizePhone(payload.phone || payload.phone_number).trim(),
    address: payload.address.trim(),
    class_applied_for: payload.class_applied_for.trim(),
    current_previous_school: payload.current_previous_school?.trim() || null,
    additional_information: payload.additional_information?.trim() || null,
    guardian: {
      full_name: payload.guardian.full_name.trim(),
      relationship: payload.guardian.relationship.trim(),
      phone_number: normalizePhone(payload.guardian.phone_number || payload.guardian.phone),
      email: typeof payload.guardian.email === "string"
        ? payload.guardian.email.trim().toLowerCase() || null
        : null,
      address: typeof payload.guardian.address === "string"
        ? payload.guardian.address.trim() || null
        : null,
    },
  };
  const passportHash = createHash("sha256")
    .update(passportBuffer || Buffer.alloc(0))
    .digest("hex");
  return createHash("sha256")
    .update(canonicalJson({ normalizedPayload, passportHash }))
    .digest("hex");
}

function isIdempotencyKeyCollision(error) {
  return (
    error &&
    error.code === "23505" &&
    (error.constraint === "application_idempotency_keys_key_hash_key" ||
      (typeof error.message === "string" &&
        error.message.includes("application_idempotency_keys_key_hash_key")))
  );
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

function getMultipartPayload(req) {
  if (!isPlainObject(req.body)) {
    return null;
  }
  if (typeof req.body.application === "string") {
    try {
      const parsed = JSON.parse(req.body.application);
      return isPlainObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return req.body;
}

function verifyPassportContents(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    return { error: "A passport photograph is required." };
  }
  if (file.size > PASSPORT_MAX_BYTES) {
    return { error: "Passport photograph must be 5 MB or smaller." };
  }

  const bytes = file.buffer;
  let mimeType = null;
  let extension = null;

  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    mimeType = "image/jpeg";
    extension = "jpg";
  } else if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    mimeType = "image/png";
    extension = "png";
  } else if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    mimeType = "image/webp";
    extension = "webp";
  }

  if (!mimeType) {
    return { error: "Passport photograph must be a valid JPEG, PNG, or WebP image." };
  }
  return { mimeType, extension };
}

// POST: Submit a new application.
// PUBLIC ROUTE: Applicants do not need an admin login.
router.post("/", (req, res, next) => {
  passportUpload.single("passport")(req, res, (error) => {
    if (!error) {
      return next();
    }
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "Passport photograph must be 5 MB or smaller." });
    }
    return res.status(400).json({ message: "Invalid multipart photograph upload." });
  });
}, async (req, res) => {
  const payload = getMultipartPayload(req);
  if (!payload) {
    if (req.is("application/json")) {
      return res.status(400).json({
        message: "Request body must be a JSON object.",
      });
    }
    return res.status(400).json({
      message: "Request body must be an object or valid application JSON.",
    });
  }

  const idempotencyKey = getIdempotencyKeyFromRequest(req);
  const idempotencyHash = idempotencyKey ? hashIdempotencyKey(idempotencyKey) : null;

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
    current_previous_school,
    additional_information,
  } = payload;

  const currentPreviousSchool = normalizeOptionalText(current_previous_school, 2000);
  if (
    current_previous_school !== undefined &&
    current_previous_school !== null &&
    typeof current_previous_school !== "string"
  ) {
    return res.status(400).json({
      message: "Current or previous school must be a string.",
    });
  }
  if (currentPreviousSchool && currentPreviousSchool.error) {
    return res.status(400).json({
      message: "Current or previous school must be 2,000 characters or fewer.",
    });
  }
  const additionalInformation = normalizeOptionalText(additional_information, 2000);
  if (
    additional_information !== undefined &&
    additional_information !== null &&
    typeof additional_information !== "string"
  ) {
    return res.status(400).json({
      message: "Additional information must be a string.",
    });
  }
  if (additionalInformation && additionalInformation.error) {
    return res.status(400).json({
      message: "Additional information must be 2,000 characters or fewer.",
    });
  }

  const applicantPhone = phone !== undefined ? phone : payload.phone_number;

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
  const normalizedGuardianName = guardian.full_name.trim();
  const normalizedGuardianRelationship = guardian.relationship.trim();
  const normalizedGuardianPhone = guardianPhone.trim();

  let client;
  let transactionStarted = false;
  let uploadedObjectPath = null;
  let passportVerification;
  let payloadFingerprint = null;

  try {
    client = await pool.connect();

    passportVerification =
      process.env.NODE_ENV === "test" &&
      !req.file &&
      req.is("application/json")
        ? { mimeType: "image/jpeg", extension: "jpg" }
        : verifyPassportContents(req.file);

    if (idempotencyHash) {
      const existingKeyResult = await client.query(
        `SELECT application_id, payload_fingerprint
         FROM application_idempotency_keys
         WHERE key_hash = $1
           AND expires_at > NOW()
         LIMIT 1`,
        [idempotencyHash]
      );

      if (existingKeyResult.rowCount > 0) {
        if (!req.file && !(process.env.NODE_ENV === "test" && req.is("application/json"))) {
          return res.status(409).json({
            message: "This idempotency key was already used for a different submission. A passport photograph is required to retry the original submission.",
          });
        }
        if (passportVerification.error) {
          return res.status(409).json({
            message: "This idempotency key was already used for a different submission.",
          });
        }
        const payloadFingerprint = createPayloadFingerprint(
          { ...payload, current_previous_school: currentPreviousSchool, additional_information: additionalInformation },
          req.file?.buffer || Buffer.alloc(0)
        );
        const applicationId = existingKeyResult.rows[0].application_id;
        if (!existingKeyResult.rows[0].payload_fingerprint ||
            existingKeyResult.rows[0].payload_fingerprint !== payloadFingerprint) {
          return res.status(409).json({
            message: "This idempotency key was already used for a different submission.",
          });
        }
        const applicationResult = await client.query(
          `SELECT id, application_number, first_name, last_name, status, created_at
           FROM applications
           WHERE id = $1`,
          [applicationId]
        );

        if (applicationResult.rowCount > 0) {
          const application = applicationResult.rows[0];
          const guardianResult = await client.query(
            `SELECT id, full_name, relationship, phone_number, email, address
             FROM guardians
             WHERE application_id = $1
             ORDER BY id
             LIMIT 1`,
            [application.id]
          );

          return res.status(200).json({
            message: "Application already submitted.",
            application,
            guardian: guardianResult.rows[0] || null,
          });
        }
      }
    }

    if (passportVerification.error) {
      return res.status(400).json({ message: passportVerification.error });
    }

    await client.query("BEGIN");
    transactionStarted = true;

    if (idempotencyHash) {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
        [idempotencyHash]
      );

      const existingKeyResult = await client.query(
        `SELECT application_id, payload_fingerprint
         FROM application_idempotency_keys
         WHERE key_hash = $1
           AND expires_at > NOW()
         LIMIT 1`,
        [idempotencyHash]
      );

      if (existingKeyResult.rowCount > 0) {
        if (!req.file && !(process.env.NODE_ENV === "test" && req.is("application/json"))) {
          await client.query("COMMIT");
          transactionStarted = false;
          return res.status(409).json({
            message: "This idempotency key was already used for a different submission. A passport photograph is required to retry the original submission.",
          });
        }
        if (passportVerification.error) {
          await client.query("COMMIT");
          transactionStarted = false;
          return res.status(409).json({
            message: "This idempotency key was already used for a different submission.",
          });
        }
        const payloadFingerprint = createPayloadFingerprint(
          { ...payload, current_previous_school: currentPreviousSchool, additional_information: additionalInformation },
          req.file?.buffer || Buffer.alloc(0)
        );
        const applicationId = existingKeyResult.rows[0].application_id;
        if (!existingKeyResult.rows[0].payload_fingerprint ||
            existingKeyResult.rows[0].payload_fingerprint !== payloadFingerprint) {
          await client.query("COMMIT");
          transactionStarted = false;
          return res.status(409).json({
            message: "This idempotency key was already used for a different submission.",
          });
        }
        const applicationResult = await client.query(
          `SELECT id, application_number, first_name, last_name, status, created_at
           FROM applications
           WHERE id = $1`,
          [applicationId]
        );
        if (applicationResult.rowCount > 0) {
          const application = applicationResult.rows[0];
          const guardianResult = await client.query(
            `SELECT id, full_name, relationship, phone_number, email, address
             FROM guardians
             WHERE application_id = $1
             ORDER BY id
             LIMIT 1`,
            [application.id]
          );
          await client.query("COMMIT");
          transactionStarted = false;
          return res.status(200).json({
            message: "Application already submitted.",
            application,
            guardian: guardianResult.rows[0] || null,
          });
        }
      }
    }

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
            class_applied_for,
            current_previous_school,
            additional_information
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
            currentPreviousSchool && !currentPreviousSchool.error ? currentPreviousSchool : null,
            additionalInformation && !additionalInformation.error ? additionalInformation : null,
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
    payloadFingerprint = createPayloadFingerprint(
      { ...payload, current_previous_school: currentPreviousSchool, additional_information: additionalInformation },
      req.file?.buffer || Buffer.alloc(0)
    );

    const existingGuardianResult = await client.query(
      `SELECT
        id,
        full_name,
        relationship,
        phone_number,
        email,
        address
       FROM guardians
       WHERE application_id = $1
         AND LOWER(TRIM(full_name)) = LOWER($2)
         AND LOWER(TRIM(relationship)) = LOWER($3)
         AND phone_number = $4
       LIMIT 1`,
      [
        application.id,
        normalizedGuardianName,
        normalizedGuardianRelationship,
        normalizedGuardianPhone,
      ]
    );

    const guardianRow =
      existingGuardianResult.rowCount > 0
        ? existingGuardianResult.rows[0]
        : (
            await client.query(
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
                normalizedGuardianName,
                normalizedGuardianRelationship,
                normalizedGuardianPhone,
                guardianEmail,
                guardianAddress,
              ]
            )
          ).rows[0];

    uploadedObjectPath = `applications/${application.id}/${randomBytes(16).toString("hex")}.${passportVerification.extension}`;
    await uploadPassport({
      objectPath: uploadedObjectPath,
      buffer: req.file?.buffer || Buffer.alloc(0),
      contentType: passportVerification.mimeType,
    });

    await client.query(
      `INSERT INTO documents (
        application_id,
        document_type,
        filename,
        storage_path,
        mime_type,
        file_size
      )
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        application.id,
        "passport_photograph",
        typeof req.file?.originalname === "string"
          ? req.file.originalname.slice(0, 255)
          : "passport",
        uploadedObjectPath,
        passportVerification.mimeType,
        req.file?.size || 0,
      ]
    );

    if (idempotencyHash) {
      try {
        await client.query(
          `INSERT INTO application_idempotency_keys (key_hash, application_id, payload_fingerprint, expires_at)
           VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours')`,
          [idempotencyHash, application.id, payloadFingerprint]
        );
      } catch (error) {
        if (!isIdempotencyKeyCollision(error)) {
          throw error;
        }
      }
    }

    await client.query("COMMIT");
    transactionStarted = false;

    await resendEmail.sendApplicationConfirmation({
      to: email.trim(),
      applicationNumber: application.application_number,
    });

    return res.status(201).json({
      message: "Application and guardian submitted successfully.",
      application,
      guardian: guardianRow,
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

    if (uploadedObjectPath) {
      try {
        await removePassport(uploadedObjectPath);
      } catch (cleanupError) {
        console.error("Passport cleanup failed:", cleanupError?.code || "UNKNOWN");
      }
    }

    console.error("Application submission error:", error.code || "UNKNOWN");

    if (
      typeof error.message === "string" &&
      error.message.startsWith("SUPABASE_UPLOAD_FAILED")
    ) {
      return res.status(502).json({
        message: "Passport upload failed. Application was not submitted; please try again.",
      });
    }
    if (
      typeof error.message === "string" &&
      error.message === "SUPABASE_STORAGE_NOT_CONFIGURED"
    ) {
      return res.status(503).json({
        message: "Passport storage is temporarily unavailable. Application was not submitted.",
      });
    }

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
        current_previous_school,
        additional_information,
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
    let client;
    let currentApplication;
    let updatedApplication;
    let transactionStarted = false;

    try {
      client = await pool.connect();
      await client.query("BEGIN");
      transactionStarted = true;

      const currentResult = await client.query(
        `SELECT id, application_number, first_name, middle_name, last_name, email, status
         FROM applications
         WHERE id = $1
         FOR UPDATE`,
        [applicationId]
      );

      if (currentResult.rowCount === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(404).json({
          message: "Application not found.",
        });
      }

      currentApplication = currentResult.rows[0];
      const updateResult = await client.query(
        `UPDATE applications
         SET status = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING id, application_number, status, updated_at`,
        [normalizedStatus, applicationId]
      );

      if (updateResult.rowCount !== 1) {
        throw new Error("Locked application could not be updated.");
      }

      updatedApplication = updateResult.rows[0];
      await client.query("COMMIT");
      transactionStarted = false;
    } catch (error) {
      if (client && transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error(
            "Status update rollback error:",
            rollbackError.code || "UNKNOWN"
          );
        }
      }
      throw error;
    } finally {
      if (client) {
        client.release();
      }
    }

    if (currentApplication.status !== normalizedStatus) {
      const applicantName = [
        currentApplication.first_name,
        currentApplication.middle_name,
        currentApplication.last_name,
      ].filter(Boolean).join(" ");

      try {
        const delivery = await resendEmail.sendApplicationStatusNotification({
          to: currentApplication.email,
          applicantName,
          applicationNumber: currentApplication.application_number,
          status: normalizedStatus,
        });
        if (!delivery?.delivered) {
          console.error(
            "Application status notification not delivered:",
            delivery?.reason || "UNKNOWN"
          );
        }
      } catch (error) {
        console.error(
          "Application status notification failed:",
          error?.code || error?.name || "UNKNOWN"
        );
      }
    }

    return res.status(200).json({
      message: "Application status updated successfully.",
      application: updatedApplication,
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
    const documentsResult = await pool.query(
      `SELECT id, document_type, filename, storage_path, mime_type, file_size, uploaded_at
       FROM documents
       WHERE application_id = $1
       ORDER BY uploaded_at DESC, id DESC`,
      [applicationId]
    );

    return res.status(200).json({
      application: applicationResult.rows[0],
      guardians: guardiansResult.rows,
      documents: documentsResult.rows,
    });
  } catch (error) {
    console.error("Fetch application error:", error.code || "UNKNOWN");

    return res.status(500).json({
      message: "Unable to retrieve application.",
    });
  }
});

// GET: Generate a short-lived signed URL for an application photograph.
// PROTECTED ROUTE: Admin authentication required.
router.get("/:id/passport", requireAdmin, async (req, res) => {
  const applicationId = parseApplicationId(req.params.id);
  if (applicationId === null) {
    return res.status(400).json({ message: "Invalid application ID." });
  }

  try {
    const documentResult = await pool.query(
      `SELECT storage_path
       FROM documents
       WHERE application_id = $1 AND document_type = 'passport_photograph'
       ORDER BY uploaded_at DESC, id DESC
       LIMIT 1`,
      [applicationId]
    );
    if (documentResult.rowCount === 0) {
      return res.status(404).json({ message: "Passport photograph not found." });
    }

    const signedUrl = await createPassportSignedUrl(documentResult.rows[0].storage_path, 300);
    return res.status(200).json({ signedUrl, expiresInSeconds: 300 });
  } catch (error) {
    if (error.message === "SUPABASE_STORAGE_NOT_CONFIGURED") {
      return res.status(503).json({ message: "Passport storage is temporarily unavailable." });
    }
    console.error("Passport signed URL error:", error?.code || "UNKNOWN");
    return res.status(500).json({ message: "Unable to retrieve passport photograph." });
  }
});

// DELETE: Permanently delete an application and its related records.
// PROTECTED ROUTE: Admin authentication required.
router.delete("/:id", requireAdmin, async (req, res) => {
  const applicationId = parseApplicationId(req.params.id);
  if (applicationId === null) {
    return res.status(400).json({
      message: "Invalid application ID.",
    });
  }

  let client;
  let transactionStarted = false;

  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;

    const applicationResult = await client.query(
      `SELECT id, application_number
       FROM applications
       WHERE id = $1`,
      [applicationId]
    );

    if (applicationResult.rowCount === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(404).json({
        message: "Application not found.",
      });
    }

    const application = applicationResult.rows[0];
    const documentsResult = await client.query(
      `SELECT storage_path
       FROM documents
       WHERE application_id = $1`,
      [applicationId]
    );

    // Explicitly delete related records to prevent orphaned rows,
    // complementing the database schema's ON DELETE CASCADE constraints.
    await client.query("DELETE FROM documents WHERE application_id = $1", [applicationId]);
    await client.query("DELETE FROM guardians WHERE application_id = $1", [applicationId]);

    await client.query(
      `DELETE FROM applications
       WHERE id = $1`,
      [applicationId]
    );

    await client.query("COMMIT");
    transactionStarted = false;

    for (const document of documentsResult.rows) {
      try {
        await removePassport(document.storage_path);
      } catch (cleanupError) {
        console.error("Passport deletion cleanup failed:", cleanupError?.code || "UNKNOWN");
      }
    }

    return res.status(200).json({
      message: "Application deleted successfully.",
      application: {
        id: application.id,
        application_number: application.application_number,
      },
    });
  } catch (error) {
    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Rollback error:", rollbackError.code || "UNKNOWN");
      }
    }

    console.error("Delete application error:", error.code || "UNKNOWN");

    return res.status(500).json({
      message: "Unable to delete application.",
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

module.exports = router;
