import { Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { useAuthStore } from './store/authStore'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ExperimentsPage from './pages/ExperimentsPage'
import ExperimentEditorPage from './pages/ExperimentEditorPage'
import UsersPage from './pages/UsersPage'
import AssetsPage from './pages/AssetsPage'
import SessionMonitorPage from './pages/SessionMonitorPage'
import LivePreviewPage from './pages/LivePreviewPage'
import ExportPage from './pages/ExportPage'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

function App() {
  return (
    <>
      <Toaster position="bottom-right" richColors />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
      
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/experiments" element={<ExperimentsPage />} />
                <Route path="/experiments/:experimentId" element={<ExperimentEditorPage />} />
                <Route path="/experiments/new" element={<ExperimentEditorPage />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="/assets" element={<AssetsPage />} />
                <Route path="/sessions" element={<SessionMonitorPage />} />
                <Route path="/live" element={<LivePreviewPage />} />
                <Route path="/export" element={<ExportPage />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
      </Routes>
    </>
  )
}

export default App

