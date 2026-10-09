import { AppError } from '../lib/errors.js';

/** validate({ body, params, query }) with Zod schemas. Parsed (and stripped/normalised) values replace the originals. */
export const validate = (schemas) => (req, _res, next) => {
  for (const part of ['params', 'query', 'body']) {
    if (!schemas[part]) continue;
    const result = schemas[part].safeParse(req[part]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return next(new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', details));
    }
    req[part] = result.data;
  }
  next();
};
