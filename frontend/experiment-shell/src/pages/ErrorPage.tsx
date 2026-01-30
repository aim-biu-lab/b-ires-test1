import { useSearchParams } from 'react-router-dom'

export default function ErrorPage() {
  const [searchParams] = useSearchParams()
  const errorMessage = searchParams.get('message') || 'An unexpected error occurred'

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="card max-w-md w-full text-center">
        <div className="mb-6">
          <div className="w-16 h-16 mx-auto bg-error-light rounded-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-error"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
        </div>

        <h1 className="text-2xl font-semibold mb-2">Something went wrong</h1>
        <p className="text-text-secondary mb-6">{errorMessage}</p>

        <button
          onClick={() => window.location.href = '/'}
          className="btn btn-primary"
        >
          Try Again
        </button>
      </div>
    </div>
  )
}



