const express = require("express");
require("dotenv").config();
const app = express();
const pool = require("./db/db.js");
const authRoutes = require("./routes/auth.js");
const applicationRoutes = require("./routes/application.js");
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/applications",applicationRoutes);

app.get("/", (req,res) => {
    res.json({
        message:"Peniel Admission Portal API is runnig"
    });
});
app.get("/api/db-test" , async (req,res) => {
    try {
        const result = await pool.query(
            "SELECT current_database() AS database"
        );
        res.json({
            message:"Database connected successfully",
            database: result.rows[0].database,
        });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({
            message:"Database Connection Failed",
        });
    }
});

app.listen(PORT, () =>{
    console.log(`Server is running on port ${PORT}`);
});