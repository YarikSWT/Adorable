// Outbound email — Phase 11.
//
// Two modes:
//   * SMTP mode  — `SMTP_HOST` is set: build a Nodemailer transport once,
//                  reuse it via globalThis (HMR-safe); failures are logged
//                  but never throw out of the auth flow.
//   * Console mode — fallback for dev when no SMTP is configured: pretty-print
//                    the message to stderr so the verify link can be copied
//                    out of the dev-server log.
//
// We export both a generic `sendEmail` and the two callbacks Better Auth
// expects (`sendVerificationEmail`, `sendResetPassword`) so wiring in
// better-auth.ts is one-liners.

import nodemailer, { type Transporter } from "nodemailer";

type SingletonCache = {
  transport?: Transporter;
  resolved?: boolean;
};
const GLOBAL_KEY = "__adorableMailSingleton" as const;
const g = globalThis as unknown as Record<string, SingletonCache | undefined>;
g[GLOBAL_KEY] ??= {};
const cache = g[GLOBAL_KEY]!;

const getTransport = (): Transporter | null => {
  if (cache.resolved) return cache.transport ?? null;
  cache.resolved = true;
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  cache.transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
  });
  return cache.transport;
};

const fallbackFrom = (): string => {
  const explicit = process.env.EMAIL_FROM;
  if (explicit) return explicit;
  // Dev fallback: derive a no-reply address from BETTER_AUTH_URL host.
  try {
    const host = new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000")
      .hostname;
    return `no-reply@${host}`;
  } catch {
    return "no-reply@localhost";
  }
};

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export const sendEmail = async (msg: SendEmailInput): Promise<void> => {
  const transport = getTransport();
  if (!transport) {
    console.error(
      "[mail:console] (no SMTP configured)\n" +
        `  TO:      ${msg.to}\n` +
        `  FROM:    ${fallbackFrom()}\n` +
        `  SUBJECT: ${msg.subject}\n` +
        `  TEXT:\n${msg.text}\n`,
    );
    return;
  }
  try {
    await transport.sendMail({
      from: fallbackFrom(),
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
  } catch (err) {
    // Auth flow continues; the user just won't get the message — operations
    // can re-trigger from the UI.
    console.error("[mail] sendMail failed", { to: msg.to, err });
  }
};

const verifySubject = "Подтвердите email в Adorable";
const verifyBody = (url: string) => `Здравствуйте!

Вы (или кто-то с вашими данными) запросили подтверждение email-адреса в Adorable.
Если это были вы — перейдите по ссылке ниже:

${url}

Если вы ничего не запрашивали — просто проигнорируйте это письмо.

— Adorable
`;

const resetSubject = "Сброс пароля в Adorable";
const resetBody = (url: string) => `Здравствуйте!

Вы запросили сброс пароля. Чтобы задать новый пароль, перейдите по ссылке:

${url}

Если запрос не ваш — проигнорируйте это письмо, ваш текущий пароль не изменится.

— Adorable
`;

export const sendVerificationEmail = async (data: {
  user: { email: string };
  url: string;
}): Promise<void> => {
  await sendEmail({
    to: data.user.email,
    subject: verifySubject,
    text: verifyBody(data.url),
  });
};

export const sendResetPasswordEmail = async (data: {
  user: { email: string };
  url: string;
}): Promise<void> => {
  await sendEmail({
    to: data.user.email,
    subject: resetSubject,
    text: resetBody(data.url),
  });
};

export const __resetMailSingletonForTests = (): void => {
  cache.transport = undefined;
  cache.resolved = false;
};
