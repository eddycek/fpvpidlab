import type { Env } from './types';

interface EmailParams {
  to: string;
  subject: string;
  html: string;
}

/**
 * Send an email via Resend API.
 * Fire-and-forget: logs errors but does not throw.
 */
export async function sendEmail(env: Env, params: EmailParams): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    console.warn('Email skipped: RESEND_API_KEY or RESEND_FROM_EMAIL not configured');
    return false;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL,
        to: [params.to],
        subject: params.subject,
        html: params.html,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'unknown');
      console.error(`Resend API error ${response.status}: ${text}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Failed to send email:', err);
    return false;
  }
}

export function confirmationEmail(name: string): { subject: string; html: string } {
  return {
    subject: 'FPVPIDlab Beta — Application Received',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1a1a2e;">FPVPIDlab Beta</h2>
        <p>Thanks <strong>${escapeHtml(name)}</strong>!</p>
        <p>You've been added to the FPVPIDlab beta waitlist. We'll review your application and get back to you soon.</p>
        <p style="color: #666; font-size: 14px; margin-top: 30px;">— The FPVPIDlab Team</p>
      </div>
    `,
  };
}

export function approvalEmail(
  name: string,
  licenseKey: string
): { subject: string; html: string } {
  return {
    subject: 'FPVPIDlab Beta — You\'re Approved!',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1a1a2e;">FPVPIDlab Beta</h2>
        <p>Congratulations <strong>${escapeHtml(name)}</strong>!</p>
        <p>You've been approved as a beta tester.</p>
        <div style="background: #f0f4f8; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <p style="margin: 0 0 8px 0; font-size: 14px; color: #666;">Your license key:</p>
          <code style="font-size: 18px; font-weight: bold; color: #1a1a2e; letter-spacing: 1px;">${escapeHtml(licenseKey)}</code>
        </div>
        <h3 style="color: #1a1a2e;">Getting started</h3>
        <ol>
          <li>Download the latest release: <a href="https://github.com/eddycek/fpvpidlab/releases/latest">GitHub Releases</a></li>
          <li>Install and launch FPVPIDlab</li>
          <li>Go to <strong>Settings → License</strong> and paste your key</li>
        </ol>
        <p style="color: #666; font-size: 14px; margin-top: 30px;">— The FPVPIDlab Team</p>
      </div>
    `,
  };
}

export function rejectionEmail(name: string): { subject: string; html: string } {
  return {
    subject: 'FPVPIDlab Beta — Application Update',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1a1a2e;">FPVPIDlab Beta</h2>
        <p>Hi <strong>${escapeHtml(name)}</strong>,</p>
        <p>Thanks for your interest in the FPVPIDlab beta. Unfortunately, we're unable to include you at this time.</p>
        <p>We appreciate your enthusiasm and encourage you to check back in the future.</p>
        <p style="color: #666; font-size: 14px; margin-top: 30px;">— The FPVPIDlab Team</p>
      </div>
    `,
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
