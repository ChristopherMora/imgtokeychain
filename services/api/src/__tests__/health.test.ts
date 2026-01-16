import request from 'supertest'
import express from 'express'
import healthRouter from '../routes/health'

describe('Health Check Endpoint', () => {
  let app: express.Application

  beforeAll(() => {
    app = express()
    app.use('/health', healthRouter)
  })

  it('should return 200 and status ok', async () => {
    const response = await request(app)
      .get('/health')
      .expect('Content-Type', /json/)
      .expect(200)

    expect(response.body).toHaveProperty('status', 'ok')
    expect(response.body).toHaveProperty('timestamp')
    expect(response.body).toHaveProperty('uptime')
  })

  it('should have correct response structure', async () => {
    const response = await request(app).get('/health')

    expect(typeof response.body.status).toBe('string')
    expect(typeof response.body.timestamp).toBe('string')
    expect(typeof response.body.uptime).toBe('number')
  })

  it('should return uptime greater than 0', async () => {
    const response = await request(app).get('/health')

    expect(response.body.uptime).toBeGreaterThan(0)
  })

  it('should have valid ISO timestamp', async () => {
    const response = await request(app).get('/health')

    const timestamp = new Date(response.body.timestamp)
    expect(timestamp).toBeInstanceOf(Date)
    expect(timestamp.getTime()).not.toBeNaN()
  })
})
