const pdfParse = require("pdf-parse")
const { generateInterviewReport, generateResumePdf } = require("../services/ai.service")
const { findLearningResources, findCertificationResources, findProjectResources } = require("../services/tavily.service")
const interviewReportModel = require("../models/interviewReport.model")




/**
 * @description Controller to generate interview report based on user self description, resume and job description.
 */
async function generateInterViewReportController(req, res) {

    const { selfDescription = "", jobDescription = "" } = req.body

    if (!jobDescription.trim()) {
        return res.status(400).json({
            message: "Job description is required."
        })
    }

    if (!req.file && !selfDescription.trim()) {
        return res.status(400).json({
            message: "Either a resume PDF or self description is required."
        })
    }

    let resumeContent = ""
    if (req.file) {
        const isPdf = req.file.mimetype === "application/pdf" || req.file.originalname.toLowerCase().endsWith(".pdf")
        if (!isPdf) {
            return res.status(400).json({
                message: "Only PDF resumes are supported right now."
            })
        }

        try {
            const pdfData = await pdfParse(req.file.buffer)
            resumeContent = pdfData.text || ""
        } catch (err) {
            console.error("PDF parsing error:", err.message)
            return res.status(400).json({
                message: "Failed to parse resume PDF. Please upload a valid PDF file."
            })
        }
    }

    try {
        const interViewReportByAi = await generateInterviewReport({
            resume: resumeContent,
            selfDescription,
            jobDescription
        })

        const interviewReport = await interviewReportModel.create({
            user: req.user.id,
            resume: resumeContent,
            selfDescription,
            jobDescription,
            ...interViewReportByAi
        })

        return res.status(201).json({
            message: "Interview report generated successfully.",
            interviewReport
        })
    } catch (err) {
        console.error("Interview report generation error:", err)
        return res.status(500).json({
            message: "Failed to generate interview strategy.",
            error: err.message
        })
    }

}

/**
 * @description Controller to get interview report by interviewId.
 */
async function getInterviewReportByIdController(req, res) {

    const { interviewId } = req.params

    const interviewReport = await interviewReportModel.findOne({ _id: interviewId, user: req.user.id })

    if (!interviewReport) {
        return res.status(404).json({
            message: "Interview report not found."
        })
    }

    res.status(200).json({
        message: "Interview report fetched successfully.",
        interviewReport
    })
}


/** 
 * @description Controller to get all interview reports of logged in user.
 */
async function getAllInterviewReportsController(req, res) {
    const interviewReports = await interviewReportModel.find({ user: req.user.id }).sort({ createdAt: -1 }).select("-resume -selfDescription -jobDescription -__v -technicalQuestions -behavioralQuestions -skillGaps -preparationPlan")

    res.status(200).json({
        message: "Interview reports fetched successfully.",
        interviewReports
    })
}

/**
 * @description Find current, external learning resources for a skill gap in an interview report.
 */
async function findSkillGapResourcesController(req, res) {
    const { interviewId } = req.params
    const skill = String(req.body.skill || "").trim()

    if (!skill || skill.length > 100) {
        return res.status(400).json({ message: "A valid skill is required." })
    }

    try {
        const interviewReport = await interviewReportModel.findOne({ _id: interviewId, user: req.user.id })

        if (!interviewReport) {
            return res.status(404).json({ message: "Interview report not found." })
        }

        const isSkillGap = interviewReport.skillGaps.some(gap => gap.skill.toLowerCase() === skill.toLowerCase())
        if (!isSkillGap) {
            return res.status(400).json({ message: "This skill is not a gap in the selected interview report." })
        }

        const resources = await findLearningResources({ skill, role: interviewReport.title })
        return res.status(200).json({ message: "Learning resources found.", resources })
    } catch (err) {
        console.error("Skill resource search error:", err.message)
        return res.status(err.statusCode || 500).json({
            message: err.statusCode === 503 ? "Resource search is not configured yet." : "Failed to find learning resources."
        })
    }
}

/**
 * @description Find current, external resources for a certificate or recommended project.
 */
async function findReportItemResourcesController(req, res) {
    const { interviewId } = req.params
    const resourceType = String(req.body.resourceType || "").trim()
    const itemName = String(req.body.itemName || "").trim()

    if (![ "certificate", "project" ].includes(resourceType) || !itemName || itemName.length > 180) {
        return res.status(400).json({ message: "A valid report item is required." })
    }

    try {
        const interviewReport = await interviewReportModel.findOne({ _id: interviewId, user: req.user.id })
        if (!interviewReport) {
            return res.status(404).json({ message: "Interview report not found." })
        }

        const isCertificate = resourceType === "certificate"
        const reportItem = isCertificate
            ? interviewReport.certifications.find(certification => certification.name.toLowerCase() === itemName.toLowerCase())
            : interviewReport.recommendedProjects.find(project => project.title.toLowerCase() === itemName.toLowerCase())

        if (!reportItem) {
            return res.status(400).json({ message: "This item is not part of the selected interview report." })
        }

        const resources = isCertificate
            ? await findCertificationResources({ certification: reportItem.name, role: interviewReport.title })
            : await findProjectResources({ project: reportItem.title, skills: reportItem.skillsAddressed, role: interviewReport.title })

        return res.status(200).json({ message: "Current resources found.", resources })
    } catch (err) {
        console.error("Report item resource search error:", err.message)
        return res.status(err.statusCode || 500).json({
            message: err.statusCode === 503 ? "Resource search is not configured yet." : "Failed to find current resources."
        })
    }
}


/**
 * @description Controller to generate resume PDF based on user self description, resume and job description.
 */
async function generateResumePdfController(req, res) {
    const { interviewReportId } = req.params

    try {
        const interviewReport = await interviewReportModel.findOne({ _id: interviewReportId, user: req.user.id })

        if (!interviewReport) {
            return res.status(404).json({
                message: "Interview report not found."
            })
        }

        const { resume, jobDescription, selfDescription, title, matchScore, skillGaps, preparationPlan, professionalSummary, certifications, recommendedProjects } = interviewReport

        const pdfBuffer = await generateResumePdf({
            resume,
            jobDescription,
            selfDescription,
            title,
            matchScore,
            skillGaps,
            preparationPlan,
            professionalSummary,
            certifications,
            recommendedProjects
        })

        res.set({
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename=resume_${interviewReportId}.pdf`,
            "Content-Length": pdfBuffer.length,
            "Content-Transfer-Encoding": "binary",
            "Cache-Control": "no-store"
        })

        return res.send(pdfBuffer)
    } catch (err) {
        console.error("Resume PDF generation error:", err)
        return res.status(500).json({
            message: "Failed to generate resume PDF."
        })
    }
}

module.exports = { generateInterViewReportController, getInterviewReportByIdController, getAllInterviewReportsController, findSkillGapResourcesController, findReportItemResourcesController, generateResumePdfController }
