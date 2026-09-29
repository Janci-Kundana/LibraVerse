import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Mail "sent" while NODE_ENV=test, for assertions. */
export const testOutbox: Mail[] = [];

let transporter: Transporter | null = null;

function smtp(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export async function sendMail(mail: Mail): Promise<void> {
  if (env.NODE_ENV === 'test') {
    testOutbox.push(mail);
    return;
  }
  if (!env.SMTP_HOST) {
    if (env.NODE_ENV === 'production') throw new Error('SMTP_HOST is not configured');
    console.log(
      `\n--- email (SMTP not configured) ---\nTo: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n---\n`,
    );
    return;
  }
  await smtp().sendMail({ from: env.MAIL_FROM, ...mail });
}
