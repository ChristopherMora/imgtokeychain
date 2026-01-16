import axios from 'axios'

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'

export const api = axios.create({
  baseURL: apiUrl,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Job API
export const jobsApi = {
  create: async (file: File, params: any) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('params', JSON.stringify(params))

    const response = await api.post('/jobs', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
    return response.data
  },

  getStatus: async (jobId: string) => {
    const response = await api.get(`/jobs/${jobId}`)
    return response.data
  },

  download: (jobId: string) => {
    return `${apiUrl}/jobs/${jobId}/download`
  },
}
