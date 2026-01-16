import { validateFile } from '../middleware/validateFile'
import { Request, Response, NextFunction } from 'express'

describe('File Validation Middleware', () => {
  let mockRequest: Partial<Request>
  let mockResponse: Partial<Response>
  let nextFunction: NextFunction

  beforeEach(() => {
    mockRequest = {}
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    }
    nextFunction = jest.fn()
  })

  it('should reject request without file', () => {
    mockRequest.file = undefined

    validateFile(mockRequest as Request, mockResponse as Response, nextFunction)

    expect(mockResponse.status).toHaveBeenCalledWith(400)
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: 'No file uploaded',
    })
    expect(nextFunction).not.toHaveBeenCalled()
  })

  it('should accept valid PNG file', () => {
    mockRequest.file = {
      mimetype: 'image/png',
      size: 1024 * 1024, // 1MB
      filename: 'test.png',
      originalname: 'test.png',
      path: '/tmp/test.png',
    } as Express.Multer.File

    validateFile(mockRequest as Request, mockResponse as Response, nextFunction)

    expect(nextFunction).toHaveBeenCalled()
    expect(mockResponse.status).not.toHaveBeenCalled()
  })

  it('should accept valid JPG file', () => {
    mockRequest.file = {
      mimetype: 'image/jpeg',
      size: 1024 * 1024,
      filename: 'test.jpg',
      originalname: 'test.jpg',
      path: '/tmp/test.jpg',
    } as Express.Multer.File

    validateFile(mockRequest as Request, mockResponse as Response, nextFunction)

    expect(nextFunction).toHaveBeenCalled()
  })

  it('should reject invalid file type', () => {
    mockRequest.file = {
      mimetype: 'application/pdf',
      size: 1024,
      filename: 'test.pdf',
      originalname: 'test.pdf',
      path: '/tmp/test.pdf',
    } as Express.Multer.File

    validateFile(mockRequest as Request, mockResponse as Response, nextFunction)

    expect(mockResponse.status).toHaveBeenCalledWith(400)
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: 'Invalid file type. Only PNG, JPG, and JPEG are allowed',
    })
  })

  it('should reject file exceeding size limit', () => {
    mockRequest.file = {
      mimetype: 'image/png',
      size: 6 * 1024 * 1024, // 6MB
      filename: 'large.png',
      originalname: 'large.png',
      path: '/tmp/large.png',
    } as Express.Multer.File

    validateFile(mockRequest as Request, mockResponse as Response, nextFunction)

    expect(mockResponse.status).toHaveBeenCalledWith(400)
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: 'File size exceeds 5MB limit',
    })
  })
})
