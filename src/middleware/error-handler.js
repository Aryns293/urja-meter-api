import { ApiError } from '../errors.js';

export function notFoundHandler(_req, res) {
  res.status(404).json({
    error: { code: 'not_found', message: 'Route not found' },
  });
}

export function errorHandler(error, _req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof URIError) {
    return res.status(400).json({
      error: { code: 'validation_error', message: 'Malformed URL encoding' },
    });
  }

  if (error instanceof ApiError) {
    return res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
  }

  console.error(error);
  res.status(500).json({
    error: { code: 'internal_error', message: 'An unexpected error occurred' },
  });
}
