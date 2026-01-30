import axios from 'axios'

// Use relative URL to go through Vite proxy (dev) or nginx (prod)
// This avoids CORS issues by keeping same-origin
// Only use VITE_API_URL if explicitly set AND includes full path
const getApiBaseUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL
  if (envUrl) {
    // If env var is set, ensure it ends with /api
    return envUrl.endsWith('/api') ? envUrl : `${envUrl}/api`
  }
  // Default to relative URL (goes through proxy)
  return '/api'
}

export const api = axios.create({
  baseURL: getApiBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
})

// Add response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      // Server responded with error status
      const detail = error.response.data?.detail
      let message: string
      if (Array.isArray(detail)) {
        // Pydantic validation errors come as an array
        message = detail.map((err: { loc?: string[]; msg?: string; type?: string }) => 
          `${err.loc?.join('.')}: ${err.msg}`
        ).join('; ')
      } else if (typeof detail === 'string') {
        message = detail
      } else if (detail) {
        message = JSON.stringify(detail)
      } else {
        message = error.response.statusText || 'An error occurred'
      }
      console.error('[API Error]', error.response.status, message, error.response.data)
      throw new Error(message)
    } else if (error.request) {
      // Request made but no response
      throw new Error('Network error - please check your connection')
    } else {
      throw error
    }
  }
)

export default api

