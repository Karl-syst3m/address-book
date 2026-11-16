/**
 * 业务错误：携带 HTTP 状态码，由统一的错误中间件转换为 { error } JSON。
 */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function badRequest(message) {
  return new ApiError(400, message);
}

export function notFound(message = '资源不存在') {
  return new ApiError(404, message);
}
