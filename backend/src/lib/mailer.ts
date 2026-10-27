import nodemailer from 'nodemailer';
import type { Env } from '../config/env';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
  /** Only populated in tests. */
  readonly sent: Mail[];
}

export function createMailer(env: Env): Mailer {
  const sent: Mail[] = [];
  if (env.NODE_ENV === 'test') {
    return {
      sent,
      async send(mail) {
        sent.push(mail);
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return {
    sent,
    async send(mail) {
      await transport.sendMail({ from: env.MAIL_FROM, ...mail });
    },
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Minimal branded HTML email with a single call-to-action button. */
export function actionEmail(opts: {
  title: string;
  intro: string;
  cta: string;
  url: string;
  outro?: string;
}) {
  const text = `${opts.title}\n\n${opts.intro}\n\n${opts.cta}: ${opts.url}\n\n${opts.outro ?? ''}`.trim();
  const html = `<!doctype html><html><body style="margin:0;background:#f4f8fd;font-family:Segoe UI,Arial,sans-serif;color:#13213f">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="100%" style="max-width:480px;background:#fff;border-radius:24px;padding:32px" cellpadding="0" cellspacing="0">
<tr><td style="font-size:22px;font-weight:700;color:#1ba8e0">⚡ VOLTIX</td></tr>
<tr><td style="padding-top:20px;font-size:20px;font-weight:700">${esc(opts.title)}</td></tr>
<tr><td style="padding-top:12px;font-size:15px;line-height:1.6;color:#4a5a7a">${esc(opts.intro)}</td></tr>
<tr><td style="padding-top:24px"><a href="${esc(opts.url)}" style="display:inline-block;background:#1ba8e0;color:#fff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600">${esc(opts.cta)}</a></td></tr>
${opts.outro ? `<tr><td style="padding-top:24px;font-size:13px;color:#7a88a6">${esc(opts.outro)}</td></tr>` : ''}
</table></td></tr></table></body></html>`;
  return { text, html };
}
