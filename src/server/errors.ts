// HTTP-style errors used by services. No Next.js imports, so services can also
// run in the standalone AI runner.
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const notFound = (what = "Not found") => new HttpError(404, what);
export const conflict = (msg: string, details?: unknown) => new HttpError(409, msg, details);
