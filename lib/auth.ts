import { NextRequest, NextResponse } from "next/server";
import {
  config,
  equal,
  get,
  hash,
  put,
  secret,
  uid,
  remove,
  list,
  transaction,
  checkPassword,
} from "./db";
export type Session = {
  id: string;
  tokenHash: string;
  admin: boolean;
  demoScopes: string[];
  expiresAt: string;
};
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assert(
  condition: unknown,
  status: number,
  message: string,
): asserts condition {
  if (!condition) throw new HttpError(status, message);
}
export function checkOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("host");
  assert(
    origin === `${req.nextUrl.protocol}//${host}` ||
      (!!process.env.APP_ORIGIN && origin === process.env.APP_ORIGIN),
    403,
    "This action must come from the app.",
  );
}
export async function session(req: NextRequest) {
  const token = req.cookies.get("trashme_session")?.value;
  if (!token) return;
  const s = await get<Session>("session", hash(token));
  return s && Date.parse(s.expiresAt) > Date.now() ? s : undefined;
}
export async function ensureSession(req: NextRequest) {
  const existing = await session(req);
  if (existing) return { session: existing, token: null };
  const token = secret(),
    s: Session = {
      id: hash(token),
      tokenHash: hash(token),
      admin: false,
      demoScopes: [],
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    };
  await put("session", s);
  return { session: s, token };
}
export function attachCookie(
  response: NextResponse,
  token: string | null,
  req: NextRequest,
) {
  if (token)
    response.cookies.set("trashme_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure:
        req.nextUrl.protocol === "https:" ||
        req.headers.get("x-forwarded-proto") === "https",
      path: "/",
      maxAge: 7 * 86400,
    });
  return response;
}
export function admin(s: Session) {
  assert(s.admin, 401, "Sign in to management to continue.");
}
export function localSetup(req: NextRequest) {
  assert(
    /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(
      req.headers.get("host") || "",
    ),
    403,
    "Open setup on localhost on the computer running Bin There Done That.",
  );
}
export async function scopeFor(req: NextRequest, s: Session, write = false) {
  const scope = req.nextUrl.searchParams.get("scope") || "public";
  if (scope === "public") return scope;
  assert(scope.startsWith("demo:"), 400, "Invalid scope.");
  const demo = await get<{
    expiresAt: string;
  }>("demo", scope.slice(5));
  assert(
    demo && Date.parse(demo.expiresAt) > Date.now(),
    404,
    "This demo session is missing or has expired.",
  );
  if (write)
    assert(
      s.admin || s.demoScopes.includes(scope),
      403,
      "Open the private scanner link from the demo setup.",
    );
  return scope;
}
export async function newLogin(s: Session) {
  const token = secret();
  const next = { ...s, id: hash(token), tokenHash: hash(token), admin: true };
  await transaction(async () => {
    for (const kind of ["report", "scan", "bin_evidence"])
      for (const value of await list<{
        id: string;
        sessionId: string;
        scope: string;
      }>(kind))
        if (value.sessionId === s.id)
          await put(kind, { ...value, sessionId: next.id }, value.scope);
    await remove("session", s.id);
    await put("session", next);
  });
  return token;
}
export async function validPassword(password: string) {
  return process.env.ADMIN_PASSWORD
    ? equal(password, process.env.ADMIN_PASSWORD)
    : checkPassword(password, (await config()).passwordHash);
}
