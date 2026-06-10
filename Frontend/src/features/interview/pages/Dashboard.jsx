import React, { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useInterview } from '../hooks/useInterview'
import '../style/dashboard.scss'

const Dashboard = () => {
    const { reports, loading, getReports } = useInterview()
    const navigate = useNavigate()

    useEffect(() => {
        getReports()
    }, [])

    if (loading) {
        return (
            <main className='loading-screen'>
                <h1>Loading your interview plans...</h1>
            </main>
        )
    }

    return (
        <div className='dashboard-page'>
            <header className='dashboard-header'>
                <h1>My Interview Plans</h1>
                <p>Track all your interview preparations and practice sessions</p>
            </header>

            {reports && reports.length > 0 ? (
                <div className='dashboard-grid'>
                    {reports.map(report => (
                        <div
                            key={report._id}
                            className='report-card'
                            onClick={() => navigate(`/interview/${report._id}`)}
                        >
                            <div className='report-card__header'>
                                <h2 className='report-card__title'>{report.title || 'Untitled'}</h2>
                                <span className={`match-badge match-badge--${
                                    report.matchScore >= 75 ? 'high' :
                                    report.matchScore >= 60 ? 'mid' : 'low'
                                }`}>
                                    {report.matchScore}%
                                </span>
                            </div>

                            <div className='report-card__body'>
                                <div className='stat'>
                                    <span className='stat__icon'>❓</span>
                                    <div>
                                        <p className='stat__label'>Questions</p>
                                        <p className='stat__value'>{(report.technicalQuestions?.length || 0) + (report.behavioralQuestions?.length || 0)}</p>
                                    </div>
                                </div>

                                <div className='stat'>
                                    <span className='stat__icon'>🎯</span>
                                    <div>
                                        <p className='stat__label'>Skill Gaps</p>
                                        <p className='stat__value'>{report.skillGaps?.length || 0}</p>
                                    </div>
                                </div>

                                <div className='stat'>
                                    <span className='stat__icon'>📅</span>
                                    <div>
                                        <p className='stat__label'>Plan Days</p>
                                        <p className='stat__value'>{report.preparationPlan?.length || 0}</p>
                                    </div>
                                </div>
                            </div>

                            <div className='report-card__footer'>
                                <p className='report-card__date'>
                                    {new Date(report.createdAt).toLocaleDateString('en-US', {
                                        month: 'short',
                                        day: 'numeric',
                                        year: 'numeric'
                                    })}
                                </p>
                                <button className='view-btn'>View Plan →</button>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className='empty-state'>
                    <span className='empty-state__icon'>📭</span>
                    <h2>No Interview Plans Yet</h2>
                    <p>Start by creating your first interview preparation plan</p>
                    <button className='btn-primary' onClick={() => navigate('/')}>
                        Create Plan
                    </button>
                </div>
            )}
        </div>
    )
}

export default Dashboard
