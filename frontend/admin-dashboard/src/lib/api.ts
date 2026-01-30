import axios from 'axios'

// Use relative URL to go through Vite proxy (dev) or nginx (prod)
// This avoids CORS issues by keeping same-origin
const getApiBaseUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL
  if (envUrl) {
    // If env var is set, ensure it ends with /api
    return envUrl.endsWith('/api') ? envUrl : `${envUrl}/api`
  }
  // Default to relative URL (goes through proxy)
  return '/api'
}

const API_BASE_URL = getApiBaseUrl()

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Add auth token to requests and handle FormData
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  
  // Delete Content-Type for FormData to let axios set it with proper boundary
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type']
  }
  
  return config
})

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Try to refresh token
      const refreshToken = localStorage.getItem('refresh_token')
      
      if (refreshToken && !error.config._retry) {
        error.config._retry = true
        
        try {
          const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
            refresh_token: refreshToken,
          })
          
          const { access_token, refresh_token } = response.data
          localStorage.setItem('access_token', access_token)
          localStorage.setItem('refresh_token', refresh_token)
          
          error.config.headers.Authorization = `Bearer ${access_token}`
          return api(error.config)
        } catch {
          // Refresh failed, clear tokens and redirect to login
          localStorage.removeItem('access_token')
          localStorage.removeItem('refresh_token')
          window.location.href = '/login'
        }
      } else {
        localStorage.removeItem('access_token')
        localStorage.removeItem('refresh_token')
        window.location.href = '/login'
      }
    }
    
    return Promise.reject(error)
  }
)

export default api

