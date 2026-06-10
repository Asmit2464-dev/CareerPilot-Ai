import '../style/skill-gaps.scss'

const SkillGapsCard = ({ skillGaps }) => {
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
            </div>
            <p className='gap-item__description'>{gap.evidence || defaultDescription[gap.severity]}</p>
            {gap.recommendation && (
                <p className='gap-item__recommendation'>{gap.recommendation}</p>
            )}
            {gap.resumeKeyword && (
                <span className='gap-item__keyword'>{gap.resumeKeyword}</span>
            )}
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
