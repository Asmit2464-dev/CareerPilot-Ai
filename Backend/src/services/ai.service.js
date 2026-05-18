const { GoogleGenAI } = require("@google/genai")
const { z } = require("zod")
const { zodToJsonSchema } = require("zod-to-json-schema")
const puppeteer = require("puppeteer")

let aiClient = null

function getAiClient() {
    if (!process.env.GOOGLE_GENAI_API_KEY) {
        throw new Error("GOOGLE_GENAI_API_KEY is not configured.")
    }

    if (!aiClient) {
        aiClient = new GoogleGenAI({
            apiKey: process.env.GOOGLE_GENAI_API_KEY
        })
    }

    return aiClient
}

const interviewReportSchema = z.object({
    matchScore: z.number().describe("A score between 0 and 100 indicating how well the candidate's profile matches the job description"),
    technicalQuestions: z.array(z.object({
        question: z.string().describe("The technical question that can be asked in the interview"),
        intention: z.string().describe("The interviewer's intention behind asking this question"),
        answer: z.string().describe("How to answer this question and what points to cover")
    })).describe("Technical interview questions tailored to the job"),
    behavioralQuestions: z.array(z.object({
        question: z.string().describe("The behavioral question that can be asked in the interview"),
        intention: z.string().describe("The interviewer's intention behind asking this question"),
        answer: z.string().describe("How to answer this question and what points to cover")
    })).describe("Behavioral interview questions tailored to the job"),
    skillGaps: z.array(z.object({
        skill: z.string().describe("The skill which the candidate is missing or weak in"),
        severity: z.enum([ "low", "medium", "high" ]).describe("The severity of this skill gap")
    })).describe("Missing or weak skills compared with the job description"),
    preparationPlan: z.array(z.object({
        day: z.number().describe("The day number in the preparation plan, starting from 1"),
        focus: z.string().describe("The main focus of this day in the preparation plan"),
        tasks: z.array(z.string()).describe("Tasks to complete on this day")
    })).describe("A day-wise interview preparation plan"),
    title: z.string().describe("The title of the job for which the interview report is generated")
})

const resumePdfSchema = z.object({
    html: z.string().describe("Complete, valid resume HTML that can be converted to PDF")
})

const COMMON_STOP_WORDS = new Set([
    "the", "and", "for", "with", "that", "this", "from", "will", "have", "has", "are", "you", "your",
    "job", "role", "skills", "experience", "including", "working", "work", "years", "candidate",
    "requirements", "responsibilities", "team", "ability"
])

const COMMON_TECH_SKILLS = [
    "javascript", "typescript", "react", "vue", "angular", "node", "express", "python", "django", "flask",
    "java", "spring", "c#", "dotnet", "php", "laravel", "ruby", "rails", "sql", "postgresql", "mysql",
    "mongodb", "graphql", "rest", "api", "aws", "azure", "gcp", "docker", "kubernetes", "microservices",
    "cloud", "devops", "ci/cd", "testing", "automation", "security", "machine learning", "data science",
    "analytics", "ui/ux", "mobile", "android", "ios", "swift", "kotlin", "agile", "scrum"
]

const HTML_ESCAPE_LOOKUP = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => HTML_ESCAPE_LOOKUP[char])
}

function normalizeText(text) {
    return String(text || "").toLowerCase().replace(/\r?\n/g, " ").replace(/[^a-z0-9+#/ ]+/g, " ").replace(/\s+/g, " ").trim()
}

function compactText(text) {
    return String(text || "").replace(/\s+/g, " ").trim()
}

function inferJobTitle(jobDescription) {
    const text = String(jobDescription || "")
    const titleMatch = text.match(/(?:position|title|role|hiring for|we are looking for)[:\-]?\s*([^\n.]+)/i)
    if (titleMatch?.[1]) return compactText(titleMatch[1]).slice(0, 80)

    const firstLine = text.split(/\r?\n/).map(compactText).find(Boolean)
    if (firstLine && firstLine.length <= 80) return firstLine

    return "Target Role"
}

function extractRequiredSkills(jobDescription) {
    const lower = normalizeText(jobDescription)
    return [ ...new Set(COMMON_TECH_SKILLS.filter(skill => lower.includes(skill))) ].slice(0, 10)
}

function computeMatchScore(jobDescription, resume, selfDescription) {
    const requiredSkills = extractRequiredSkills(jobDescription)
    const candidateText = normalizeText(`${resume || ""} ${selfDescription || ""}`)

    if (!requiredSkills.length) return 55

    const matched = requiredSkills.filter(skill => candidateText.includes(skill)).length
    return Math.min(100, Math.max(25, Math.round((matched / requiredSkills.length) * 100)))
}

function buildTechnicalQuestions(requiredSkills, title) {
    const skills = requiredSkills.length ? requiredSkills.slice(0, 6) : [ "the main technology stack", "problem solving", "system design" ]

    return skills.map(skill => ({
        question: `How would you apply ${skill} to solve a practical problem in the ${title} role?`,
        intention: `Check whether the candidate can connect ${skill} to real responsibilities in this job.`,
        answer: `Explain a relevant project or approach, describe the technical decisions you made, and connect the outcome to reliability, performance, maintainability, or user impact.`
    }))
}

function buildBehavioralQuestions(title) {
    return [
        {
            question: `Tell me about a time you delivered work under pressure in a ${title} context.`,
            intention: "Assess ownership, prioritization, and communication under constraints.",
            answer: "Use STAR: describe the situation, task, actions you took, and the measurable or practical result."
        },
        {
            question: "Describe a time you worked with teammates or stakeholders who had different priorities.",
            intention: "Evaluate collaboration, conflict resolution, and stakeholder management.",
            answer: "Explain how you clarified goals, aligned expectations, handled disagreement, and moved the work forward."
        },
        {
            question: "What is one technical decision you made that improved a project?",
            intention: "Understand decision-making, trade-offs, and impact.",
            answer: "Name the problem, compare options, explain why you chose your solution, and describe the result."
        },
        {
            question: `How do you learn a tool or skill quickly when it is required for a ${title} role?`,
            intention: "Gauge learning agility and adaptability.",
            answer: "Share your learning process, practice method, and how you apply new knowledge in real work."
        }
    ]
}

function buildSkillGaps(requiredSkills, resume, selfDescription) {
    const candidateText = normalizeText(`${resume || ""} ${selfDescription || ""}`)
    const gaps = requiredSkills
        .filter(skill => !candidateText.includes(skill))
        .map((skill, index) => ({
            skill,
            severity: index < 2 ? "high" : "medium"
        }))

    if (gaps.length) return gaps.slice(0, 5)

    return [
        { skill: "Role-specific examples", severity: "medium" },
        { skill: "Interview storytelling", severity: "low" }
    ]
}

function buildPreparationPlan(title, requiredSkills) {
    const primarySkill = requiredSkills[0] || "the most important role skill"

    return [
        {
            day: 1,
            focus: `Map your background to the ${title} requirements`,
            tasks: [
                "Highlight the top responsibilities from the job description.",
                "Match each responsibility to a resume or self-description example.",
                "Prepare a short pitch for why your background fits this role."
            ]
        },
        {
            day: 2,
            focus: `Review ${primarySkill} fundamentals`,
            tasks: [
                `Practice explaining how you have used or would use ${primarySkill}.`,
                "Review common interview questions around the main tools in the job description.",
                "Write two concise project examples that show practical skill."
            ]
        },
        {
            day: 3,
            focus: "Practice technical problem solving",
            tasks: [
                "Solve one role-relevant coding, design, or workflow problem.",
                "Explain your approach out loud with trade-offs.",
                "Review edge cases, testing, and performance considerations."
            ]
        },
        {
            day: 4,
            focus: "Build behavioral STAR stories",
            tasks: [
                "Prepare stories for ownership, teamwork, conflict, and learning.",
                "Tie each story to a requirement in the job description.",
                "Keep each answer under two minutes."
            ]
        },
        {
            day: 5,
            focus: "Close skill gaps",
            tasks: [
                "Study the highest-priority missing skill from the gap list.",
                "Complete a small hands-on exercise or project note for that skill.",
                "Prepare an honest answer for how you are improving it."
            ]
        },
        {
            day: 6,
            focus: "Mock interview practice",
            tasks: [
                "Answer three technical questions and two behavioral questions out loud.",
                "Record or time your answers.",
                "Refine unclear examples and remove filler."
            ]
        },
        {
            day: 7,
            focus: "Final interview review",
            tasks: [
                "Review your resume, target role, key projects, and gap plan.",
                "Prepare thoughtful questions for the interviewer.",
                "Practice a confident opening and closing statement."
            ]
        }
    ]
}

function buildFallbackInterviewReport(jobDescription, resume, selfDescription) {
    const title = inferJobTitle(jobDescription)
    const requiredSkills = extractRequiredSkills(jobDescription)

    return {
        title,
        matchScore: computeMatchScore(jobDescription, resume, selfDescription),
        technicalQuestions: buildTechnicalQuestions(requiredSkills, title),
        behavioralQuestions: buildBehavioralQuestions(title),
        skillGaps: buildSkillGaps(requiredSkills, resume, selfDescription),
        preparationPlan: buildPreparationPlan(title, requiredSkills)
    }
}

function normalizeQuestion(question, fallbackQuestion) {
    return {
        question: compactText(question?.question) || fallbackQuestion.question,
        intention: compactText(question?.intention) || fallbackQuestion.intention,
        answer: compactText(question?.answer) || fallbackQuestion.answer
    }
}

function normalizeSkillGap(gap, fallbackGap) {
    const severity = [ "low", "medium", "high" ].includes(gap?.severity) ? gap.severity : fallbackGap.severity

    return {
        skill: compactText(gap?.skill) || fallbackGap.skill,
        severity
    }
}

function normalizePreparationDay(day, fallbackDay) {
    const tasks = Array.isArray(day?.tasks)
        ? day.tasks.map(compactText).filter(Boolean)
        : []

    return {
        day: Number(day?.day) || fallbackDay.day,
        focus: compactText(day?.focus) || fallbackDay.focus,
        tasks: tasks.length ? tasks : fallbackDay.tasks
    }
}

function normalizeInterviewReport(candidateReport, fallbackReport) {
    const technicalQuestions = Array.isArray(candidateReport?.technicalQuestions)
        ? candidateReport.technicalQuestions
        : []
    const behavioralQuestions = Array.isArray(candidateReport?.behavioralQuestions)
        ? candidateReport.behavioralQuestions
        : []
    const skillGaps = Array.isArray(candidateReport?.skillGaps)
        ? candidateReport.skillGaps
        : []
    const preparationPlan = Array.isArray(candidateReport?.preparationPlan)
        ? candidateReport.preparationPlan
        : []

    const normalized = {
        title: compactText(candidateReport?.title) || fallbackReport.title,
        matchScore: Number.isFinite(Number(candidateReport?.matchScore))
            ? Math.min(100, Math.max(0, Math.round(Number(candidateReport.matchScore))))
            : fallbackReport.matchScore,
        technicalQuestions: fallbackReport.technicalQuestions.map((fallbackQuestion, index) =>
            normalizeQuestion(technicalQuestions[index], fallbackQuestion)
        ),
        behavioralQuestions: fallbackReport.behavioralQuestions.map((fallbackQuestion, index) =>
            normalizeQuestion(behavioralQuestions[index], fallbackQuestion)
        ),
        skillGaps: fallbackReport.skillGaps.map((fallbackGap, index) =>
            normalizeSkillGap(skillGaps[index], fallbackGap)
        ),
        preparationPlan: fallbackReport.preparationPlan.map((fallbackDay, index) =>
            normalizePreparationDay(preparationPlan[index], fallbackDay)
        )
    }

    return normalized
}

async function generateInterviewReport({ resume, selfDescription, jobDescription }) {
    const fallbackReport = buildFallbackInterviewReport(jobDescription, resume, selfDescription)
    const prompt = `You are an expert interview coach and ATS analyst. Generate an interview strategy report using only the supplied candidate details and target job description.

Candidate resume text:
${resume || "Not provided"}

Candidate self description:
${selfDescription || "Not provided"}

Target job description:
${jobDescription}

Return valid JSON only. Make every question, skill gap, score, and preparation task specific to this candidate and this job.`

    try {
        const response = await getAiClient().models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: zodToJsonSchema(interviewReportSchema)
            }
        })

        return normalizeInterviewReport(JSON.parse(response.text), fallbackReport)
    } catch (err) {
        console.error("AI interview report generation failed. Using fallback strategy:", err.message)
        return fallbackReport
    }
}

async function generatePdfFromHtml(htmlContent) {
    let browser

    try {
   browser = await puppeteer.launch({
    headless: "new",
    executablePath: puppeteer.executablePath(),
    args: [
        "--no-sandbox",
        "--disable-setuid-sandbox"
    ]
})
        const page = await browser.newPage()
        await page.setContent(htmlContent, { waitUntil: "networkidle0", timeout: 30000 })

        return await page.pdf({
            format: "A4",
            printBackground: true,
            margin: {
                top: "14mm",
                bottom: "14mm",
                left: "13mm",
                right: "13mm"
            }
        })
    } finally {
        if (browser) await browser.close()
    }
}

function buildFallbackResumeHtml({ resume, selfDescription, jobDescription }) {
    const title = inferJobTitle(jobDescription)
    const requiredSkills = extractRequiredSkills(jobDescription)
    const summary = compactText(selfDescription) || `Candidate targeting ${title} opportunities with a focus on practical execution, communication, and continuous learning.`
    const resumeLines = String(resume || "")
        .split(/\r?\n/)
        .map(compactText)
        .filter(line => line.length > 12)
        .slice(0, 8)

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; color: #1f2937; line-height: 1.45; margin: 0; }
        h1 { margin: 0 0 6px; font-size: 28px; color: #111827; }
        h2 { margin: 20px 0 8px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; }
        p { margin: 0 0 8px; }
        ul { margin-top: 6px; }
        li { margin-bottom: 4px; }
        .headline { color: #475569; font-weight: 700; }
        .skills span { display: inline-block; border: 1px solid #cbd5e1; padding: 4px 7px; margin: 0 5px 5px 0; border-radius: 4px; background: #f8fafc; }
    </style>
</head>
<body>
    <h1>ATS Optimized Resume</h1>
    <p class="headline">${escapeHtml(title)}</p>
    <h2>Professional Summary</h2>
    <p>${escapeHtml(summary)}</p>
    <h2>Core Skills</h2>
    <div class="skills">${(requiredSkills.length ? requiredSkills : [ "Problem solving", "Communication", "Collaboration" ]).map(skill => `<span>${escapeHtml(skill)}</span>`).join("")}</div>
    <h2>Relevant Experience</h2>
    <ul>${(resumeLines.length ? resumeLines : [ "Connects candidate background to the target role requirements.", "Prepared to discuss practical examples, learning ability, and ownership." ]).map(line => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
</body>
</html>`
}

async function generateResumePdf({ resume, selfDescription, jobDescription }) {
    const prompt = `Generate a professional, ATS-friendly resume HTML for this candidate.

Resume:
${resume || "Not provided"}

Self Description:
${selfDescription || "Not provided"}

Job Description:
${jobDescription}

Return JSON only with a single "html" field. Keep it 1-2 pages, professional, and truthful to the source material.`

    try {
        const response = await getAiClient().models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: zodToJsonSchema(resumePdfSchema)
            }
        })

        const jsonContent = JSON.parse(response.text)
        return await generatePdfFromHtml(jsonContent.html)
    } catch (err) {
        console.error("AI resume generation failed. Using fallback resume PDF:", err.message)
        return await generatePdfFromHtml(buildFallbackResumeHtml({ resume, selfDescription, jobDescription }))
    }
}

module.exports = { generateInterviewReport, generateResumePdf, generatePdfFromHtml }
