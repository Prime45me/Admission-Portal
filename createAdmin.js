
require("dotenv").config();

const bcrypt = require("bcrypt");
const pool = require("./db/db");

async function createAdmin() {
  try {
    const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;

    if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
      throw new Error("Missing admin credentials in .env");
    }

    const existingAdmin = await pool.query(
      "SELECT id FROM admins WHERE email = $1",
      [ADMIN_EMAIL]
    );

    if (existingAdmin.rows.length > 0) {
      console.log("An admin with this email already exists.");
      return;
    }

    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

    await pool.query(
      `INSERT INTO admins (full_name, email, password_hash)
       VALUES ($1, $2, $3)`,
      [ADMIN_NAME, ADMIN_EMAIL, passwordHash]
    );

    console.log("Admin account created successfully.");
  } catch (error) {
    console.error("Admin creation failed:", error.message);
  } finally {
    await pool.end();
  }
}

createAdmin();
