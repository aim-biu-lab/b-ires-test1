export default function CompletePage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="card max-w-md w-full text-center">
        <div className="mb-6">
          <div className="w-16 h-16 mx-auto bg-success-light rounded-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-success"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
        </div>

        <h1 className="text-2xl font-semibold mb-2">Thank You!</h1>
        <p className="text-text-secondary mb-6">
          Your responses have been recorded successfully. You may now close this window.
        </p>

        <p className="text-sm text-text-tertiary">
          If you have any questions about this study, please contact the research team.
        </p>
      </div>
    </div>
  )
}
