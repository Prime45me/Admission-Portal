const jwt = require("jsonwebtoken");

function requireAdmin(req, res, next) {
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

    try {
        const decoded = jwt.verify(
            tokenMatch[1],
            process.env.JWT_SECRET
        );

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

        req.admin = {
            id: adminId,
            role: decoded.role
        };

        return next();
    } catch (error) {
        return res.status(401).json({
            message: "Invalid or expired token"
        });
    }
}

module.exports = requireAdmin;