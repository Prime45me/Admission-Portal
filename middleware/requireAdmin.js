const jwt = require("jsonwebtoken");
const pool = require("../db/db");

async function requireAdmin(req, res, next) {
    const authHeader = req.headers.authorization;

    if (typeof process.env.JWT_SECRET !== "string" || !process.env.JWT_SECRET) {
        return res.status(500).json({
            message: "Authentication is not configured."
        });
    }

    const tokenMatch =
        typeof authHeader === "string"
            ? /^Bearer\s+(\S+)$/i.exec(authHeader)
            : null;

    if (!tokenMatch) {
        return res.status(401).json({
            message: "Authentication required"
        });
    }

    let decoded;
    try {
        decoded = jwt.verify(tokenMatch[1], process.env.JWT_SECRET);
    } catch (error) {
        return res.status(401).json({
            message: "Invalid or expired token"
        });
    }

    try {
        if (!decoded || typeof decoded !== "object") {
            return res.status(401).json({
                message: "Invalid or expired token"
            });
        }

        if (decoded.role !== "admin") {
            return res.status(403).json({
                message: "Admin access required"
            });
        }

        const adminId = Number(decoded.id);
        if (!Number.isSafeInteger(adminId) || adminId < 1) {
            return res.status(401).json({
                message: "Invalid or expired token"
            });
        }

        const tokenVersion =
            decoded.token_version === undefined ? 0 : decoded.token_version;
        if (!Number.isSafeInteger(tokenVersion) || tokenVersion < 0) {
            return res.status(401).json({
                message: "Invalid or expired token"
            });
        }

        const result = await pool.query(
            "SELECT token_version FROM admins WHERE id = $1",
            [adminId]
        );
        const currentTokenVersion = result.rows[0]?.token_version;
        if (
            !Number.isSafeInteger(currentTokenVersion) ||
            currentTokenVersion < 0 ||
            currentTokenVersion !== tokenVersion
        ) {
            return res.status(401).json({
                message: "Invalid or expired token"
            });
        }

        req.admin = {
            id: adminId,
            role: decoded.role,
            token_version: tokenVersion
        };

        return next();
    } catch (error) {
        console.error("Admin token verification failed:", error.code || "UNKNOWN");
        return res.status(500).json({
            message: "Authentication could not be verified."
        });
    }
}

module.exports = requireAdmin;