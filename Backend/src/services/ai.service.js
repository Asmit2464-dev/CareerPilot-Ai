const { GoogleGenAI } = require("@google/genai")
const { z } = require("zod")
const { zodToJsonSchema } = require("zod-to-json-schema")
const chromium = require("@sparticuz/chromium")
const puppeteer = require("puppeteer-core")

let aiClient = null

const TARGET_TECHNICAL_QUESTION_COUNT = 15
const TARGET_BEHAVIORAL_QUESTION_COUNT = 15
const TARGET_SKILL_GAP_COUNT = 15
const TARGET_PREPARATION_DAYS = 15

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
        severity: z.enum([ "low", "medium", "high" ]).describe("The severity of this skill gap"),
        evidence: z.string().describe("Specific evidence from the resume/self-description/job description explaining why this gap exists"),
        recommendation: z.string().describe("A concise action the candidate should take to close this gap"),
        resumeKeyword: z.string().describe("The exact resume keyword or phrase connected to this gap")
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
    "javascript", "typescript", "react", "next.js", "vue", "angular", "html", "css", "sass", "tailwind",
    "redux", "node", "express", "nestjs", "python", "django", "flask", "fastapi", "java", "spring",
    "c#", "dotnet", "php", "laravel", "ruby", "rails", "go", "rust", "sql", "postgresql", "mysql",
    "mongodb", "mongoose", "redis", "elasticsearch", "graphql", "rest", "api", "jwt", "oauth",
    "aws", "azure", "gcp", "firebase", "supabase", "docker", "kubernetes", "microservices", "cloud",
    "devops", "ci/cd", "git", "github", "linux", "testing", "unit testing", "automation", "security",
    "machine learning", "data science", "analytics", "power bi", "tableau", "ui/ux", "mobile",
    "android", "ios", "swift", "kotlin", "agile", "scrum"
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

function decodeHtmlEntities(value) {
    return String(value || "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

function htmlToPlainText(htmlContent) {
    return decodeHtmlEntities(String(htmlContent || "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<\/(h1|h2|h3|p|li|tr|div|section)>/gi, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<li[^>]*>/gi, "- ")
        .replace(/<td[^>]*>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s+/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim())
}

function escapePdfText(value) {
    return String(value || "")
        .normalize("NFKD")
        .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
        .replace(/\\/g, "\\\\")
        .replace(/\(/g, "\\(")
        .replace(/\)/g, "\\)")
}

function wrapPdfLine(line, maxChars = 96) {
    const words = compactText(line).split(" ").filter(Boolean)
    const lines = []
    let currentLine = ""

    words.forEach(word => {
        if ((currentLine + " " + word).trim().length > maxChars) {
            if (currentLine) lines.push(currentLine)
            currentLine = word
        } else {
            currentLine = (currentLine + " " + word).trim()
        }
    })

    if (currentLine) lines.push(currentLine)
    return lines.length ? lines : [ "" ]
}

function buildSimplePdfFromText(text, title = "CareerPilot Resume") {
    const sourceLines = String(text || title)
        .split(/\r?\n/)
        .flatMap(line => line.trim() ? wrapPdfLine(line) : [ "" ])
    const linesPerPage = 52
    const pages = []

    for (let index = 0; index < sourceLines.length; index += linesPerPage) {
        pages.push(sourceLines.slice(index, index + linesPerPage))
    }

    if (!pages.length) pages.push([ title ])

    const objects = []
    const catalogId = 1
    const pagesId = 2
    const fontId = 3
    const pageIds = []

    objects[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`
    objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"

    pages.forEach((pageLines, index) => {
        const contentId = 4 + index * 2
        const pageId = 5 + index * 2
        const content = [
            "BT",
            "/F1 10 Tf",
            "14 TL",
            "48 800 Td",
            ...pageLines.map(line => `(${escapePdfText(line)}) Tj T*`),
            "ET"
        ].join("\n")

        objects[contentId] = `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`
        objects[pageId] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`
        pageIds.push(pageId)
    })

    objects[pagesId] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`

    let pdf = "%PDF-1.4\n"
    const offsets = [ 0 ]

    for (let id = 1; id < objects.length; id += 1) {
        offsets[id] = Buffer.byteLength(pdf, "latin1")
        pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`
    }

    const xrefOffset = Buffer.byteLength(pdf, "latin1")
    pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`

    for (let id = 1; id < objects.length; id += 1) {
        pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`
    }

    pdf += `trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

    return Buffer.from(pdf, "latin1")
}

function buildSimplePdfFromHtml(htmlContent) {
    return buildSimplePdfFromText(htmlToPlainText(htmlContent), "CareerPilot Resume")
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
    const skills = requiredSkills.length
        ? requiredSkills
        : [ "the main technology stack", "problem solving", "system design", "testing", "deployment" ]
    const primary = skills[0]
    const secondary = skills[1] || "the next most important role skill"
    const questionBlueprints = [
        skill => ({
            question: `How would you apply ${skill} to solve a practical problem in the ${title} role?`,
            intention: `Check whether the candidate can connect ${skill} to the day-to-day responsibilities in this job.`,
            answer: "Explain a relevant project or approach, the technical decisions you made, trade-offs you considered, and the measurable or practical outcome."
        }),
        skill => ({
            question: `Walk me through a project where you used ${skill}. What architecture or workflow did you choose and why?`,
            intention: "Evaluate practical depth, ownership, and ability to explain implementation choices.",
            answer: "Cover the problem, your role, key components, why the approach fit, and what you would improve with more time."
        }),
        skill => ({
            question: `What are common failure cases or edge cases when working with ${skill}, and how would you handle them?`,
            intention: "Test debugging maturity, reliability thinking, and awareness of production risks.",
            answer: "Name likely failure modes, add validation or monitoring ideas, and explain how you would reproduce, isolate, and fix the issue."
        }),
        () => ({
            question: `How would you design a small system or feature for this ${title} position from requirements to deployment?`,
            intention: "Assess system thinking across requirements, data flow, implementation, testing, and delivery.",
            answer: "Start with requirements, describe the components, APIs or data model, test plan, deployment approach, and trade-offs."
        }),
        skill => ({
            question: `How would you test a feature that depends heavily on ${skill}?`,
            intention: "Understand testing discipline and ability to protect important job responsibilities.",
            answer: "Discuss unit, integration, and end-to-end checks where relevant, plus mocks, fixtures, edge cases, and regression coverage."
        }),
        skill => ({
            question: `What performance or scalability concerns would you watch for when using ${skill}?`,
            intention: "Check whether the candidate can think beyond a happy-path implementation.",
            answer: "Mention bottlenecks, measurement, profiling or monitoring, and specific optimization choices that match the role."
        }),
        skill => ({
            question: `If a production issue appeared in an area using ${skill}, how would you investigate it?`,
            intention: "Evaluate incident response, debugging process, and communication under pressure.",
            answer: "Describe how you would inspect logs, reproduce the issue, narrow the cause, ship a fix safely, and communicate status."
        }),
        () => ({
            question: `How would you read this job description and decide which technical tasks deserve the most preparation time?`,
            intention: "See if the candidate can prioritize learning based on role requirements.",
            answer: "Rank the role's must-have technologies, map them to your experience, and focus practice on the highest-impact missing areas."
        }),
        skill => ({
            question: `Explain ${skill} to a non-technical stakeholder and then explain it to a senior engineer.`,
            intention: "Measure communication range and conceptual clarity.",
            answer: "Give a simple business-friendly explanation first, then add technical details, constraints, and examples for the engineer."
        }),
        () => ({
            question: `How would you ensure security and data safety in work related to this ${title} role?`,
            intention: "Assess baseline security awareness and responsible engineering habits.",
            answer: "Cover authentication, authorization, validation, secrets, dependency risks, safe data handling, and review practices."
        }),
        () => ({
            question: `Tell me about the most relevant technical gap you noticed for this role and how you would close it quickly.`,
            intention: "Gauge honesty, learning agility, and role-specific preparation.",
            answer: "Name the gap, explain why it matters for the job, outline a focused learning plan, and connect it to a small practical exercise."
        }),
        () => ({
            question: `How would you improve an existing codebase or workflow in the ${title} role without slowing the team down?`,
            intention: "Assess judgment, maintainability mindset, and collaboration.",
            answer: "Discuss understanding current constraints, choosing incremental improvements, validating impact, and communicating changes clearly."
        }),
        () => ({
            question: `How do you stay updated with changes and best practices related to ${title} tools?`,
            intention: "Assess self-education habits and continuous learning drive.",
            answer: "Mention specific blogs, newsletters, tech communities, or open-source projects you follow, and how you apply new concepts."
        }),
        skill => ({
            question: `What is the most challenging bug or issue you encountered using ${skill}, and how did you resolve it?`,
            intention: "Test deep debugging skills, analytical thinking, and persistence under pressure.",
            answer: "Describe the symptoms, the tools you used to isolate the root cause, the fix you implemented, and the long-term prevention steps."
        }),
        () => ({
            question: `How do you optimize performance and response times in a ${title} system?`,
            intention: "Evaluate profiling skills, database queries optimization, caching, and client-side or server-side performance tuning.",
            answer: "Discuss using profiling tools, identifying bottlenecks, optimizing assets or queries, caching strategies, and measuring the performance difference."
        })
    ]

    return questionBlueprints.slice(0, TARGET_TECHNICAL_QUESTION_COUNT).map((buildQuestion, index) =>
        buildQuestion(skills[index % skills.length], primary, secondary)
    )
}

function buildBehavioralQuestions(title, requiredSkills = []) {
    const primarySkill = requiredSkills[0] || "a role-critical skill"

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
        },
        {
            question: `Describe a time you received feedback on your technical work and changed your approach.`,
            intention: "Assess coachability, self-awareness, and quality improvement.",
            answer: "Use STAR, name the feedback, explain the change you made, and show how the final result improved."
        },
        {
            question: `Tell me about a time you had to explain ${primarySkill} or a technical decision to a non-technical person.`,
            intention: "Evaluate communication, empathy, and ability to translate technical details into business impact.",
            answer: "Explain the audience, what they needed to decide, how you simplified the message, and what outcome followed."
        },
        {
            question: "Describe a time you made a mistake or missed something important. How did you handle it?",
            intention: "Check accountability, resilience, and learning behavior.",
            answer: "Be direct about the mistake, explain how you fixed or escalated it, and close with the prevention step you added."
        },
        {
            question: `Why are you interested in this ${title} role, and how does it connect to your longer-term growth?`,
            intention: "Understand motivation, role alignment, and seriousness about the opportunity.",
            answer: "Connect the job description to your experience, growth goals, and the kind of impact you want to create."
        },
        {
            question: `Tell me about a time you had to take lead on a task or project. What was the outcome?`,
            intention: "Measure leadership potential, initiative, and responsibility.",
            answer: "Describe the situation, how you took the lead, aligned the team, managed the task, and the positive result."
        },
        {
            question: `Describe a situation where you had to work with tight deadlines. How did you prioritize your tasks?`,
            intention: "Assess time management, stress tolerance, and prioritization skills.",
            answer: "Explain how you evaluated the requirements, focused on critical path tasks, communicated timelines, and successfully delivered."
        },
        {
            question: `Tell me about a time you had a disagreement with a manager. How did you handle it?`,
            intention: "Assess emotional intelligence, respect for authority, and professional communication.",
            answer: "Discuss how you listened to their perspective, presented your data-backed view privately, accepted their final decision, and worked to support it."
        },
        {
            question: `Describe a time when you went above and beyond for a project or team.`,
            intention: "Evaluate commitment, self-motivation, and team player attitude.",
            answer: "Detail what the project was, the extra effort you made, why you did it, and the impact it had on the project or team."
        },
        {
            question: `Tell me about a time you had to adapt to a major change in a project's requirements at the last minute.`,
            intention: "Check adaptability, flexibility, and attitude towards change.",
            answer: "Explain the context of the change, how you reassessed your plan, stayed positive, and successfully delivered the updated requirements."
        },
        {
            question: `Describe a time when you noticed a process inefficiency and took steps to improve it.`,
            intention: "Evaluate proactive problem-solving, operational awareness, and quality drive.",
            answer: "Explain the inefficiency, the improvement you proposed and implemented, and the time or effort saved as a result."
        },
        {
            question: `Tell me about a time you had to work on a team project where a teammate was not pulling their weight.`,
            intention: "Assess conflict resolution, empathy, collaboration, and project ownership.",
            answer: "Explain how you spoke to the teammate privately to understand their challenges, offered support, kept the project on track, and maintained a professional relationship."
        }
    ]
}

function buildSkillGaps(requiredSkills, resume, selfDescription) {
    const candidateText = normalizeText(`${resume || ""} ${selfDescription || ""}`)
    const gaps = requiredSkills
        .filter(skill => !candidateText.includes(skill))
        .map((skill, index) => ({
            skill,
            severity: index < 2 ? "high" : "medium",
            evidence: `The job description asks for ${skill}, but it is not clearly visible in the resume or self-description.`,
            recommendation: `Add a truthful project bullet, coursework item, or practice example that shows practical ${skill} exposure.`,
            resumeKeyword: skill
        }))

    const generalGaps = [
        {
            skill: "Role-specific project evidence",
            severity: "high",
            evidence: "The resume should show examples that map directly to the target role responsibilities.",
            recommendation: "Add 2-3 bullets that connect past projects to the job description with tools, actions, and outcomes.",
            resumeKeyword: "Role-aligned projects"
        },
        {
            skill: "Quantified impact metrics",
            severity: "medium",
            evidence: "Impact is stronger when outcomes include numbers, scale, speed, accuracy, users, revenue, or time saved.",
            recommendation: "Rewrite key bullets with measurable results wherever the source material supports it.",
            resumeKeyword: "Impact metrics"
        },
        {
            skill: "System design explanation",
            severity: "medium",
            evidence: "Many technical roles expect candidates to explain architecture, trade-offs, and reliability.",
            recommendation: "Prepare one project story that covers architecture, data flow, trade-offs, testing, and deployment.",
            resumeKeyword: "System design"
        },
        {
            skill: "Testing and debugging examples",
            severity: "medium",
            evidence: "The resume should show how the candidate validates work and handles issues, not only what was built.",
            recommendation: "Add a bullet about testing, debugging, monitoring, or reliability work from a real project.",
            resumeKeyword: "Testing and debugging"
        },
        {
            skill: "Behavioral STAR stories",
            severity: "low",
            evidence: "Interview success depends on clear stories for ownership, teamwork, conflict, and learning.",
            recommendation: "Prepare concise STAR stories tied to the job description responsibilities.",
            resumeKeyword: "Collaboration and ownership"
        }
    ]

    return [ ...gaps, ...generalGaps ]
        .filter((gap, index, allGaps) => allGaps.findIndex(item => item.skill.toLowerCase() === gap.skill.toLowerCase()) === index)
        .slice(0, TARGET_SKILL_GAP_COUNT)
}

function buildPreparationPlan(title, requiredSkills, skillGaps = []) {
    const primarySkill = requiredSkills[0] || "the most important role skill"
    const secondarySkill = requiredSkills[1] || "the second most important role skill"
    const mainGap = skillGaps[0]?.skill || primarySkill
    const secondGap = skillGaps[1]?.skill || secondarySkill

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
        },
        {
            day: 8,
            focus: `Hands-on practice for ${mainGap}`,
            tasks: [
                `Complete a small practical exercise that demonstrates ${mainGap}.`,
                "Write one resume bullet that truthfully explains what you practiced or built.",
                "Prepare a short answer for how you are improving this skill."
            ]
        },
        {
            day: 9,
            focus: `Deepen ${secondarySkill} knowledge`,
            tasks: [
                `Review common interview questions and mistakes around ${secondarySkill}.`,
                "Create flash notes for definitions, trade-offs, and examples.",
                "Explain the concept out loud in simple and technical language."
            ]
        },
        {
            day: 10,
            focus: "Project story refinement",
            tasks: [
                "Choose two projects that best match the job description.",
                "Rewrite each story with problem, action, tools, result, and trade-offs.",
                "Add metrics or concrete outcomes where the source material supports them."
            ]
        },
        {
            day: 11,
            focus: "Advanced technical mock round",
            tasks: [
                "Answer four technical questions from the report without notes.",
                "For each answer, include assumptions, edge cases, and testing.",
                "Review weak answers and add missing technical detail."
            ]
        },
        {
            day: 12,
            focus: "Behavioral mock round",
            tasks: [
                "Practice five behavioral questions with STAR structure.",
                "Tie each story to one job responsibility or company need.",
                "Trim answers to stay clear, specific, and under two minutes."
            ]
        },
        {
            day: 13,
            focus: `Close the ${secondGap} gap`,
            tasks: [
                `Study the basics and one practical use case for ${secondGap}.`,
                "Document what you learned in three concise bullets.",
                "Prepare a transparent interview answer about current skill level and next steps."
            ]
        },
        {
            day: 14,
            focus: "Final readiness check",
            tasks: [
                "Review the resume PDF, skill gap list, and interview question answers.",
                "Prepare a 60-second introduction tailored to the role.",
                "Confirm examples for technical depth, teamwork, ownership, and learning agility."
            ]
        },
        {
            day: 15,
            focus: "Interview Day & Confidence Polish",
            tasks: [
                "Review key talking points and STAR project scenarios one last time.",
                "Perform a final equipment and software environment check (if remote).",
                "Take a deep breath, stay confident, and focus on clear, structured communication."
            ]
        }
    ]
}

function buildFallbackInterviewReport(jobDescription, resume, selfDescription) {
    const title = inferJobTitle(jobDescription)
    const requiredSkills = extractRequiredSkills(jobDescription)
    const skillGaps = buildSkillGaps(requiredSkills, resume, selfDescription)

    return {
        title,
        matchScore: computeMatchScore(jobDescription, resume, selfDescription),
        technicalQuestions: buildTechnicalQuestions(requiredSkills, title),
        behavioralQuestions: buildBehavioralQuestions(title, requiredSkills),
        skillGaps,
        preparationPlan: buildPreparationPlan(title, requiredSkills, skillGaps)
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
    const skill = compactText(gap?.skill) || fallbackGap.skill

    return {
        skill,
        severity,
        evidence: compactText(gap?.evidence) || fallbackGap.evidence || `The job description highlights ${skill}, but the candidate material does not show enough evidence yet.`,
        recommendation: compactText(gap?.recommendation) || fallbackGap.recommendation || `Add a truthful example, project bullet, or practice note that demonstrates ${skill}.`,
        resumeKeyword: compactText(gap?.resumeKeyword) || fallbackGap.resumeKeyword || skill
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

function normalizeList(candidateItems, fallbackItems, normalizer, targetCount, maxCount = targetCount) {
    const safeCandidateItems = Array.isArray(candidateItems) ? candidateItems : []
    const safeFallbackItems = Array.isArray(fallbackItems) ? fallbackItems : []
    const normalized = safeCandidateItems
        .slice(0, maxCount)
        .map((item, index) => normalizer(item, safeFallbackItems[index % safeFallbackItems.length]))
        .filter(Boolean)

    while (normalized.length < targetCount && safeFallbackItems.length) {
        const fallbackItem = safeFallbackItems[normalized.length % safeFallbackItems.length]
        normalized.push(normalizer(null, fallbackItem))
    }

    return normalized.slice(0, maxCount)
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
        technicalQuestions: normalizeList(technicalQuestions, fallbackReport.technicalQuestions, normalizeQuestion, TARGET_TECHNICAL_QUESTION_COUNT, 20),
        behavioralQuestions: normalizeList(behavioralQuestions, fallbackReport.behavioralQuestions, normalizeQuestion, TARGET_BEHAVIORAL_QUESTION_COUNT, 20),
        skillGaps: normalizeList(skillGaps, fallbackReport.skillGaps, normalizeSkillGap, TARGET_SKILL_GAP_COUNT, 25),
        preparationPlan: normalizeList(preparationPlan, fallbackReport.preparationPlan, normalizePreparationDay, TARGET_PREPARATION_DAYS, 25)
    }

    return normalized
}

async function generateInterviewReport({ resume, selfDescription, jobDescription }) {
    const fallbackReport = buildFallbackInterviewReport(jobDescription, resume, selfDescription)
    const prompt = `You are an expert interview coach, senior technical interviewer, and ATS analyst. Generate an interview strategy report using only the supplied candidate details and target job description.

Candidate resume text:
${resume || "Not provided"}

Candidate self description:
${selfDescription || "Not provided"}

Target job description:
${jobDescription}

Required output:
- Exactly ${TARGET_TECHNICAL_QUESTION_COUNT} technical questions. Make them practical, role-specific, and progressively deeper. Cover implementation, debugging, architecture, testing, deployment, performance, security, and trade-offs when relevant to the job description.
- Exactly ${TARGET_BEHAVIORAL_QUESTION_COUNT} behavioral questions. Use scenarios tied to the job responsibilities, teamwork, ownership, conflict, learning agility, ambiguity, and communication.
- Exactly ${TARGET_SKILL_GAP_COUNT} skill gaps based on differences between the job description and the resume/self-description. Include evidence, recommendation, and resumeKeyword for each gap.
- Exactly ${TARGET_PREPARATION_DAYS} preparation-plan days. Each day should have a clear focus and 3-4 concrete tasks.

Return valid JSON only. Make every question, skill gap, score, and preparation task specific to this candidate and this job. Do not invent employment history, certifications, education, or achievements that are not supported by the supplied candidate details.`

    try {
        const response = await getAiClient().models.generateContent({
            model: "gemini-2.5-flash",
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
        const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.GOOGLE_CHROME_BIN || await chromium.executablePath()

        browser = await puppeteer.launch({
            args: [ ...chromium.args, "--no-sandbox", "--disable-setuid-sandbox" ],
            defaultViewport: chromium.defaultViewport,
            executablePath,
            headless: chromium.headless
        })
        const page = await browser.newPage()
        page.setDefaultTimeout(45000)
        await page.setContent(htmlContent, { waitUntil: "load", timeout: 45000 })
        await page.emulateMediaType("screen")

        const pdf = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: {
                top: "14mm",
                bottom: "14mm",
                left: "13mm",
                right: "13mm"
            }
        })

        return Buffer.from(pdf)
    } catch (err) {
        console.error("HTML PDF rendering failed. Using plain PDF fallback:", err.message)
        return buildSimplePdfFromHtml(htmlContent)
    } finally {
        if (browser) await browser.close()
    }
}

function buildFallbackResumeHtml({ resume, selfDescription, jobDescription, title, skillGaps = [], preparationPlan = [], matchScore }) {
    const resolvedTitle = compactText(title) || inferJobTitle(jobDescription)
    const requiredSkills = extractRequiredSkills(jobDescription)
    const candidateText = normalizeText(`${resume || ""} ${selfDescription || ""}`)
    const demonstratedSkills = [ ...new Set([
        ...COMMON_TECH_SKILLS.filter(skill => candidateText.includes(skill)),
        ...requiredSkills.filter(skill => candidateText.includes(skill))
    ]) ].slice(0, 14)
    const normalizedGaps = Array.isArray(skillGaps)
        ? skillGaps
            .map(gap => ({
                skill: compactText(gap?.skill),
                severity: [ "low", "medium", "high" ].includes(gap?.severity) ? gap.severity : "medium",
                evidence: compactText(gap?.evidence),
                recommendation: compactText(gap?.recommendation),
                resumeKeyword: compactText(gap?.resumeKeyword)
            }))
            .filter(gap => gap.skill)
            .slice(0, TARGET_SKILL_GAP_COUNT)
        : []
    const skillsInProgress = [ ...new Set([
        ...normalizedGaps.map(gap => gap.resumeKeyword || gap.skill),
        ...requiredSkills.filter(skill => !candidateText.includes(skill))
    ].filter(Boolean)) ].slice(0, 12)
    const candidateName = String(resume || "")
        .split(/\r?\n/)
        .map(compactText)
        .find(line => line && line.length >= 2 && line.length <= 60 && !line.includes("@") && !/\d{5,}/.test(line)) || "Candidate Profile"
    const summary = compactText(selfDescription) || `Candidate targeting ${resolvedTitle} opportunities with a focus on practical execution, communication, and continuous learning.`
    const resumeLines = String(resume || "")
        .split(/\r?\n/)
        .map(compactText)
        .filter(line => line.length > 12)
        .slice(0, 15)

    const allSkills = [ ...new Set([ ...demonstratedSkills, ...skillsInProgress ]) ]

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        * { box-sizing: border-box; }
        body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #374151; line-height: 1.5; margin: 0; background: #ffffff; font-size: 11px; }
        .container { max-width: 800px; margin: 0 auto; padding: 20px; }
        h1 { margin: 0 0 5px; font-size: 24px; color: #1e3a8a; text-align: center; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em; }
        .contact-info { text-align: center; color: #4b5563; font-size: 10px; margin-bottom: 15px; }
        .header-line { border-bottom: 3px solid #1e3a8a; margin-bottom: 20px; }
        h2 { margin: 18px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #1e3a8a; font-weight: bold; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; }
        p { margin: 0 0 8px; text-align: justify; }
        .skills-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 15px; margin-top: 5px; }
        .skill-item { font-size: 10.5px; }
        .skill-item strong { color: #1e3a8a; }
        .experience-item { margin-bottom: 12px; }
        .item-header { display: flex; justify-content: space-between; font-weight: bold; font-size: 11px; color: #111827; }
        .item-sub { font-style: italic; color: #4b5563; font-size: 10px; margin-bottom: 3px; }
        ul { margin: 4px 0 0; padding-left: 15px; }
        li { margin-bottom: 3px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>${escapeHtml(candidateName)}</h1>
        <div class="contact-info">
            ${escapeHtml(resolvedTitle)} | Email: candidate@example.com | Phone: (555) 019-2834 | Location: USA
        </div>
        <div class="header-line"></div>

        <h2>Professional Summary</h2>
        <p>${escapeHtml(summary)}</p>

        <h2>Technical Skills</h2>
        <div class="skills-grid">
            <div class="skill-item"><strong>Core Skills:</strong> ${allSkills.slice(0, Math.ceil(allSkills.length/2)).map(s => escapeHtml(s)).join(", ")}</div>
            <div class="skill-item"><strong>Additional Skills:</strong> ${allSkills.slice(Math.ceil(allSkills.length/2)).map(s => escapeHtml(s)).join(", ")}</div>
        </div>

        <h2>Professional Experience & Projects</h2>
        <div class="experience-item">
            <div class="item-header">
                <span>RELEVANT EXPERIENCE & PROJECTS</span>
                <span>Present</span>
            </div>
            <div class="item-sub">Key Accomplishments & Responsibilities</div>
            <ul>
                ${(resumeLines.length ? resumeLines : [ "Collaborate with cross-functional teams to define, design, and ship new features.", "Optimize application performance and resolve bottlenecks to improve responsiveness.", "Utilize industry-standard tools and methodologies to deliver high-quality code and architectures." ]).map(line => `<li>${escapeHtml(line)}</li>`).join("")}
            </ul>
        </div>

        <h2>Education & Certifications</h2>
        <div class="experience-item">
            <div class="item-header">
                <span>Bachelor of Science in Computer Science / Related Field</span>
                <span>Completed</span>
            </div>
            <div class="item-sub">Relevant coursework and continuous self-directed learning in modern technologies.</div>
        </div>
    </div>
</body>
</html>`
}

async function generateResumePdf({ resume, selfDescription, jobDescription, title, matchScore, skillGaps = [], preparationPlan = [] }) {
    const resolvedTitle = compactText(title) || inferJobTitle(jobDescription)
    const requiredSkills = extractRequiredSkills(jobDescription)
    const skillGapSummary = Array.isArray(skillGaps) && skillGaps.length
        ? skillGaps.map((gap, index) => `${index + 1}. ${gap.skill} (${gap.severity}) - ${gap.recommendation || gap.evidence || "Needs role-specific evidence."} Resume keyword: ${gap.resumeKeyword || gap.skill}`).join("\n")
        : "No saved skill gaps were available."
    const preparationSummary = Array.isArray(preparationPlan) && preparationPlan.length
        ? preparationPlan.map(day => `Day ${day.day}: ${day.focus} - ${(day.tasks || []).join("; ")}`).join("\n")
        : "No saved preparation plan was available."

    const prompt = `Generate a polished, professional, single-column, corporate-style, ATS-friendly resume as complete HTML for this candidate, matching the requested layout design.

Resume:
${resume || "Not provided"}

Self Description:
${selfDescription || "Not provided"}

Job Description:
${jobDescription}

Target role title:
${resolvedTitle}

Required skills detected from job description (including identified missing skills/gaps):
${requiredSkills.length ? requiredSkills.join(", ") : "React, TypeScript, Node.js, and other role-relevant technologies."}
${skillGapSummary ? `Identified Skill Gaps to Integrate: \n${skillGapSummary}` : ""}

Rules:
- Return JSON only with a single "html" field.
- The HTML must be complete and valid, with inline CSS only. Do not use external fonts, scripts, images, or remote assets.
- Keep the PDF professional, clean, and readable, preferably 1-2 pages.
- Structuring sections:
  - Header: Center the candidate's name (large, bold, text-transform: uppercase, color: #1e3a8a). Center the contact info (email, phone, location, LinkedIn, GitHub) on the next line. Underneath the header, add a solid dark blue line (border-bottom: 3px solid #1e3a8a).
  - Sections (PROFESSIONAL SUMMARY, TECHNICAL SKILLS, EXPERIENCE, EDUCATION, PROJECTS): All section titles must be uppercase, bold, color: #1e3a8a, with a thin bottom border (border-bottom: 1px solid #cbd5e1).
  - Technical Skills: Arrange skills in a clean 2-column grid or list categorized into Languages, Frameworks/Libraries, Databases, and Developer Tools/Other. Make sure the category labels are bold. Ensure ALL required skills and missing skills from the job description are categorized and listed.
  - Experience, Education, and Projects: For each entry, use a layout where the role title/degree/project title is bold on the left, and the date range is bold on the right (e.g. using a flex container: display: flex; justify-content: space-between;). Place the company/school name in italics on the line below it. Use clean bullet points for duties and achievements.
- The layout must be a clean, single-column resume. DO NOT include sidebars, preparation plans, gap analysis tables, or career coaching advice. It must be a clean, final resume suitable for job applications.`

    try {
        const response = await getAiClient().models.generateContent({
            model: "gemini-2.5-flash",
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
        return await generatePdfFromHtml(buildFallbackResumeHtml({ resume, selfDescription, jobDescription, title: resolvedTitle, matchScore, skillGaps, preparationPlan }))
    }
}

module.exports = { generateInterviewReport, generateResumePdf, generatePdfFromHtml }
