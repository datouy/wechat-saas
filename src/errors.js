/**
 * 统一业务错误与错误码
 * - AppError：带业务错误码与 HTTP 状态码的可控异常
 * - 所有对外错误响应统一使用 { success:false, code, error, requestId }
 */
const ERROR_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION: 'VALIDATION',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  INTERNAL: 'INTERNAL',
  PAYMENT: 'PAYMENT'
};

class AppError extends Error {
  constructor(message, { code = 'INTERNAL', status = 400, details = null } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  static badRequest(msg, details) { return new AppError(msg, { code: 'VALIDATION', status: 400, details }); }
  static notFound(msg) { return new AppError(msg, { code: 'NOT_FOUND', status: 404 }); }
  static unauthorized(msg) { return new AppError(msg || '未登录或登录已过期', { code: 'UNAUTHORIZED', status: 401 }); }
  static forbidden(msg) { return new AppError(msg || '无权操作', { code: 'FORBIDDEN', status: 403 }); }
  static conflict(msg) { return new AppError(msg, { code: 'CONFLICT', status: 409 }); }
  static payment(msg) { return new AppError(msg, { code: 'PAYMENT', status: 400 }); }
}

/** 将任意异常归一化为 AppError（供统一错误处理使用） */
function toAppError(err) {
  if (err instanceof AppError) return err;
  if (err && err.name === 'ZodError') {
    const details = (err.issues || []).map(i => ({ path: i.path.join('.'), message: i.message }));
    return AppError.badRequest('参数校验失败', details);
  }
  // 业务层约定直接 throw new Error('中文提示')，统一按 400 处理（带请求ID与错误码，避免泄漏堆栈）
  if (err instanceof Error) return new AppError(err.message, { code: 'BAD_REQUEST', status: 400 });
  return new AppError('服务器内部错误', { code: 'INTERNAL', status: 500 });
}

module.exports = { AppError, toAppError, ERROR_CODES };
