import axios from "axios";
import { API_BASE_URL } from "../../../config/api";

const api = axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true,
})

const parseBlobErrorMessage = (message) => {
    try {
        return JSON.parse(message).message
    } catch {
        return null
    }
}


/**
 * @description Service to generate interview report based on user self description, resume and job description.
 */
export const generateInterviewReport = async ({ jobDescription, selfDescription, resumeFile }) => {

    const formData = new FormData()
    formData.append("jobDescription", jobDescription)
    formData.append("selfDescription", selfDescription)
    if (resumeFile) {
        formData.append("resume", resumeFile)
    }

    const response = await api.post("/api/interview/", formData, {
        headers: {
            "Content-Type": "multipart/form-data"
        }
    })

    return response.data

}


/**
 * @description Service to get interview report by interviewId.
 */
export const getInterviewReportById = async (interviewId) => {
    const response = await api.get(`/api/interview/report/${interviewId}`)

    return response.data
}


/**
 * @description Service to get all interview reports of logged in user.
 */
export const getAllInterviewReports = async () => {
    const response = await api.get("/api/interview/")

    return response.data
}

/**
 * @description Find current learning resources for a skill gap with Tavily.
 */
export const findSkillGapResources = async ({ interviewId, skill }) => {
    try {
        const response = await api.post(`/api/interview/${interviewId}/research`, { skill })
        return response.data.resources || []
    } catch (error) {
        throw new Error(error.response?.data?.message || "Failed to find learning resources.", { cause: error })
    }
}

export const findReportItemResources = async ({ interviewId, resourceType, itemName }) => {
    try {
        const response = await api.post(`/api/interview/${interviewId}/resources`, { resourceType, itemName })
        return response.data.resources || []
    } catch (error) {
        throw new Error(error.response?.data?.message || "Failed to find current resources.", { cause: error })
    }
}


/**
 * @description Service to generate resume pdf based on user self description, resume content and job description.
 */
export const generateResumePdf = async ({ interviewReportId }) => {
    try {
        const response = await api.post(`/api/interview/resume/pdf/${interviewReportId}`, null, {
            responseType: "blob"
        })

        const contentType = response.headers["content-type"] || "application/pdf"
        const disposition = response.headers["content-disposition"] || ""
        const filenameMatch = disposition.match(/filename="?([^"]+)"?/i)

        return {
            blob: response.data,
            contentType,
            filename: filenameMatch?.[1] || `resume_${interviewReportId}.pdf`
        }
    } catch (error) {
        const errorBlob = error.response?.data

        if (errorBlob instanceof Blob) {
            const message = await errorBlob.text()
            const parsedMessage = parseBlobErrorMessage(message)

            throw new Error(parsedMessage || message || "Failed to generate resume PDF.", { cause: error })
        }

        throw new Error(error.response?.data?.message || error.message || "Failed to generate resume PDF.", { cause: error })
    }
}
