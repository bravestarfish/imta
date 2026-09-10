import nodemailer, { type Transporter } from "nodemailer";
import { env, providerEnabled } from "@/lib/env";
import { log } from "@/lib/log";

let transporter: Transporter | null | undefined;

function getTransport(): Transporter | null {
  if (transporter !== undefined) return transporter;
  if (!providerEnabled.email()) {
    transporter = null;
    return null;
  }
  transporter = nodemailer.createTransport(env().SMTP_URL);
  return transporter;
}

export type Mail = {
  to: { email: string; name?: string };
  subject: string;
  text: string;
  html?: string;
  ics?: { content: string; method: "REQUEST" | "CANCEL" };
  replyTo?: string;
};

export async function sendMail(mail: Mail): Promise<{ ok: boolean; error?: string }> {
  const t = getTransport();
  if (!t) {
    log.info("email disabled (no SMTP_URL); would send", { to: mail.to.email, subject: mail.subject });
    return { ok: false, error: "email disabled" };
  }
  try {
    await t.sendMail({
      from: env().EMAIL_FROM,
      to: mail.to.name ? `"${mail.to.name.replace(/"/g, "")}" <${mail.to.email}>` : mail.to.email,
      replyTo: mail.replyTo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html ?? textToHtml(mail.text),
      ...(mail.ics
        ? {
            icalEvent: { method: mail.ics.method, content: mail.ics.content, filename: "invite.ics" },
            alternatives: [{ contentType: `text/calendar; method=${mail.ics.method}; charset=utf-8`, content: mail.ics.content }],
          }
        : {}),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function textToHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const linked = esc.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>');
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:600px;margin:0 auto;padding:24px"><pre style="white-space:pre-wrap;font-family:inherit">${linked}</pre></body></html>`;
}
