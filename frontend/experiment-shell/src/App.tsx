import { Routes, Route } from 'react-router-dom'
import { useEffect } from 'react'
import ExperimentPage from './pages/ExperimentPage'
import CompletePage from './pages/CompletePage'
import ErrorPage from './pages/ErrorPage'
import { useSessionStore } from './store/sessionStore'

function App() {
  const { isOffline, setOnlineStatus } = useSessionStore()

  useEffect(() => {
    // Monitor online/offline status
    const handleOnline = () => setOnlineStatus(true)
    const handleOffline = () => setOnlineStatus(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Initial check
    setOnlineStatus(navigator.onLine)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [setOnlineStatus])

  return (
    <div className="min-h-screen bg-background text-text-primary font-body">
      {isOffline && (
        <div className="fixed top-0 left-0 right-0 bg-warning text-text-inverse text-center py-2 z-50">
          You are offline. Your progress will be saved and synced when you reconnect.
        </div>
      )}
      <Routes>
        <Route path="/experiment/:experimentId" element={<ExperimentPage />} />
        <Route path="/complete" element={<CompletePage />} />
        <Route path="/error" element={<ErrorPage />} />
        <Route path="*" element={<ExperimentPage />} />
      </Routes>
    </div>
  )
}

export default App



