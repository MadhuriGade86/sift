// packages/api/src/lib/email.ts
//
// plan.md assumption #2: email verification, password reset, and invites
// must use a real transactional provider in production — console-logged
// tokens are a dev-only stand-in. This wraps Resend; falls back to a
// clearly-labeled console log if RESEND_API_KEY isn't set, so local dev
// works without an account but production deploy will visibly fail to
// silently no-op (the log warning is impossible to miss in Vercel logs).

interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailArgs): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.warn(
      `[email:DEV-FALLBACK] RESEND_API_KEY not set — email NOT actually sent.\n` +
        `  to: ${to}\n  subject: ${subject}\n  html: ${html}`
    );
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? "Sift <onboarding@resend.dev>",
      to,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to send email via Resend: ${res.status} ${body}`);
  }
}

export function verificationEmailHtml(verifyUrl: string): string {
  return `<p>Welcome to Sift. <a href="${verifyUrl}">Click here to verify your email</a>. This link expires in 30 minutes.</p>`;
}

export function passwordResetEmailHtml(resetUrl: string): string {
  return `<p>Reset your Sift password: <a href="${resetUrl}">click here</a>. This link expires in 30 minutes and can only be used once. If you didn't request this, ignore this email.</p>`;
}

export function inviteEmailHtml(inviteUrl: string, organizationName: string, role: string): string {
  return `<p>You've been invited to join <strong>${organizationName}</strong> on Sift as a <strong>${role}</strong>. <a href="${inviteUrl}">Accept the invite</a>. This link expires in 7 days.</p>`;
}
