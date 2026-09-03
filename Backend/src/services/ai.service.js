const { GoogleGenAI } = require("@google/genai")
const { z } = require("zod")
const { zodToJsonSchema } = require("zod-to-json-schema")
const chromium = require("@sparticuz/chromium")
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const path = require("path")

function findChromeOnWindows() {
    if (process.platform !== "win32") return null;
    const paths = [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe")
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

let aiClient = null

const TARGET_TECHNICAL_QUESTION_COUNT = 25
const TARGET_BEHAVIORAL_QUESTION_COUNT = 15
const TARGET_SKILL_GAP_COUNT = 15
const TARGET_PREPARATION_DAYS = 30

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

const assessmentAndQuestionsSchema = z.object({
    title: z.string().describe("The exact target job title from the job description"),
    matchScore: z.number().describe("A score between 0 and 100 indicating how well the candidate's profile matches the job description"),
    professionalSummary: z.string().describe("A concise, ATS-friendly professional summary tailored to the target job description"),
    technicalQuestions: z.array(z.object({
        question: z.string().describe("The technical question that can be asked in the interview"),
        intention: z.string().describe("The interviewer's intention behind asking this question"),
        answer: z.string().describe("Concise, high-impact model answer highlighting essential points and technical concepts")
    })).describe("Technical interview questions tailored to the job"),
    behavioralQuestions: z.array(z.object({
        question: z.string().describe("The behavioral question that can be asked in the interview"),
        intention: z.string().describe("The interviewer's intention behind asking this question"),
        answer: z.string().describe("Concise STAR-method response outline with key points to cover")
    })).describe("Behavioral interview questions tailored to the job")
})

const skillGapsAndRoadmapSchema = z.object({
    skillGaps: z.array(z.object({
        skill: z.string().describe("The name of the missing or weak skill (must be unique, do not repeat)"),
        severity: z.enum([ "low", "medium", "high" ]).describe("The severity of this skill gap"),
        explanation: z.string().describe("Concise explanation of why this is a gap based on comparing the candidate profile and job requirements"),
        interviewImpact: z.string().describe("Concise description of how this skill gap impacts interview performance or hiring decision"),
        estimatedLearningTime: z.string().describe("Estimated time needed to learn this skill (e.g. '3 days', '1 week')"),
        evidence: z.string().describe("Specific evidence/context from the resume or job description explaining why this gap exists"),
        recommendation: z.string().describe("Concise action plan to close this gap"),
        projectSuggestion: z.string().describe("A practical hands-on mini-project suggestion utilizing this skill"),
        resumeKeyword: z.string().describe("The exact resume keyword or phrase connected to this gap")
    })).describe("Unique missing or weak skills compared with the job description"),
    preparationPlan: z.array(z.object({
        day: z.number().describe("The day number in the preparation plan, starting from 1 to 30"),
        focus: z.string().describe("The main focus of this day in the preparation plan"),
        tasks: z.array(z.string()).describe("2 to 4 concise, actionable tasks to complete on this day")
    })).describe("A 30-day interview preparation plan"),
    certifications: z.array(z.object({
        name: z.string().describe("The name of the professional certification"),
        reason: z.string().describe("Concise reason why this certification is recommended based on role and skill gaps"),
        officialUrl: z.string().url().optional().describe("The official certification page URL if known with certainty"),
        preparationResourceTitle: z.string().optional().describe("The title of a preparation resource if known with certainty"),
        preparationResourceUrl: z.string().url().optional().describe("The URL of the preparation resource if known with certainty")
    })).describe("5 to 10 recommended certifications"),
    recommendedProjects: z.array(z.object({
        title: z.string().describe("The title of the practical project"),
        explanation: z.string().describe("Concise explanation of how this project helps close specific skill gaps"),
        skillsAddressed: z.array(z.string()).describe("The list of missing skills addressed by this project")
    })).describe("Exactly 5 recommended practical projects to bridge skill gaps")
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
        }),
        () => ({
            question: `How do you ensure code readability and maintainability when working under tight deadlines?`,
            intention: "Check how the candidate balances execution speed with technical debt and clean code practices.",
            answer: "Discuss using coding standards, modular design, self-documenting code, quick code reviews, and planned refactoring sessions."
        }),
        () => ({
            question: `What strategy do you use for database schema migrations in a live production environment?`,
            intention: "Evaluate data safety, zero-downtime migration strategies, and rollback planning.",
            answer: "Explain multi-phase migrations (expand and contract pattern), backward compatibility, backup verifications, and script testing in staging."
        }),
        () => ({
            question: `What is your approach to designing a comprehensive error handling and logging system?`,
            intention: "Understand error tracking, log aggregation, and user feedback design.",
            answer: "Discuss distinguishing user-facing errors from server logs, logging levels, central tracking (like Sentry/ELK), and avoiding exposing internal stack traces."
        }),
        () => ({
            question: `How do you detect and fix memory leaks or CPU bottlenecks in applications?`,
            intention: "Check profiling capabilities, analytical debugging, and runtime performance understanding.",
            answer: "Describe using heap snapshots, CPU profiling tools, identifying closure issues or open event listeners, and running load test checks."
        }),
        () => ({
            question: `How would you automate testing and deployment in a CI/CD pipeline for the ${title} role?`,
            intention: "Assess automation mindset, test integration, and deployment reliability knowledge.",
            answer: "Discuss setting up test runners, lint rules, Docker builds, staging verification steps, and zero-downtime deployment triggers."
        }),
        () => ({
            question: `How do you manage third-party dependencies and security vulnerabilities in a project?`,
            intention: "Evaluate dependency auditing, licensing checks, and security updates hygiene.",
            answer: "Explain using audit tools (npm audit, Snyk), locking dependency versions, pinning critical packages, and scheduling regular dependency review sessions."
        }),
        () => ({
            question: `How do you balance shipping features quickly with managing technical debt in a fast-paced team?,`,
            intention: "Assess commercial awareness, pragmatic engineering, and prioritization skills.",
            answer: "Describe documenting debt, separating critical shortcuts from long-term stability, and reserving percentage developer capacity for engineering health."
        }),
        () => ({
            question: `What are the best practices for versioning RESTful APIs or schemas to avoid breaking client applications?`,
            intention: "Check compatibility design, endpoint versioning strategies, and deprecation policies.",
            answer: "Discuss URL versioning, header versioning, keeping old versions active during transition periods, and sending deprecation warnings."
        }),
        skill => ({
            question: `How and where would you implement caching for queries or data related to ${skill}?`,
            intention: "Assess caching principles, invalidation strategies, and latency reduction options.",
            answer: "Detail CDN caching for static assets, server-side memory caching, Redis for database query caching, and cache invalidation policies (TTL, write-through)."
        }),
        () => ({
            question: `What is your approach to documenting code, APIs, and system architectures for other developers?`,
            intention: "Measure engineering collaboration, developer experience focus, and clarity of written communication.",
            answer: "Cover writing clear READMEs, OpenAPI/Swagger specifications, commenting complex algorithms, and maintaining architectural decision logs (ADRs)."
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

const SKILL_PROJECT_MAP = {
    "javascript": "Build an interactive, dynamic web app using ES6+ features, managing complex asynchronous API calls.",
    "typescript": "Create a strictly typed utility framework or library utilizing advanced interfaces, generics, and strict configurations.",
    "react": "Develop a complex single-page application dashboard with React Router, Context API or Redux, hooks, and clean reusable components.",
    "next.js": "Construct a server-side rendered (SSR) e-commerce front-end or blog with optimized SEO, pre-rendering, and next-generation image loader features.",
    "node.js": "Build a RESTful microservice API incorporating request validation, JWT authentication, and structured logging.",
    "express": "Create a robust backend server with custom routing, error handling middleware, and rate-limiting.",
    "mongodb": "Design a document database schema for an e-commerce platform and implement complex aggregate queries.",
    "postgresql": "Design a relational database schema with foreign keys, index optimizations, and custom view queries.",
    "sql": "Write complex analytical database queries using JOINs, Window functions, and transaction controls.",
    "docker": "Dockerize a full-stack React and Node application with multi-stage builds and compose files for service orchestration.",
    "aws": "Deploy a containerized application to ECS or App Runner and set up cloud watch alarms and billing alerts.",
    "testing": "Write comprehensive unit and integration tests using Jest and React Testing Library for a login system.",
    "python": "Create an automated web scraper script or data analysis script with pandas and export results to Excel."
};

const CANONICAL_SKILL_MAP = {
    "react": "React",
    "react.js": "React",
    "reactjs": "React",
    "react js": "React",
    "react.js framework": "React",
    "node": "Node.js",
    "node.js": "Node.js",
    "nodejs": "Node.js",
    "node js": "Node.js",
    "express": "Express.js",
    "express.js": "Express.js",
    "expressjs": "Express.js",
    "js": "JavaScript",
    "javascript": "JavaScript",
    "vanilla js": "JavaScript",
    "vanillajs": "JavaScript",
    "ts": "TypeScript",
    "typescript": "TypeScript",
    "postgres": "PostgreSQL",
    "postgresql": "PostgreSQL",
    "mongo": "MongoDB",
    "mongodb": "MongoDB",
    "k8s": "Kubernetes",
    "kubernetes": "Kubernetes",
    "docker": "Docker",
    "docker containers": "Docker",
    "docker containerization": "Docker",
    "aws": "AWS",
    "amazon web services": "AWS",
    "aws cloud": "AWS",
    "gcp": "Google Cloud",
    "google cloud": "Google Cloud",
    "google cloud platform": "Google Cloud",
    "azure": "Azure",
    "microsoft azure": "Azure",
    "next": "Next.js",
    "next.js": "Next.js",
    "nextjs": "Next.js",
    "vue": "Vue.js",
    "vue.js": "Vue.js",
    "vuejs": "Vue.js",
    "angular": "Angular",
    "angular.js": "AngularJS",
    "angularjs": "AngularJS",
    "c#": "C#",
    "c sharp": "C#",
    "csharp": "C#",
    "c++": "C++",
    "cpp": "C++",
    "golang": "Go",
    "go lang": "Go",
    "graphql": "GraphQL",
    "graph ql": "GraphQL",
    "rest": "REST APIs",
    "rest api": "REST APIs",
    "restful api": "REST APIs",
    "rest apis": "REST APIs",
    "restful apis": "REST APIs",
    "ci/cd": "CI/CD",
    "cicd": "CI/CD",
    "ci cd": "CI/CD",
    "ci / cd": "CI/CD",
    "tailwind": "Tailwind CSS",
    "tailwindcss": "Tailwind CSS",
    "tailwind css": "Tailwind CSS",
    "sass": "Sass",
    "scss": "Sass"
};

function canonicalizeSkillName(skillName) {
    const raw = compactText(skillName);
    if (!raw) return "";
    const lower = raw.toLowerCase();
    return CANONICAL_SKILL_MAP[lower] || raw;
}

function getSkillKey(skillName) {
    const raw = compactText(skillName).toLowerCase();
    if (!raw) return "";

    // Explicit differentiation for C-family languages
    if (raw === "c#" || raw === "csharp" || raw === "c sharp") return "csharp";
    if (raw === "c++" || raw === "cpp") return "cpp";
    if (raw === "c") return "clanguage";

    // Canonicalize known aliases first
    const canonical = CANONICAL_SKILL_MAP[raw] ? CANONICAL_SKILL_MAP[raw].toLowerCase() : raw;

    // Normalize: strip non-alphanumeric characters (spaces, punctuation, slashes)
    return canonical.replace(/[^a-z0-9]/g, "");
}

function buildSkillGaps(requiredSkills, resume, selfDescription) {
    const candidateText = normalizeText(`${resume || ""} ${selfDescription || ""}`)
    const gaps = requiredSkills
        .filter(skill => !candidateText.includes(skill.toLowerCase()))
        .map((skill, index) => {
            const canonicalSkill = canonicalizeSkillName(skill);
            const skillLower = canonicalSkill.toLowerCase();
            const project = SKILL_PROJECT_MAP[skillLower] || `Build a practical hands-on project utilizing ${canonicalSkill} (such as a CRUD application, automated script, or API service) to showcase functional proficiency.`;
            let severity = "low";
            let estTime = "3 days";
            let impact = "Moderate impact. May hinder standard implementation tasks during live technical interviews.";
            
            if (index < 3) {
                severity = "high";
                estTime = "1 week";
                impact = "High impact. Crucial core technology requested in the job description; lack of demonstration could be a hiring blocker.";
            } else if (index < 7) {
                severity = "medium";
                estTime = "5 days";
                impact = "Medium impact. Important supporting tool/concept; expected to be understood for intermediate architecture and system scaling queries.";
            }

            const explanation = `The job description emphasizes proficiency in ${canonicalSkill}, but there is no explicit mention or evidence of it in your resume or profile description.`;

            return {
                skill: canonicalSkill,
                severity,
                explanation,
                interviewImpact: impact,
                estimatedLearningTime: estTime,
                evidence: explanation,
                recommendation: `Study the core concepts of ${canonicalSkill} and implement the suggested project to bridge this gap.`,
                projectSuggestion: project,
                resumeKeyword: canonicalSkill
            };
        })

    const generalGaps = [
        {
            skill: "Role-specific project evidence",
            severity: "high",
            explanation: "The job description requires hands-on experience in target role projects, but the resume shows general or misaligned projects.",
            interviewImpact: "High impact. Interviewers expect candidates to have direct, hands-on experience solving similar problems; lack of target role projects will decrease score significantly.",
            estimatedLearningTime: "1 week",
            evidence: "The job description requires hands-on experience in target role projects, but the resume shows general or misaligned projects.",
            recommendation: "Add 2-3 detailed project bullet points mapping directly to the job description responsibilities using actions and outcomes.",
            projectSuggestion: "Design a comprehensive deployment flow and log implementation details for a recent application.",
            resumeKeyword: "Role-aligned projects"
        },
        {
            skill: "Quantified impact metrics",
            severity: "medium",
            explanation: "Most project descriptions list responsibilities instead of achievements and measurable metrics.",
            interviewImpact: "Medium impact. Lacks concrete proof of effectiveness; modern corporate hiring expects business metric improvements like speed, scale, or cost reduction.",
            estimatedLearningTime: "3 days",
            evidence: "Most project descriptions list responsibilities instead of achievements and measurable metrics.",
            recommendation: "Rewrite key resume bullet points with concrete metrics (e.g. performance speedups, user retention, scale, or time saved).",
            projectSuggestion: "Refactor a backend algorithm to reduce execution time and quantify the reduction.",
            resumeKeyword: "Impact metrics"
        },
        {
            skill: "System design explanation",
            severity: "medium",
            explanation: "The role description expects understanding of system design, architecture, and scalability which isn't detailed in the resume.",
            interviewImpact: "Medium impact. Critical for mid-to-senior levels; without it, you will struggle with system design interview questions.",
            estimatedLearningTime: "5 days",
            evidence: "The role description expects understanding of system design, architecture, and scalability which isn't detailed in the resume.",
            recommendation: "Prepare a system design diagram/case study of one of your projects covering data flow, scaling bottlenecks, and security trade-offs.",
            projectSuggestion: "Create a detailed multi-tier architecture diagram for a scalable application with caching.",
            resumeKeyword: "System design"
        },
        {
            skill: "Testing and debugging examples",
            severity: "medium",
            explanation: "The resume does not detail how code is tested or how issues are diagnosed in production environments.",
            interviewImpact: "Medium impact. High production risks if ignored; missing testing history reduces credibility for writing production-ready code.",
            estimatedLearningTime: "4 days",
            evidence: "The resume does not detail how code is tested or how issues are diagnosed in production environments.",
            recommendation: "Add unit testing, integration testing, or observability/debugging logs configuration to your experience bullets.",
            projectSuggestion: "Write a test suite covering critical endpoints and boundary cases for an API service.",
            resumeKeyword: "Testing and debugging"
        },
        {
            skill: "Behavioral STAR stories",
            severity: "low",
            explanation: "The job description emphasizes collaboration and communication, but there are no behavioral highlights in the profile.",
            interviewImpact: "Low impact. Vital for culture fit checks; you must be ready with real situations demonstrating teamwork and problem-solving.",
            estimatedLearningTime: "2 days",
            evidence: "The job description emphasizes collaboration and communication, but there are no behavioral highlights in the profile.",
            recommendation: "Draft 2-3 structured STAR stories (Situation, Task, Action, Result) showcasing leadership, conflict resolution, or rapid self-learning.",
            projectSuggestion: "Document a technical conflict scenario, your resolution approach, and the key lessons learned.",
            resumeKeyword: "Collaboration and ownership"
        }
    ]

    const seenFallbackKeys = new Set();
    return [ ...gaps, ...generalGaps ]
        .filter(gap => {
            const key = getSkillKey(gap.skill);
            if (!key || seenFallbackKeys.has(key)) return false;
            seenFallbackKeys.add(key);
            return true;
        })
        .slice(0, TARGET_SKILL_GAP_COUNT);
}

function buildPreparationPlan(title, requiredSkills, skillGaps = []) {
    const highGaps = skillGaps.filter(g => g.severity === "high");
    const mediumGaps = skillGaps.filter(g => g.severity === "medium");
    const lowGaps = skillGaps.filter(g => g.severity === "low");
    const learningGaps = [ ...highGaps, ...mediumGaps, ...lowGaps ];

    const plan = [];

    const getGapDayContent = (dayNum, gapItem) => {
        const projectText = gapItem.projectSuggestion || "a hands-on coding demonstration";
        return {
            day: dayNum,
            focus: `Close gap: Study and master ${gapItem.skill} (${gapItem.severity} priority)`,
            tasks: [
                `Learn the core concepts, architecture, and common interview questions for ${gapItem.skill}.`,
                `Evidence of gap: ${gapItem.evidence}`,
                `Project Suggestion: Start building a project: "${projectText}".`,
                `Add this project and the ${gapItem.resumeKeyword || gapItem.skill} keyword to your resume upon completion.`
            ]
        };
    };

    const staticDayFallbacks = {
        2: {
            focus: `Deep dive into core role technologies`,
            tasks: [
                "Practice explaining the main technology stack mentioned in the job description.",
                "Review common interview questions around the main tools in the job description.",
                "Write two concise project examples that show practical skill."
            ]
        },
        3: {
            focus: "Technical problem solving & coding practice",
            tasks: [
                "Practice live coding or system design patterns related to the target role.",
                "Explain your logic out loud while writing clean, modular code.",
                "Focus on edge cases, scaling bottlenecks, and testing."
            ]
        },
        4: {
            focus: "Review secondary job requirements",
            tasks: [
                "Study supporting libraries and tools listed in the job description.",
                "Build a small helper utility or setup configuration file.",
                "Review security guidelines and error handling strategies."
            ]
        },
        5: {
            focus: "Build behavioral STAR stories",
            tasks: [
                "Prepare STAR stories for ownership, team collaboration, and learning agility.",
                "Map each scenario to the core values/culture of the target company.",
                "Practice delivering concise answers under two minutes."
            ]
        },
        6: {
            focus: "Mock interview practice",
            tasks: [
                "Record yourself answering three technical questions from this report.",
                "Evaluate clarity of explanations, pacing, and depth.",
                "Refine answers to eliminate jargon and filler words."
            ]
        },
        7: {
            focus: "Mid-preparation checkpoint & resume review",
            tasks: [
                "Ensure matching skills are highlighted in the top third of your resume.",
                "Verify all technical answers cover intention, approach, and trade-offs.",
                "Plan the rest of the preparation around remaining skill gaps."
            ]
        },
        8: {
            focus: "Study database & data flow design",
            tasks: [
                "Review database patterns, schemas, and query optimization methods.",
                "Design a small data model for a complex system component.",
                "Explain database trade-offs (e.g. SQL vs. NoSQL) for the role."
            ]
        },
        9: {
            focus: "Practice system integrations & APIs",
            tasks: [
                "Review REST or GraphQL API design standards, headers, and status codes.",
                "Build a small integration service using third-party APIs.",
                "Test API response structures and handle edge failures."
            ]
        },
        10: {
            focus: "Refine project descriptions",
            tasks: [
                "Rewrite resume experience bullets with active action verbs.",
                "Ensure achievements show quantitative business impact.",
                "Review engineering trade-offs made in past projects."
            ]
        },
        11: {
            focus: "Advanced coding & mock interviews",
            tasks: [
                "Perform a full mock interview session covering code optimization.",
                "Discuss memory management, time complexity, and performance profiling.",
                "Debug a complex production bug scenario."
            ]
        },
        12: {
            focus: "Review deployment & DevOps",
            tasks: [
                "Study CI/CD pipeline structures, runners, and configuration files.",
                "Practice deployment processes (e.g. using Docker, staging clusters).",
                "Review server logging, error metrics, and monitoring tools."
            ]
        },
        13: {
            focus: "Final gap review",
            tasks: [
                "Review notes for all identified high and medium priority skill gaps.",
                "Verify mock answers show robust technical understanding.",
                "Update resume with any last-minute skill key phrases."
            ]
        },
        14: {
            focus: "Study security & authentication standards",
            tasks: [
                "Review JWT, OAuth2, and session-based authentication schemes.",
                "Understand transport layer security, HTTPS, and API gateway rules.",
                "Analyze CORS issues and configure secure request headers."
            ]
        },
        15: {
            focus: "Understand performance optimization & caching",
            tasks: [
                "Study memory caching policies, TTL, and cache invalidation strategies.",
                "Design a Redis caching layer for heavy database queries.",
                "Optimize client-side assets and utilize CDN pre-fetching where possible."
            ]
        },
        16: {
            focus: "Practice error handling & observability",
            tasks: [
                "Implement global error handlers and custom application exception patterns.",
                "Define structured logging formats and output filters.",
                "Understand metrics dashboard setups (Prometheus, Grafana, or equivalent)."
            ]
        },
        17: {
            focus: "Review testing strategies",
            tasks: [
                "Write unit tests with mock behaviors for core functions.",
                "Implement API integration testing with database rollbacks.",
                "Understand end-to-end user path testing (Cypress, Playwright)."
            ]
        },
        18: {
            focus: "Behavioral stories: Conflict & Collaboration",
            tasks: [
                "Draft stories covering resolving technical disagreements with colleagues.",
                "Formulate answers about collaborating across multi-disciplinary teams.",
                "Practice explaining complex architecture decisions to non-technical stakeholders."
            ]
        },
        19: {
            focus: "System design: Scalability & Queues",
            tasks: [
                "Design systems incorporating message queues (RabbitMQ, Kafka) for async tasks.",
                "Discuss horizontal scaling, load balancing, and database replication.",
                "Determine single points of failure in typical architecture flows."
            ]
        },
        20: {
            focus: "Peer mock interviews & exercises",
            tasks: [
                "Perform live whiteboard or coding exercises with a peer or assistant.",
                "Explain your coding complexity in terms of Big-O time and space.",
                "Take notes on areas where your answers stumbled or felt unclear."
            ]
        },
        21: {
            focus: "Review API integration & rate limiting",
            tasks: [
                "Understand rate-limiting algorithms (token bucket, leaky bucket).",
                "Integrate third-party webhooks and handle retry policies securely.",
                "Design fallback responses (circuit breakers) for downstream failures."
            ]
        },
        22: {
            focus: "Optimize resume formatting & keyword alignment",
            tasks: [
                "Check resume readability and clean typography layouts.",
                "Incorporate exact terminology matching the target job description.",
                "Ensure links (GitHub, LinkedIn, Portfolio) function correctly."
            ]
        },
        23: {
            focus: "Cloud provider fundamentals",
            tasks: [
                "Review cloud storage, compute instances, and serverless compute paradigms.",
                "Understand IAM permissions, roles, and resource access rules.",
                "Calculate estimated cloud service costs for a prototype project."
            ]
        },
        24: {
            focus: "Prepare questions for interviewers",
            tasks: [
                "Draft insightful questions about their developer culture, release cycles, and tech debt.",
                "Ask about the team's immediate priorities and 6-month product goals.",
                "Query them about growth paths and onboarding structures."
            ]
        },
        25: {
            focus: "Code refactoring & Clean Code principles",
            tasks: [
                "Review SOLID principles and clean code styling guidelines.",
                "Refactor an old prototype project focusing on separation of concerns.",
                "Add inline code documentation for convoluted logic blocks."
            ]
        },
        26: {
            focus: "Practice algorithmic/DSA challenges",
            tasks: [
                "Solve classic array, string, and hash table manipulation problems.",
                "Understand recursion, search algorithms, and basic tree traversals.",
                "Implement custom sorting or searching helpers from memory."
            ]
        },
        27: {
            focus: "Scenario-based architectural challenges",
            tasks: [
                "Explain how you would handle sudden traffic spikes (e.g. Black Friday).",
                "Determine how to sync offline data when a connection is restored.",
                "Design a migration path from monolith to microservices."
            ]
        },
        28: {
            focus: "Simulated full mock interview",
            tasks: [
                "Conduct a 60-minute mock session covering tech, behavior, and architecture.",
                "Time each section to emulate high-pressure interview constraints.",
                "List your final prep items to review over the next 48 hours."
            ]
        }
    };

    plan.push({
        day: 1,
        focus: `Align background with ${title} requirements`,
        tasks: [
            "Review the job description requirements and identify key technologies.",
            "Compare your background and highlight matching skills.",
            "Prepare a short elevator pitch explaining why you are a strong fit."
        ]
    });

    for (let d = 2; d <= 28; d++) {
        const gapIndex = d - 2;
        if (learningGaps[gapIndex]) {
            plan.push(getGapDayContent(d, learningGaps[gapIndex]));
        } else {
            const fallback = staticDayFallbacks[d];
            plan.push({
                day: d,
                focus: fallback.focus,
                tasks: fallback.tasks
            });
        }
    }

    plan.push({
        day: 29,
        focus: "Final interview readiness check",
        tasks: [
            "Perform a complete dry-run of the resume and top projects.",
            "Prepare a 60-second introduction emphasizing role-aligned experience.",
            "Re-read STAR stories to ensure smooth, natural delivery."
        ]
    });

    plan.push({
        day: 30,
        focus: "Interview Day & Confidence Polish",
        tasks: [
            "Review key talking points and STAR project scenarios one last time.",
            "Perform a final equipment and software environment check (if remote).",
            "Take a deep breath, stay confident, and focus on clear, structured communication."
        ]
    });

    return plan;
}

function buildFallbackInterviewReport(jobDescription, resume, selfDescription) {
    const title = inferJobTitle(jobDescription)
    const requiredSkills = extractRequiredSkills(jobDescription)
    const skillGaps = buildSkillGaps(requiredSkills, resume, selfDescription)
    const candidateText = normalizeText(`${resume || ""} ${selfDescription || ""}`)
    const demonstratedSkills = [ ...new Set([
        ...COMMON_TECH_SKILLS.filter(skill => candidateText.includes(skill)),
        ...requiredSkills.filter(skill => candidateText.includes(skill))
    ]) ].slice(0, 14)
    const skillsInProgress = [ ...new Set([
        ...skillGaps.map(gap => gap.resumeKeyword || gap.skill),
        ...requiredSkills.filter(skill => !candidateText.includes(skill))
    ].filter(Boolean)) ].slice(0, 12)

    const summary = `Results-oriented ${title} with demonstrated expertise in ${demonstratedSkills.slice(0, 3).join(", ") || "software design"}. Actively enhancing skills in ${skillsInProgress.slice(0, 3).join(", ") || "advanced technologies"} to deliver scalable, high-performance solutions aligned with the target job requirements.`
    const certifications = inferCertifications(jobDescription, requiredSkills, 7)

    const gapProjects = skillGaps
        .filter(g => g.projectSuggestion)
        .map(g => ({
            title: `${g.skill} Implementation Project`,
            explanation: `Building this project closes the ${g.skill} gap by requiring hands-on work with: ${g.projectSuggestion}`,
            skillsAddressed: [ g.skill ]
        }))
    const defaultProj = [
        {
            title: `Enterprise ${title} Platform`,
            explanation: `Focuses on setting up core architecture, handling concurrent requests, and establishing continuous integration testing.`,
            skillsAddressed: requiredSkills.slice(0, 2)
        },
        {
            title: `Distributed Integration Service`,
            explanation: `Develops API endpoints, authentication middleware, database queries, and secure validation rules.`,
            skillsAddressed: requiredSkills.slice(2, 4)
        },
        {
            title: `Cloud Deployment & Observability Pipeline`,
            explanation: `Establishes container build pipelines, docker orchestration, health logging, and monitoring alerts.`,
            skillsAddressed: requiredSkills.includes("aws") ? [ "aws", "docker" ] : [ "deployment", "infrastructure" ]
        }
    ]
    const recommendedProjects = [ ...gapProjects, ...defaultProj ].slice(0, 5)

    return {
        title,
        matchScore: computeMatchScore(jobDescription, resume, selfDescription),
        professionalSummary: summary,
        technicalQuestions: buildTechnicalQuestions(requiredSkills, title).slice(0, TARGET_TECHNICAL_QUESTION_COUNT),
        behavioralQuestions: buildBehavioralQuestions(title, requiredSkills).slice(0, TARGET_BEHAVIORAL_QUESTION_COUNT),
        skillGaps,
        preparationPlan: buildPreparationPlan(title, requiredSkills, skillGaps),
        certifications,
        recommendedProjects
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
    const rawSkill = compactText(gap?.skill) || fallbackGap?.skill || "Technical Competency"
    const skill = canonicalizeSkillName(rawSkill)
    const severity = [ "low", "medium", "high" ].includes(gap?.severity) ? gap.severity : (fallbackGap?.severity || "medium")

    const fallbackExp = fallbackGap?.explanation || `The job description emphasizes proficiency in ${skill}, but there is no explicit mention or evidence of it in your resume or profile description.`
    const fallbackImp = fallbackGap?.interviewImpact || `Moderate impact. Failing to demonstrate proficiency in ${skill} may weaken your competitiveness.`
    const fallbackRec = fallbackGap?.recommendation || `Study the core concepts of ${skill} and implement a practical project to bridge this gap.`
    const fallbackProj = fallbackGap?.projectSuggestion || `Build a practical hands-on project utilizing ${skill} to showcase functional proficiency.`
    const fallbackKw = fallbackGap?.resumeKeyword || skill

    return {
        skill,
        severity,
        explanation: compactText(gap?.explanation) || fallbackExp,
        interviewImpact: compactText(gap?.interviewImpact) || fallbackImp,
        estimatedLearningTime: compactText(gap?.estimatedLearningTime) || fallbackGap?.estimatedLearningTime || "3 days",
        evidence: compactText(gap?.evidence) || fallbackGap?.evidence || fallbackExp,
        recommendation: compactText(gap?.recommendation) || fallbackRec,
        projectSuggestion: compactText(gap?.projectSuggestion) || fallbackProj,
        resumeKeyword: compactText(gap?.resumeKeyword) || fallbackKw
    }
}

function normalizeSkillGapsList(candidateGaps, fallbackGaps, targetCount = TARGET_SKILL_GAP_COUNT, maxCount = 25) {
    const safeCandidateGaps = Array.isArray(candidateGaps) ? candidateGaps : []
    const safeFallbackGaps = Array.isArray(fallbackGaps) ? fallbackGaps : []

    const normalized = []
    const seenKeys = new Set()

    // 1. Process candidate gaps from Gemini first
    for (const gap of safeCandidateGaps) {
        if (!gap) continue
        const skillName = canonicalizeSkillName(compactText(gap.skill))
        const skillKey = getSkillKey(skillName)
        if (!skillKey || seenKeys.has(skillKey)) {
            continue // Skip duplicates
        }
        seenKeys.add(skillKey)

        const normalizedGap = normalizeSkillGap({ ...gap, skill: skillName }, null)
        normalized.push(normalizedGap)

        if (normalized.length >= maxCount) break
    }

    // 2. If fewer unique gaps than targetCount, pad with unique fallback gaps only
    if (normalized.length < targetCount) {
        for (const fallbackGap of safeFallbackGaps) {
            if (normalized.length >= targetCount) break
            if (!fallbackGap) continue

            const fallbackSkillName = canonicalizeSkillName(compactText(fallbackGap.skill))
            const fallbackKey = getSkillKey(fallbackSkillName)

            if (!fallbackKey || seenKeys.has(fallbackKey)) {
                continue // Skip if already present
            }

            seenKeys.add(fallbackKey)
            const normalizedFallback = normalizeSkillGap(null, { ...fallbackGap, skill: fallbackSkillName })
            normalized.push(normalizedFallback)
        }
    }

    // Return high-quality unique skill gaps without injecting duplicate padding
    return normalized
}

function normalizeCertificationsList(candidateCerts, fallbackCerts, targetCount = 6, maxCount = 10) {
    const safeCandidateCerts = Array.isArray(candidateCerts) ? candidateCerts : []
    const safeFallbackCerts = Array.isArray(fallbackCerts) ? fallbackCerts : []

    const normalized = []
    const seenKeys = new Set()

    const getCertKey = (name) => {
        const raw = compactText(name).toLowerCase()
        return raw.replace(/[^a-z0-9]/g, "")
    }

    // 1. Process candidate certifications from Gemini first
    for (const cert of safeCandidateCerts) {
        if (!cert) continue
        const certName = compactText(cert.name)
        const certKey = getCertKey(certName)
        if (!certKey || seenKeys.has(certKey)) continue
        seenKeys.add(certKey)

        normalized.push({
            name: certName,
            reason: compactText(cert.reason) || `Recommended professional credential to demonstrate proficiency in core competencies required for this role.`,
            officialUrl: isValidHttpUrl(cert.officialUrl) ? cert.officialUrl : undefined,
            preparationResourceTitle: compactText(cert.preparationResourceTitle) || undefined,
            preparationResourceUrl: isValidHttpUrl(cert.preparationResourceUrl) ? cert.preparationResourceUrl : undefined
        })

        if (normalized.length >= maxCount) break
    }

    // 2. If fewer unique certs than targetCount, pad with unique fallback certs only
    if (normalized.length < targetCount) {
        for (const fallbackCert of safeFallbackCerts) {
            if (normalized.length >= targetCount) break
            if (!fallbackCert) continue

            const fbName = compactText(fallbackCert.name)
            const fbKey = getCertKey(fbName)
            if (!fbKey || seenKeys.has(fbKey)) continue
            seenKeys.add(fbKey)

            normalized.push({
                name: fbName,
                reason: compactText(fallbackCert.reason) || `Validates core domain agility and technical depth for this target role.`,
                officialUrl: isValidHttpUrl(fallbackCert.officialUrl) ? fallbackCert.officialUrl : undefined,
                preparationResourceTitle: compactText(fallbackCert.preparationResourceTitle) || undefined,
                preparationResourceUrl: isValidHttpUrl(fallbackCert.preparationResourceUrl) ? fallbackCert.preparationResourceUrl : undefined
            })
        }
    }

    return normalized
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
    const certifications = Array.isArray(candidateReport?.certifications)
        ? candidateReport.certifications
        : []
    const recommendedProjects = Array.isArray(candidateReport?.recommendedProjects)
        ? candidateReport.recommendedProjects
        : []

    const normalized = {
        title: compactText(candidateReport?.title) || fallbackReport.title,
        matchScore: Number.isFinite(Number(candidateReport?.matchScore))
            ? Math.min(100, Math.max(0, Math.round(Number(candidateReport.matchScore))))
            : fallbackReport.matchScore,
        professionalSummary: compactText(candidateReport?.professionalSummary) || fallbackReport.professionalSummary,
        technicalQuestions: normalizeList(technicalQuestions, fallbackReport.technicalQuestions, normalizeQuestion, TARGET_TECHNICAL_QUESTION_COUNT, TARGET_TECHNICAL_QUESTION_COUNT),
        behavioralQuestions: normalizeList(behavioralQuestions, fallbackReport.behavioralQuestions, normalizeQuestion, TARGET_BEHAVIORAL_QUESTION_COUNT, TARGET_BEHAVIORAL_QUESTION_COUNT),
        skillGaps: normalizeSkillGapsList(skillGaps, fallbackReport.skillGaps, TARGET_SKILL_GAP_COUNT, 25),
        preparationPlan: normalizeList(preparationPlan, fallbackReport.preparationPlan, normalizePreparationDay, TARGET_PREPARATION_DAYS, 45),
        certifications: normalizeCertificationsList(certifications, fallbackReport.certifications, 6, 10),
        recommendedProjects: normalizeList(recommendedProjects, fallbackReport.recommendedProjects, (p, fb) => ({
            title: compactText(p?.title) || fb.title,
            explanation: compactText(p?.explanation) || fb.explanation,
            skillsAddressed: Array.isArray(p?.skillsAddressed) ? p.skillsAddressed.map(compactText).filter(Boolean) : fb.skillsAddressed
        }), 5, 5)
    }

    return normalized
}

function isValidHttpUrl(value) {
    try {
        const url = new URL(value)
        return url.protocol === "http:" || url.protocol === "https:"
    } catch {
        return false
    }
}


async function generateAssessmentAndQuestions({ resume, selfDescription, jobDescription }) {
    const prompt = `You are an expert interview coach, senior technical interviewer, and ATS analyst. Evaluate the candidate profile against the target job description and generate the assessment and tailored interview questions.

Candidate Resume Text:
${resume || "Not provided"}

Candidate Self-Description:
${selfDescription || "Not provided"}

Target Job Description:
${jobDescription}

Required output:
1. "title": The exact target job title from the job description.
2. "matchScore": An integer between 0 and 100 indicating profile alignment.
3. "professionalSummary": A concise, ATS-friendly professional summary tailored to highlight candidate strengths for this role.
4. "technicalQuestions": Exactly ${TARGET_TECHNICAL_QUESTION_COUNT} technical interview questions tailored to the job role and description:
   - Must be role-specific (e.g. DSA, system design, framework-specific, backend, or cloud concepts as appropriate).
   - "question": The technical question.
   - "intention": Concise explanation of the interviewer's intention.
   - "answer": Concise, interview-ready model answer. Focus on high-impact key concepts, trade-offs, and structured response points. Avoid unnecessarily long essays.
5. "behavioralQuestions": Exactly ${TARGET_BEHAVIORAL_QUESTION_COUNT} behavioral interview questions:
   - Cover leadership, teamwork, conflict resolution, time management, problem-solving, and learning from failure.
   - "question": The behavioral question.
   - "intention": Concise explanation of the interviewer's intention.
   - "answer": Concise STAR-method (Situation, Task, Action, Result) outline highlighting key points to cover.

Return valid JSON only.`

    const response = await getAiClient().models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: zodToJsonSchema(assessmentAndQuestionsSchema),
            thinkingConfig: {
                thinkingBudget: 0
            }
        }
    })

    return assessmentAndQuestionsSchema.parse(JSON.parse(response.text))
}

async function generateSkillGapsAndRoadmap({ resume, selfDescription, jobDescription }) {
    const prompt = `You are an expert career strategist and technical curriculum designer. Analyze the candidate profile against the target job description to identify skill gaps and create a preparation roadmap.

Candidate Resume Text:
${resume || "Not provided"}

Candidate Self-Description:
${selfDescription || "Not provided"}

Target Job Description:
${jobDescription}

Required output:
1. "skillGaps": Up to ${TARGET_SKILL_GAP_COUNT} unique, non-repeating missing or weak skills compared to the job description:
   - Every skill gap must represent a genuinely distinct technology, tool, framework, platform, methodology, or domain. Do not create separate entries for different aspects of the same technology. Avoid aliases, duplicates, and sub-skills of an already listed skill.
   - "skill": Canonical name of the missing skill or technology.
   - "severity": "high" (core requirement), "medium" (important supporting), or "low" (nice to have).
   - "explanation": Concise explanation of why this skill is needed for the target job role.
   - "interviewImpact": Concise impact of this gap on interview performance or hiring decision.
   - "estimatedLearningTime": Estimated time to acquire basic proficiency (e.g. '3 days', '1 week').
   - "evidence": Specific evidence/context from the resume or job description explaining why this gap exists (keep distinct from explanation, do not duplicate text).
   - "recommendation": Concise, actionable learning action.
   - "projectSuggestion": A practical, hands-on mini-project concept utilizing this skill.
   - "resumeKeyword": The specific keyword or phrase to add to resume once learned.
2. "preparationPlan": Exactly ${TARGET_PREPARATION_DAYS} preparation-plan days (Roadmap):
   - Day 1-7 (Week 1: Core learning goals & critical gaps), Day 8-14 (Week 2: Hands-on projects), Day 15-21 (Week 3: Deep dive & scenario practice), Day 22-30 (Week 4: Mock interviews & final preparation).
   - "day": Integer from 1 to 30.
   - "focus": Concise main focus topic of the day.
   - "tasks": Array of 2 to 4 concise, actionable tasks for that day.
3. "certifications": Exactly 5 to 8 recommended professional certifications tailored directly to the missing skills and target job requirements:
   - Must be distinct credentials (do NOT output duplicate or overlapping certifications).
   - "name": Official certification title.
   - "reason": Concise reason why it improves domain proficiency and ATS credibility for this specific role.
   - "officialUrl", "preparationResourceTitle", "preparationResourceUrl": Only include if known with certainty; otherwise omit.
4. "recommendedProjects": Exactly 5 practical project suggestions:
   - "title": Project title.
   - "explanation": Concise explanation of how building it bridges specific skill gaps.
   - "skillsAddressed": Array of skills addressed.

Return valid JSON only.`

    const response = await getAiClient().models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: zodToJsonSchema(skillGapsAndRoadmapSchema),
            thinkingConfig: {
                thinkingBudget: 0
            }
        }
    })

    return skillGapsAndRoadmapSchema.parse(JSON.parse(response.text))
}

async function generateInterviewReport({ resume, selfDescription, jobDescription }) {
    const fallbackReport = buildFallbackInterviewReport(jobDescription, resume, selfDescription)

    const [ assessmentResult, strategyResult ] = await Promise.all([
        generateAssessmentAndQuestions({ resume, selfDescription, jobDescription }).catch(err => {
            console.error("AI assessment & questions generation failed (Call 1):", err.message)
            return null
        }),
        generateSkillGapsAndRoadmap({ resume, selfDescription, jobDescription }).catch(err => {
            console.error("AI skill gaps & roadmap generation failed (Call 2):", err.message)
            return null
        })
    ])

    if (!assessmentResult && !strategyResult) {
        console.error("Both AI generation calls failed. Returning full fallback report.")
        return fallbackReport
    }

    const mergedReport = {
        title: assessmentResult?.title || fallbackReport.title,
        matchScore: assessmentResult?.matchScore ?? fallbackReport.matchScore,
        professionalSummary: assessmentResult?.professionalSummary || fallbackReport.professionalSummary,
        technicalQuestions: assessmentResult?.technicalQuestions || fallbackReport.technicalQuestions,
        behavioralQuestions: assessmentResult?.behavioralQuestions || fallbackReport.behavioralQuestions,
        skillGaps: strategyResult?.skillGaps || fallbackReport.skillGaps,
        preparationPlan: strategyResult?.preparationPlan || fallbackReport.preparationPlan,
        certifications: strategyResult?.certifications || fallbackReport.certifications,
        recommendedProjects: strategyResult?.recommendedProjects || fallbackReport.recommendedProjects
    }

    return normalizeInterviewReport(mergedReport, fallbackReport)
}


async function generatePdfFromHtml(htmlContent) {
    let browser

    try {
        let executablePath
        let launchArgs = []

        if (process.platform === "win32") {
            const chromePath = findChromeOnWindows()
            if (chromePath) {
                executablePath = chromePath
                launchArgs = [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--no-zygote"
                ]
            } else {
                throw new Error("Google Chrome not found on Windows in standard paths.")
            }
        } else {
            executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.GOOGLE_CHROME_BIN || await chromium.executablePath()
            launchArgs = [
                ...chromium.args,
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--single-process",
                "--no-zygote"
            ]
        }

        browser = await puppeteer.launch({
            args: launchArgs,
            defaultViewport: process.platform === "win32" ? null : chromium.defaultViewport,
            executablePath,
            headless: process.platform === "win32" ? true : chromium.headless
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

function inferCertifications(jobDescription, requiredSkills, limit = 6) {
    const text = String(jobDescription || "").toLowerCase()
    const certs = []

    if (text.includes("aws")) certs.push({ name: "AWS Certified Solutions Architect / Developer - Associate", reason: "Demonstrates cloud computing architecture, storage, and serverless implementation skills." })
    if (text.includes("azure")) certs.push({ name: "Microsoft Certified: Azure Developer Associate", reason: "Validates cloud compute, storage, security, and microservices integration on Microsoft Azure." })
    if (text.includes("gcp") || text.includes("google cloud")) certs.push({ name: "Google Cloud Associate Cloud Engineer", reason: "Proves proficiency in deploying applications, monitoring operations, and managing enterprise cloud projects." })
    if (text.includes("kubernetes") || text.includes("docker") || text.includes("container")) certs.push({ name: "Certified Kubernetes Administrator (CKA)", reason: "Validates proficiency in container orchestration, microservices deployment, and scaling." })
    if (text.includes("react") || text.includes("next.js") || text.includes("frontend") || text.includes("javascript")) certs.push({ name: "Meta Front-End Developer Professional Certificate", reason: "Proves advanced UI state management, performance profiling, and component architecture." })
    if (text.includes("node") || text.includes("backend") || text.includes("express")) certs.push({ name: "Node.js Application Developer (JSNAD)", reason: "Ensures proficiency in event-driven asynchronous microservices and API development." })
    if (text.includes("typescript")) certs.push({ name: "Microsoft Certified: TypeScript & Modern Web Development", reason: "Affirms type safety, advanced generics, and enterprise architecture proficiency." })
    if (text.includes("python") || text.includes("machine learning") || text.includes("data")) certs.push({ name: "Google Professional Data Engineer", reason: "Establishes expertise in database scaling, analytics pipelines, and data storage design." })
    if (text.includes("security") || text.includes("auth") || text.includes("jwt")) certs.push({ name: "CompTIA Security+ or CISSP", reason: "Confirms foundational security compliance, authentication, and secure coding practices." })
    if (text.includes("ci/cd") || text.includes("devops") || text.includes("terraform")) certs.push({ name: "HashiCorp Certified Terraform Associate", reason: "Proves familiarity with infrastructure-as-code and automated CI/CD deployment pipelines." })
    if (text.includes("sql") || text.includes("postgres") || text.includes("database") || text.includes("mongodb")) certs.push({ name: "PostgreSQL Professional / MongoDB Certified Associate", reason: "Validates advanced indexing, query tuning, relational modeling, and data persistence design." })
    if (text.includes("scrum") || text.includes("agile")) certs.push({ name: "Professional Scrum Master (PSM I)", reason: "Affirms understanding of agile methodologies, iteration structures, and team collaboration." })

    if (certs.length < limit) {
        certs.push({ name: "Advanced Software Engineering Certification", reason: "Validates core software engineering principles, design patterns, and testing discipline." })
        certs.push({ name: "Certified Professional Software Developer (CPSD)", reason: "Confirms technical agility, implementation cleanliness, and developer efficiency." })
        certs.push({ name: "Oracle Certified Professional Java Developer", reason: "Shows foundational programming rigor, object-oriented concepts, and concurrency control." })
    }

    const unique = [];
    const seen = new Set();
    for (const cert of certs) {
        const key = cert.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(cert);
        }
    }
    return unique.slice(0, limit);
}

function parseResumeText(resumeText) {
    const lines = String(resumeText || "")
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    const result = {
        name: "Candidate Profile",
        email: "candidate@example.com",
        phone: "(555) 019-2834",
        location: "USA",
        links: [],
        experience: [],
        education: [],
        skills: []
    };

    if (lines.length === 0) return result;

    // Heuristics for name
    for (let i = 0; i < Math.min(5, lines.length); i++) {
        const line = lines[i];
        if (line.length >= 2 && line.length <= 40 && !line.includes("@") && !/\d/.test(line) && !line.toLowerCase().includes("resume") && !line.toLowerCase().includes("cv")) {
            result.name = line;
            break;
        }
    }

    // Heuristics for contact info
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const phoneRegex = /(\+?\d{1,4}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
    const urlRegex = /(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g;

    const fullText = lines.join("\n");
    const emailMatch = fullText.match(emailRegex);
    if (emailMatch) result.email = emailMatch[0];

    const phoneMatch = fullText.match(phoneRegex);
    if (phoneMatch) result.phone = phoneMatch[0];

    const locationRegex = /(?:location|address|lives in)[:\-]?\s*([a-zA-Z\s,]+)/i;
    const locMatch = fullText.match(locationRegex);
    if (locMatch?.[1]) {
        result.location = locMatch[1].trim();
    } else {
        const cityStateMatch = fullText.match(/\b([A-Z][a-zA-Z\s]{1,20}),\s?([A-Z]{2}|[A-Z][a-zA-Z\s]{1,15})\b/);
        if (cityStateMatch) {
            const lowerMatch = cityStateMatch[0].toLowerCase();
            const containsTech = ["javascript", "typescript", "react", "node", "angular", "vue", "html", "css", "aws", "docker"].some(kw => lowerMatch.includes(kw));
            if (!containsTech) {
                result.location = cityStateMatch[0];
            }
        }
    }

    const urlMatches = fullText.match(urlRegex);
    if (urlMatches) {
        result.links = [ ...new Set(urlMatches.map(url => url.trim())) ].slice(0, 3);
    }

    // Heuristics for section parsing
    let currentSection = "summary";
    const sections = {
        summary: [],
        experience: [],
        education: [],
        skills: [],
        projects: []
    };

    const headerPatterns = {
        experience: /^(?:professional\s+)?experience|work\s+history|employment|career\s+history/i,
        education: /^education|academic\s+background|qualifications/i,
        skills: /^skills|technical\s+skills|expertise|core\s+competencies/i,
        projects: /^projects|key\s+projects|academic\s+projects|personal\s+projects/i
    };

    for (const line of lines) {
        let matchedHeader = false;
        for (const [key, pattern] of Object.entries(headerPatterns)) {
            if (pattern.test(line) && line.length < 35) {
                currentSection = key;
                matchedHeader = true;
                break;
            }
        }
        if (matchedHeader) continue;

        if (sections[currentSection]) {
            sections[currentSection].push(line);
        }
    }

    // Format Experience entries
    if (sections.experience.length > 0) {
        let currentItem = null;
        for (const line of sections.experience) {
            const dateRegex = /\b(19|20)\d{2}\b|\b(present|current|now)\b/i;
            if ((dateRegex.test(line) || line.length < 50) && !line.startsWith("-") && !line.startsWith("•") && !line.startsWith("*")) {
                if (currentItem) result.experience.push(currentItem);
                currentItem = {
                    header: line,
                    bullets: []
                };
            } else if (currentItem) {
                currentItem.bullets.push(line.replace(/^[-•*\s]+/, ""));
            } else {
                if (result.experience.length === 0) {
                    result.experience.push({ header: "Relevant Experience", bullets: [] });
                }
                result.experience[result.experience.length - 1].bullets.push(line.replace(/^[-•*\s]+/, ""));
            }
        }
        if (currentItem) result.experience.push(currentItem);
    }

    // Format Education entries
    if (sections.education.length > 0) {
        let currentEdu = null;
        for (const line of sections.education) {
            const dateRegex = /\b(19|20)\d{2}\b|\b(present|current|now|completed)\b/i;
            const degreeKeywords = /degree|bachelor|master|phd|associate|diploma|university|college|school|b\.s|m\.s|b\.tech|b\.e/i;
            if ((dateRegex.test(line) || degreeKeywords.test(line) || line.length < 50) && !line.startsWith("-") && !line.startsWith("•") && !line.startsWith("*")) {
                if (currentEdu) result.education.push(currentEdu);
                currentEdu = {
                    degree: line,
                    details: []
                };
            } else if (currentEdu) {
                currentEdu.details.push(line.replace(/^[-•*\s]+/, ""));
            } else {
                if (result.education.length === 0) {
                    result.education.push({ degree: "Academic Background", details: [] });
                }
                result.education[result.education.length - 1].details.push(line.replace(/^[-•*\s]+/, ""));
            }
        }
        if (currentEdu) result.education.push(currentEdu);
    }

    // Format Skills list
    if (sections.skills.length > 0) {
        result.skills = sections.skills
            .flatMap(line => line.split(/[,;|•\t]/))
            .map(s => s.trim())
            .filter(s => s.length > 1 && s.length < 25);
    }

    return result;
}

function buildFallbackResumeHtml({ resume, selfDescription, jobDescription, title, skillGaps = [], preparationPlan = [], matchScore, professionalSummary, certifications = [], recommendedProjects = [] }) {
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
                projectSuggestion: compactText(gap?.projectSuggestion) || `Build a project showcasing ${gap.skill}.`,
                resumeKeyword: compactText(gap?.resumeKeyword)
            }))
            .filter(gap => gap.skill)
            .slice(0, TARGET_SKILL_GAP_COUNT)
        : []
    const skillsInProgress = requiredSkills.filter(skill => !candidateText.includes(skill))

    // Parse resume structured details
    const parsed = parseResumeText(resume)
    const candidateName = parsed.name !== "Candidate Profile" ? parsed.name : (String(resume || "").split(/\r?\n/).find(Boolean) || "Candidate Profile")
    
    // Tailored professional summary
    const summary = professionalSummary || `Results-oriented ${resolvedTitle} with demonstrated expertise in ${demonstratedSkills.slice(0, 3).join(", ") || "software design"}. Actively enhancing skills in ${skillsInProgress.slice(0, 3).join(", ") || "advanced technologies"} to deliver scalable, high-performance solutions aligned with the target job requirements.`

    const allSkills = [ ...new Set([ ...parsed.skills, ...demonstratedSkills, ...skillsInProgress ]) ]
        .map(s => compactText(s))
        .filter(s => s && s.length > 1 && s.length < 30 && !s.includes(":") && !s.toLowerCase().includes("project") && !s.toLowerCase().includes("metric") && !s.toLowerCase().includes("story") && !s.toLowerCase().includes("evidence"));

    // Dynamically build projects based on gaps or JD
    let resumeProjects = []
    if (Array.isArray(recommendedProjects) && recommendedProjects.length > 0) {
        resumeProjects = recommendedProjects.map(proj => ({
            title: proj.title,
            description: proj.explanation
        }))
    } else {
        const gapProjects = normalizedGaps
            .filter(g => g.projectSuggestion)
            .map(g => ({
                title: `${g.skill} Implementation Project`,
                description: g.projectSuggestion
            }))
        const defaultProjects = [
            {
                title: `Enterprise ${resolvedTitle} Platform`,
                description: `Designed and built a robust enterprise system utilizing ${requiredSkills.slice(0, 3).join(", ") || "core technologies"} to optimize performance and handle concurrent traffic.`
            },
            {
                title: `Distributed Integration Service`,
                description: `Developed a secure RESTful API microservice leveraging modern software engineering practices, testing protocols, and CI/CD pipelines.`
            }
        ]
        resumeProjects = gapProjects.length >= 5 ? gapProjects.slice(0, 5) : [ ...gapProjects, ...defaultProjects ].slice(0, 5)
    }

    // Inferred certifications
    const inferredCerts = (Array.isArray(certifications) && certifications.length > 0)
        ? certifications
        : inferCertifications(jobDescription, requiredSkills, 7)

    // Format experience items
    let experienceHtml = ""
    if (parsed.experience.length > 0) {
        experienceHtml = parsed.experience.map(exp => `
        <div class="experience-item">
            <div class="item-header">
                <span>${escapeHtml(exp.header)}</span>
            </div>
            <ul>
                ${exp.bullets.map(b => `<li>${escapeHtml(b)}</li>`).join("")}
            </ul>
        </div>
        `).join("")
    } else {
        const resumeLines = String(resume || "")
            .split(/\r?\n/)
            .map(compactText)
            .filter(line => {
                const lower = line.toLowerCase();
                return line.length > 15 && 
                       !lower.includes("@") && 
                       !lower.includes("skills:") && 
                       !lower.includes("phone:") && 
                       !lower.includes("email:") &&
                       !lower.includes("linkedin.com") &&
                       !lower.includes("github.com") &&
                       !/^\d+$/.test(line);
            })
            .slice(0, 15)
        experienceHtml = `
        <div class="experience-item">
            <div class="item-header">
                <span>RELEVANT EXPERIENCE</span>
                <span>Present</span>
            </div>
            <div class="item-sub">Key Accomplishments & Responsibilities</div>
            <ul>
                ${(resumeLines.length ? resumeLines : [ "Collaborate with cross-functional teams to define, design, and ship new features.", "Optimize application performance and resolve bottlenecks to improve responsiveness.", "Utilize industry-standard tools and methodologies to deliver high-quality code and architectures." ]).map(line => `<li>${escapeHtml(line)}</li>`).join("")}
            </ul>
        </div>`
    }

    // Format education items
    let educationHtml = ""
    if (parsed.education.length > 0) {
        educationHtml = parsed.education.map(edu => `
        <div class="experience-item">
            <div class="item-header">
                <span>${escapeHtml(edu.degree)}</span>
            </div>
            ${edu.details.length ? `<div class="item-sub">${edu.details.map(d => escapeHtml(d)).join("<br>")}</div>` : ""}
        </div>
        `).join("")
    } else {
        educationHtml = `
        <div class="experience-item">
            <div class="item-header">
                <span>Bachelor of Science in Computer Science / Related Field</span>
                <span>Completed</span>
            </div>
            <div class="item-sub">Relevant coursework and continuous self-directed learning in modern technologies.</div>
        </div>`
    }

    const linkedinLink = parsed.links.find(link => link.includes("linkedin.com")) || "linkedin.com/in/candidate";
    const githubLink = parsed.links.find(link => link.includes("github.com")) || "github.com/candidate";

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        * { box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; 
            color: #1f2937; 
            line-height: 1.45; 
            margin: 0; 
            background: #ffffff; 
            font-size: 10.5px; 
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        .container { max-width: 800px; margin: 0 auto; padding: 12px 18px; }
        h1 { 
            margin: 0 0 4px; 
            font-size: 22px; 
            color: #1e3a8a; 
            text-align: center; 
            font-weight: 700; 
            text-transform: uppercase; 
            letter-spacing: 0.05em; 
        }
        .contact-info { 
            text-align: center; 
            color: #4b5563; 
            font-size: 9.5px; 
            margin-bottom: 12px; 
            line-height: 1.5; 
        }
        .contact-info a { color: #1e3a8a; text-decoration: none; font-weight: 500; }
        .header-line { border-bottom: 2.5px solid #1e3a8a; margin-bottom: 12px; }
        h2 { 
            margin: 12px 0 5px; 
            font-size: 11px; 
            text-transform: uppercase; 
            letter-spacing: 0.05em; 
            color: #1e3a8a; 
            font-weight: 700; 
            border-bottom: 1px solid #cbd5e1; 
            padding-bottom: 2px; 
        }
        p { margin: 0 0 6px; text-align: justify; line-height: 1.45; }
        .skills-grid { 
            display: grid; 
            grid-template-columns: 1fr 1fr; 
            gap: 5px 14px; 
            margin-top: 3px; 
            margin-bottom: 6px; 
        }
        .skill-item { font-size: 10px; line-height: 1.4; }
        .skill-item strong { color: #1e3a8a; font-weight: 600; }
        .experience-item { margin-bottom: 8px; page-break-inside: avoid; }
        .item-header { 
            display: flex; 
            justify-content: space-between; 
            font-weight: 700; 
            font-size: 10.5px; 
            color: #111827; 
        }
        .item-sub { 
            font-style: italic; 
            color: #4b5563; 
            font-size: 9.5px; 
            margin-bottom: 2px; 
        }
        ul { margin: 2px 0 0; padding-left: 15px; }
        li { margin-bottom: 2px; line-height: 1.4; }
    </style>
</head>
<body>
    <div class="container">
        <h1>${escapeHtml(candidateName)}</h1>
        <div class="contact-info">
            <strong>${escapeHtml(resolvedTitle)}</strong> &nbsp;|&nbsp; 
            Email: ${escapeHtml(parsed.email)} &nbsp;|&nbsp; 
            Phone: ${escapeHtml(parsed.phone)} &nbsp;|&nbsp; 
            Location: ${escapeHtml(parsed.location)}<br>
            LinkedIn: <a href="https://${escapeHtml(linkedinLink.replace(/^https?:\/\//, ""))}" target="_blank">${escapeHtml(linkedinLink)}</a> &nbsp;|&nbsp; 
            GitHub: <a href="https://${escapeHtml(githubLink.replace(/^https?:\/\//, ""))}" target="_blank">${escapeHtml(githubLink)}</a>
        </div>
        <div class="header-line"></div>

        <h2>Professional Summary</h2>
        <p>${escapeHtml(summary)}</p>

        <h2>Technical Skills</h2>
        <div class="skills-grid">
            <div class="skill-item"><strong>Core Skills:</strong> ${allSkills.slice(0, Math.ceil(allSkills.length/2)).map(s => escapeHtml(s)).join(", ")}</div>
            <div class="skill-item"><strong>Additional Skills:</strong> ${allSkills.slice(Math.ceil(allSkills.length/2)).map(s => escapeHtml(s)).join(", ")}</div>
        </div>

        <h2>Projects</h2>
        ${resumeProjects.map(proj => `
        <div class="experience-item">
            <div class="item-header">
                <span>${escapeHtml(proj.title)}</span>
                <span style="font-weight: 500; color: #4b5563;">Active</span>
            </div>
            <div class="item-sub">Technical Demonstration Project</div>
            <ul>
                <li>${escapeHtml(proj.description)}</li>
                <li>Implemented clean architecture, robust testing, and optimized deployment protocols.</li>
            </ul>
        </div>
        `).join("")}

        <h2>Experience</h2>
        ${experienceHtml}

        <h2>Education</h2>
        ${educationHtml}

        <h2>Certifications</h2>
        <div class="experience-item" style="margin-top: 4px;">
            <ul>
                ${inferredCerts.map(cert => `<li><strong>${escapeHtml(cert.name)}</strong> - ${escapeHtml(cert.reason)}</li>`).join("")}
            </ul>
        </div>
    </div>
</body>
</html>`
}

async function generateResumePdf({ resume, selfDescription, jobDescription, title, matchScore, skillGaps = [], preparationPlan = [], professionalSummary, certifications = [], recommendedProjects = [] }) {
    const resolvedTitle = compactText(title) || inferJobTitle(jobDescription)

    const resumeHtml = buildFallbackResumeHtml({
        resume,
        selfDescription,
        jobDescription,
        title: resolvedTitle,
        matchScore,
        skillGaps,
        preparationPlan,
        professionalSummary,
        certifications,
        recommendedProjects
    })

    return await generatePdfFromHtml(resumeHtml)
}

module.exports = { generateInterviewReport, generateResumePdf, generatePdfFromHtml }
