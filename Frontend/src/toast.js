// Simple toast notification system
class Toast {
    static show(message, type = 'success', duration = 3000) {
        const container = this.getContainer()
        
        const toast = document.createElement('div')
        toast.className = `toast toast--${type}`
        toast.innerHTML = `
            <div class="toast__content">
                <span class="toast__icon">${this.getIcon(type)}</span>
                <p class="toast__message">${message}</p>
            </div>
        `
        
        container.appendChild(toast)
        setTimeout(() => toast.classList.add('toast--show'), 10)
        
        setTimeout(() => {
            toast.classList.remove('toast--show')
            setTimeout(() => toast.remove(), 300)
        }, duration)
    }

    static success(message) { this.show(message, 'success') }
    static error(message) { this.show(message, 'error', 5000) }
    static info(message) { this.show(message, 'info') }

    static getContainer() {
        let container = document.querySelector('.toast-container')
        if (!container) {
            container = document.createElement('div')
            container.className = 'toast-container'
            document.body.appendChild(container)
        }
        return container
    }

    static getIcon(type) {
        return { success: '✓', error: '✕', info: 'ℹ' }[type] || '•'
    }
}

export default Toast
