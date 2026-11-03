import { ApiError } from '../errors.js';

export function validate(schema, source) {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      return next(new ApiError(400, 'validation_error', 'Request validation failed', details));
    }

    req.validated = { ...req.validated, [source]: result.data };
    next();
  };
}
