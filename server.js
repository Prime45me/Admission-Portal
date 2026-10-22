const express = require("express");
require("dotenv").config();
const cors = require("cors");
const helmet = require("helmet");
const app = express();
const pool = require("./db/db.js");
const authRoutes = require("./routes/auth.js");
const applicationRoutes = require("./routes/application.js");
const PORT = process.env.PORT || 5000;
const allowedOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(helmet());
app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(null, false);
    }
}));
app.use(express.json({ limit: "64kb" }));
app.use("/api/auth", authRoutes);
app.use("/api/applications",applicationRoutes);

app.get("/", (req, res) => {
    res.json({
        message: "Peniel Admission Portal API is running"
    });
});
app.get("/api/db-test", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT current_database() AS database"
        );
        res.json({
            message: "Database connected successfully",
            database: result.rows[0].database,
        });
    } catch (error) {
        console.error("Database connection check failed:", error.code || "UNKNOWN");
        res.status(500).json({
            message: "Database Connection Failed",
        });
    }
});

app.use((req, res) => {
    res.status(404).json({
        message: "Route not found."
    });
});

app.use((error, req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }

    if (error.type === "entity.too.large") {
        return res.status(413).json({
            message: "Request body is too large."
        });
    }

    if (error.type === "entity.parse.failed") {
        return res.status(400).json({
            message: "Request body must contain valid JSON."
        });
    }

    console.error("Unhandled request error:", error.code || "UNKNOWN");
    return res.status(500).json({
        message: "An internal server error occurred."
    });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

module.exports = app;