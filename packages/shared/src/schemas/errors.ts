import { z } from 'zod';
import { type ErrorBody, type ErrorCode, ERROR_HTTP_STATUS } from '../errors';

const CODES = Object.keys(ERROR_HTTP_STATUS) as [ErrorCode, ...ErrorCode[]];

/** The body of every error response (spec 11.1), as the OpenAPI document describes it. */
export const ErrorResponse = z
  .object({
    error: z.object({
      code: z.enum(CODES).meta({ description: 'A stable code from spec 11.4' }),
      message: z.string().meta({ description: 'For people; clients show their own translation' }),
      details: z
        .array(z.object({ path: z.string(), issue: z.string() }))
        .optional()
        .meta({ description: 'One entry per invalid field' }),
      requestId: z.string().meta({ description: 'Quote it when reporting a problem' }),
    }),
  })
  .meta({ id: 'Error' }) satisfies z.ZodType<ErrorBody>;
