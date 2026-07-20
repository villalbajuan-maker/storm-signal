import { createAdminClient } from "@/lib/supabase/admin";

type IssueOtpOptions = { allowCreate: boolean };

function resendConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !fromEmail) throw new Error("Resend is not configured.");
  return { apiKey, fromEmail };
}

async function isAuthorizedReturningUser(email: string) {
  const admin = createAdminClient();
  for (let page = 1; page <= 5; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) {
      const { data: membership, error: membershipError } = await admin.from("workspace_members").select("workspace_id").eq("user_id", user.id).eq("status", "active").limit(1).maybeSingle();
      if (membershipError) throw membershipError;
      return Boolean(membership);
    }
    if (data.users.length < 200) break;
  }
  return false;
}

export async function issueEmailOtp(email: string, options: IssueOtpOptions) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!options.allowCreate && !(await isAuthorizedReturningUser(normalizedEmail))) return { sent: false };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: normalizedEmail });
  if (error) throw error;
  const otp = data.properties.email_otp;
  if (!otp) throw new Error("Supabase did not generate an email OTP.");

  const { apiKey, fromEmail } = resendConfig();
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      from: `Storm Signal <${fromEmail}>`,
      to: [normalizedEmail],
      subject: `${otp} is your Storm Signal access code`,
      text: `Your Storm Signal access code is ${otp}. Enter it to verify your email and continue. This code expires shortly and can only be used once.`,
      html: `<div style="font-family:Arial,sans-serif;color:#12202a;max-width:560px;margin:auto;padding:32px"><p style="color:#b36f19;font-size:12px;font-weight:700;letter-spacing:1.5px">STORM SIGNAL</p><h1 style="font-size:28px;margin:22px 0 12px">Your access code</h1><p style="line-height:1.6;color:#536164">Enter this code to verify your email and continue:</p><p style="font-size:34px;font-weight:700;letter-spacing:7px;margin:28px 0">${otp}</p><p style="font-size:13px;line-height:1.6;color:#7a8586">This code expires shortly and can only be used once.</p></div>`,
    }),
  });
  if (!response.ok) throw new Error(`Resend rejected the email request (${response.status}).`);
  return { sent: true };
}
