import { TopBarStatus } from './TopBar'
import clsx from 'clsx'

interface HeaderPlaceholderProps {
  title?: string
  description?: string
  status?: TopBarStatus | null
}

/**
 * HeaderPlaceholder component - displays title and description when navigation bar is at the bottom.
 * This component shows the same title/description that would normally appear in the top bar,
 * but without the navigation buttons.
 */
export default function HeaderPlaceholder({
  title,
  description,
  status,
}: HeaderPlaceholderProps) {
  return (
    <div className="bg-surface border-b border-border shadow-sm">
      <div className="flex items-center">
        {/* Logo section - matches sidebar width for alignment */}
        <div className="hidden md:flex w-64 flex-shrink-0 items-center px-4 py-3 border-r border-border bg-surface">
          <span className="text-xl font-bold text-primary tracking-tight">
            B-IRES
          </span>
        </div>

        {/* Main header content */}
        <div className="flex-1 flex items-center justify-center px-4 py-3">
          {/* Center: Title, description, and status */}
          <div className="flex flex-col items-center justify-center min-w-0">
            {/* Title & Description */}
            {(title || description) && (
              <div className="text-center">
                {title && (
                  <h1 className="text-lg font-semibold text-text-primary truncate max-w-md">
                    {title}
                  </h1>
                )}
                {description && (
                  <p className="text-sm text-text-secondary mt-0.5 truncate max-w-lg">
                    {description}
                  </p>
                )}
              </div>
            )}

            {/* Status message */}
            {status && (
              <div
                className={clsx(
                  'flex items-center gap-2 text-sm mt-1 px-3 py-1 rounded-full',
                  status.type === 'loading' && 'text-text-secondary bg-muted',
                  status.type === 'success' && 'text-success bg-success-light',
                  status.type === 'warning' && 'text-warning bg-warning-light',
                  status.type === 'error' && 'text-error bg-error-light',
                  status.type === 'info' && 'text-info bg-info-light'
                )}
              >
                {/* Default icons based on type */}
                {status.type === 'loading' && !status.icon && (
                  <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                )}
                {status.type === 'success' && !status.icon && (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
                {status.type === 'warning' && !status.icon && (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
                {status.type === 'error' && !status.icon && (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
                {status.type === 'info' && !status.icon && (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
                {status.icon}
                <span>{status.message}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}


