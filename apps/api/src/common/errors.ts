import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

/** Yagona xato formati: { code, message, details } */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} topilmadi`);
export const forbidden = () => new AppError(403, 'FORBIDDEN', 'Ruxsat yo\'q');

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Ma\'lumot noto\'g\'ri', r.error.flatten());
  }
  return r.data;
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ code: err.code, message: err.message, details: err.details ?? null });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Ma\'lumot noto\'g\'ri', details: err.flatten() });
  }
  // PostgreSQL xatolarini tushunarli kodlarga aylantirish
  if (err && typeof err.code === 'string') {
    if (err.code === 'P0001' && err.message === 'ROUTINE_LIMIT') {
      return res.status(409).json({ code: 'ROUTINE_LIMIT', message: err.detail ?? err.message, details: { max: 10 } });
    }
    if (err.code === 'P0002') {
      return res.status(409).json({ code: 'AUDIT_IMMUTABLE', message: err.message, details: null });
    }
    if (err.code === '23505') {
      return res.status(409).json({ code: 'DUPLICATE', message: 'Bunday yozuv allaqachon mavjud', details: { constraint: err.constraint } });
    }
    if (err.code === '23514' || err.code === '22P02' || err.code === '22007' || err.code === '22008') {
      return res.status(400).json({ code: 'INVALID_VALUE', message: err.message, details: { constraint: err.constraint ?? null } });
    }
    if (err.code === '23503') {
      return res.status(400).json({ code: 'INVALID_REFERENCE', message: 'Bog\'langan yozuv topilmadi', details: { constraint: err.constraint } });
    }
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ code: 'BAD_JSON', message: 'JSON noto\'g\'ri', details: null });
  }
  console.error(err);
  return res.status(500).json({ code: 'INTERNAL', message: 'Ichki xato', details: null });
}
