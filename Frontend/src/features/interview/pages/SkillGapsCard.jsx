import '../style/skill-gaps.scss'

const SkillGapsCard = ({ skillGaps, skillResources = {}, resourceLoading = {}, resourceErrors = {}, onFindResources }) => {
    if (!skillGaps || skillGaps.length === 0) {
        return <p className='no-data'>No skill gaps identified</p>
    }

    const groupedByGaps = {
        high: skillGaps.filter(s => s.severity === 'high'),
        medium: skillGaps.filter(s => s.severity === 'medium'),
        low: skillGaps.filter(s => s.severity === 'low')
    }

    const defaultDescription = {
        high: 'Critical for this role',
        medium: 'Important for growth',
        low: 'Nice to have'
    }

    const renderGap = (gap, i) => (
        <div key={`${gap.skill}-${i}`} className={`gap-item gap-item--${gap.severity}`}>
            <div className='gap-item__header'>
                <span className={`gap-item__icon gap-item__icon--${gap.severity}`} />
                <span className='gap-item__skill'>{gap.skill}</span>
                {gap.estimatedLearningTime && (
                    <span className='gap-item__time-badge'>
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="gap-item__time-icon"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        {gap.estimatedLearningTime}
                    </span>
                )}
            </div>
            
            <div className='gap-item__section'>
                <span className='gap-item__label'>Why it's a gap:</span>
                <p className='gap-item__description'>{gap.explanation || gap.evidence || defaultDescription[gap.severity]}</p>
            </div>

            {gap.interviewImpact && (
                <div className='gap-item__section'>
                    <span className='gap-item__label'>Interview Impact:</span>
                    <p className='gap-item__impact'>{gap.interviewImpact}</p>
                </div>
            )}
            
            {gap.projectSuggestion && (
                <div className='gap-item__project-box'>
                    <div className='gap-item__project-header'>
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="gap-item__project-icon"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>
                        <span className='gap-item__project-title'>Suggested Project</span>
                    </div>
                    <p className='gap-item__project-text'>{gap.projectSuggestion}</p>
                </div>
            )}
            
            {gap.recommendation && (
                <div className='gap-item__section'>
                    <span className='gap-item__label'>Action Plan:</span>
                    <p className='gap-item__recommendation'>{gap.recommendation}</p>
                </div>
            )}
            
            {gap.resumeKeyword && (
                <div className='gap-item__keyword-container'>
                    <span className='gap-item__keyword'>{gap.resumeKeyword}</span>
                </div>
            )}

            <div className='gap-item__resources'>
                <button
                    type='button'
                    className='gap-item__resources-button'
                    onClick={() => onFindResources(gap.skill)}
                    disabled={resourceLoading[gap.skill]}
                >
                    {resourceLoading[gap.skill] ? 'Finding resources...' : 'Find current resources'}
                </button>

                {resourceErrors[gap.skill] && <p className='gap-item__resources-error'>{resourceErrors[gap.skill]}</p>}

                {skillResources[gap.skill]?.length > 0 && (
                    <ul className='gap-item__resources-list'>
                        {skillResources[gap.skill].map((resource, resourceIndex) => (
                            <li key={`${resource.url}-${resourceIndex}`}>
                                <a href={resource.url} target='_blank' rel='noreferrer'>{resource.title}</a>
                                {resource.content && <p>{resource.content}</p>}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    )

    return (
        <div className='skill-gaps-card'>
            <h2>Skill Gaps Analysis</h2>
            <p className='subtitle'>Based on the job description and candidate profile</p>

            {groupedByGaps.high.length > 0 && (
                <div className='gaps-section'>
                    <h3 className='gaps-section__title gaps-section__title--high'>
                        <span className='severity-badge severity-badge--high'>HIGH PRIORITY</span>
                    </h3>
                    <div className='gaps-grid'>
                        {groupedByGaps.high.map(renderGap)}
                    </div>
                </div>
            )}

            {groupedByGaps.medium.length > 0 && (
                <div className='gaps-section'>
                    <h3 className='gaps-section__title gaps-section__title--medium'>
                        <span className='severity-badge severity-badge--medium'>MEDIUM PRIORITY</span>
                    </h3>
                    <div className='gaps-grid'>
                        {groupedByGaps.medium.map(renderGap)}
                    </div>
                </div>
            )}

            {groupedByGaps.low.length > 0 && (
                <div className='gaps-section'>
                    <h3 className='gaps-section__title gaps-section__title--low'>
                        <span className='severity-badge severity-badge--low'>LOW PRIORITY</span>
                    </h3>
                    <div className='gaps-grid'>
                        {groupedByGaps.low.map(renderGap)}
                    </div>
                </div>
            )}
        </div>
    )
}

export default SkillGapsCard
