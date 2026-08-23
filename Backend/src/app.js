const express = require("express")
const cookieParser = require("cookie-parser")
const cors = require("cors")

const app = express()
const allowedOrigins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://career-pilot-ai-sigma.vercel.app",
    process.env.CLIENT_URL,
    process.env.FRONTEND_URL
].filter(Boolean)

app.use(express.json())
app.use(cookieParser())
app.use(cors({
    origin: allowedOrigins,
    credentials: true,
    exposedHeaders: [ "Content-Disposition", "Content-Type" ]
}))

/* require all the routes here */
const authRouter = require("./routes/auth.routes")
const interviewRouter = require("./routes/interview.routes")


/* using all the routes here */
app.use("/api/auth", authRouter)
app.use("/api/interview", interviewRouter)



module.exports = app
