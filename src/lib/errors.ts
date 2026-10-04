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
  // ---- Phase 2: module lifecycle error codes (PRD §31) ----
  "MODULE_NOT_FOUND",
  "MODULE_ALREADY_INSTALLED",
  "MODULE_ALREADY_ENABLED",
  "MODULE_ALREADY_DISABLED",
  "MODULE_NOT_INSTALLED",
  "MODULE_DEPENDENCY_MISSING",
  "MODULE_INVALID_DEPENDENCY",
  "MODULE_DEPENDENCY_DISABLED",
  "MODULE_DEPENDENCY_VERSION_MISMATCH",
  "MODULE_CIRCULAR_DEPENDENCY",
  "MODULE_SUBSCRIPTION_REQUIRED",
  "MODULE_INSTALL_FAILED",
  "MODULE_UPGRADE_FAILED",
  "MODULE_UNINSTALL_BLOCKED",
  "MODULE_UNINSTALL_CONFIRMATION_REQUIRED",
  "MODULE_INVALID_MANIFEST",
  "MODULE_PERMISSION_CONFLICT",
  "MODULE_CONFIGURATION_INVALID",
  "MODULE_OPERATION_IN_PROGRESS",
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
  // Phase 2 module lifecycle codes
  MODULE_NOT_FOUND: 404,
  MODULE_ALREADY_INSTALLED: 409,
  MODULE_ALREADY_ENABLED: 409,
  MODULE_ALREADY_DISABLED: 409,
  MODULE_NOT_INSTALLED: 409,
  MODULE_DEPENDENCY_MISSING: 409,
  MODULE_INVALID_DEPENDENCY: 422,
  MODULE_DEPENDENCY_DISABLED: 409,
  MODULE_DEPENDENCY_VERSION_MISMATCH: 409,
  MODULE_CIRCULAR_DEPENDENCY: 409,
  MODULE_SUBSCRIPTION_REQUIRED: 402,
  MODULE_INSTALL_FAILED: 422,
  MODULE_UPGRADE_FAILED: 422,
  MODULE_UNINSTALL_BLOCKED: 409,
  MODULE_UNINSTALL_CONFIRMATION_REQUIRED: 400,
  MODULE_INVALID_MANIFEST: 422,
  MODULE_PERMISSION_CONFLICT: 409,
  MODULE_CONFIGURATION_INVALID: 400,
  MODULE_OPERATION_IN_PROGRESS: 409,
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
  // Phase 2 module lifecycle messages
  MODULE_NOT_FOUND: "Modul tidak ditemukan.",
  MODULE_ALREADY_INSTALLED: "Modul sudah ter-install.",
  MODULE_ALREADY_ENABLED: "Modul sudah aktif.",
  MODULE_ALREADY_DISABLED: "Modul sudah nonaktif.",
  MODULE_NOT_INSTALLED: "Modul belum ter-install.",
  MODULE_DEPENDENCY_MISSING: "Dependensi modul belum ter-install.",
  MODULE_INVALID_DEPENDENCY: "Dependensi modul tidak valid.",
  MODULE_DEPENDENCY_DISABLED: "Dependensi modul belum aktif.",
  MODULE_DEPENDENCY_VERSION_MISMATCH: "Versi dependensi tidak kompatibel.",
  MODULE_CIRCULAR_DEPENDENCY: "Dependensi modul membentuk lingkaran.",
  MODULE_SUBSCRIPTION_REQUIRED: "Langganan modul tidak aktif.",
  MODULE_INSTALL_FAILED: "Instalasi modul gagal.",
  MODULE_UPGRADE_FAILED: "Upgrade modul gagal.",
  MODULE_UNINSTALL_BLOCKED: "Uninstall diblokir oleh modul lain.",
  MODULE_UNINSTALL_CONFIRMATION_REQUIRED: "Konfirmasi diperlukan untuk uninstall ini.",
  MODULE_INVALID_MANIFEST: "Manifest modul tidak valid.",
  MODULE_PERMISSION_CONFLICT: "Permission modul bentrok.",
  MODULE_CONFIGURATION_INVALID: "Konfigurasi modul tidak valid.",
  MODULE_OPERATION_IN_PROGRESS: "Operasi modul sedang berlangsung.",
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
