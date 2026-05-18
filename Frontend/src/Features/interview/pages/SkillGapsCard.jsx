import React from 'react'
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

    return (
        <div className='skill-gaps-card'>
            <h2>Skill Gaps Analysis</h2>
            <p className='subtitle'>Focus on high-priority areas first</p>

            {/* High Priority */}
            {groupedByGaps.high.length > 0 && (
                <div className='gaps-section'>
                    <h3 className='gaps-section__title gaps-section__title--high'>
                        <span className='severity-badge severity-badge--high'>HIGH PRIORITY</span>
                    </h3>
                    <div className='gaps-grid'>
                        {groupedByGaps.high.map((gap, i) => (
                            <div key={i} className='gap-item gap-item--high'>
                                <div className='gap-item__header'>
                                    <span className='gap-item__icon'>🔴</span>
                                    <span className='gap-item__skill'>{gap.skill}</span>
                                </div>
                                <p className='gap-item__description'>Critical for this role</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Medium Priority */}
            {groupedByGaps.medium.length > 0 && (
                <div className='gaps-section'>
                    <h3 className='gaps-section__title gaps-section__title--medium'>
                        <span className='severity-badge severity-badge--medium'>MEDIUM PRIORITY</span>
                    </h3>
                    <div className='gaps-grid'>
                        {groupedByGaps.medium.map((gap, i) => (
                            <div key={i} className='gap-item gap-item--medium'>
                                <div className='gap-item__header'>
                                    <span className='gap-item__icon'>🟡</span>
                                    <span className='gap-item__skill'>{gap.skill}</span>
                                </div>
                                <p className='gap-item__description'>Important for growth</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Low Priority */}
            {groupedByGaps.low.length > 0 && (
                <div className='gaps-section'>
                    <h3 className='gaps-section__title gaps-section__title--low'>
                        <span className='severity-badge severity-badge--low'>LOW PRIORITY</span>
                    </h3>
                    <div className='gaps-grid'>
                        {groupedByGaps.low.map((gap, i) => (
                            <div key={i} className='gap-item gap-item--low'>
                                <div className='gap-item__header'>
                                    <span className='gap-item__icon'>🟢</span>
                                    <span className='gap-item__skill'>{gap.skill}</span>
                                </div>
                                <p className='gap-item__description'>Nice to have</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

export default SkillGapsCard
