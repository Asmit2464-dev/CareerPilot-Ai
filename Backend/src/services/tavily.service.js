const TAVILY_SEARCH_URL = "https://api.tavily.com/search"

function getTavilyApiKey() {
    const apiKey = process.env.TAVILY_API_KEY

    if (!apiKey) {
        const error = new Error("TAVILY_API_KEY is not configured.")
        error.statusCode = 503
        throw error
    }

    return apiKey
}

function toResource(result) {
    return {
        title: String(result.title || "Learning resource").slice(0, 300),
        url: result.url,
        content: String(result.content || "").slice(0, 500),
        score: typeof result.score === "number" ? result.score : null
    }
}

async function searchResources(query) {
    const response = await fetch(TAVILY_SEARCH_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${getTavilyApiKey()}`
        },
        body: JSON.stringify({
            query,
            search_depth: "basic",
            max_results: 5,
            include_answer: false,
            include_raw_content: false
        }),
        signal: AbortSignal.timeout(15000)
    })

    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
        const error = new Error(payload.detail || payload.message || "Tavily could not complete this search.")
        error.statusCode = response.status === 429 ? 429 : 502
        throw error
    }

    return (payload.results || [])
        .filter(result => typeof result?.url === "string" && result.url.startsWith("http"))
        .map(toResource)
}

async function findLearningResources({ skill, role }) {
    return searchResources(`Official learning resources, documentation, and certification paths for ${skill} for a ${role}`)
}

async function findCertificationResources({ certification, role }) {
    return searchResources(`Official ${certification} certification page, preparation courses, study resources, and YouTube tutorials for a ${role}`)
}

async function findProjectResources({ project, skills, role }) {
    const skillsText = Array.isArray(skills) && skills.length ? ` using ${skills.join(", ")}` : ""
    return searchResources(`${project}${skillsText}: official documentation, project tutorials, courses, and YouTube videos for a ${role}`)
}

module.exports = { findLearningResources, findCertificationResources, findProjectResources }
