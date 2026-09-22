export class WorkError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
