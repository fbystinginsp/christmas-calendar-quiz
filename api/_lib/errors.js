export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Thrown by store drivers: code is 'exists' (unique violation) or 'conflict' (etag mismatch).
export class StoreError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}
