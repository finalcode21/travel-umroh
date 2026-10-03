/**
 * Standard application error with machine-readable code.
 * Maps to HTTP status for API routes and to structured results for actions.
 */
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "SUBSCRIPTION_REQUIRED",
  "MODULE_DEPENDENCY",
  "MODULE_INSTALL_ERROR",
  "RATE_LIMITED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SUBSCRIPTION_REQUIRED: 402,
  MODULE_DEPENDENCY: 409,
  MODULE_INSTALL_ERROR: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export function errorStatus(e: unknown): number {
  if (e instanceof AppError) return e.status;
  return 500;
}

/** Human-friendly default messages per code (id locale). */
export const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: "Data tidak valid.",
  UNAUTHENTICATED: "Sesi berakhir. Silakan login kembali.",
  FORBIDDEN: "Anda tidak memiliki akses untuk aksi ini.",
  NOT_FOUND: "Data tidak ditemukan.",
  CONFLICT: "Terjadi konflik data.",
  SUBSCRIPTION_REQUIRED: "Langganan modul tidak aktif.",
  MODULE_DEPENDENCY: "Dependensi modul belum terpenuhi.",
  MODULE_INSTALL_ERROR: "Instalasi modul gagal.",
  RATE_LIMITED: "Terlalu banyak permintaan. Coba lagi nanti.",
  INTERNAL: "Terjadi kesalahan internal.",
};

export function toPublicError(e: unknown): {
  code: ErrorCode;
  message: string;
  details?: unknown;
} {
  if (e instanceof AppError) {
    return { code: e.code, message: e.message, details: e.details };
  }
  console.error("[unhandled error]", e);
  return { code: "INTERNAL", message: DEFAULT_MESSAGES.INTERNAL };
}
