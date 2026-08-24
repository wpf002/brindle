import { useDevFallback, identityVerificationEnabled } from "./env.js";

// Identity verification port. Same adapter shape as the payment gateway: a real
// implementation (Persona) and a dev fallback, chosen by whether a key is
// configured, so the rest of the app never has to know which one is live.
export interface IdentityProvider {
  /** Kick off a verification session; the caller redirects the user to inquiryUrl. */
  startInquiry(userId: string, email: string): Promise<{ inquiryUrl: string; ref: string }>;
}

// Dev fallback: no real verification happens. The "inquiry URL" points back at
// an in-app route that immediately marks the user verified, so the rest of the
// product (badges, gated actions) can be exercised without a Persona account.
export class DevIdentityProvider implements IdentityProvider {
  async startInquiry(userId: string): Promise<{ inquiryUrl: string; ref: string }> {
    const ref = `dev_inq_${userId}_${Date.now()}`;
    return { inquiryUrl: `/identity/dev-approve?ref=${ref}`, ref };
  }
}

// Real Persona integration. Requires PERSONA_API_KEY and a configured inquiry
// template (PERSONA_TEMPLATE_ID) in the Persona dashboard. The actual pass/fail
// arrives asynchronously via Persona's webhook (see routes/identity.ts) — this
// call only starts the session.
export class PersonaIdentityProvider implements IdentityProvider {
  constructor(private readonly apiKey: string, private readonly templateId: string) {}

  async startInquiry(userId: string, email: string): Promise<{ inquiryUrl: string; ref: string }> {
    const res = await fetch("https://withpersona.com/api/v1/inquiries", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "Persona-Version": "2023-01-05",
      },
      body: JSON.stringify({
        data: {
          attributes: {
            "inquiry-template-id": this.templateId,
            "reference-id": userId,
            fields: { "email-address": email },
          },
        },
      }),
    });
    if (!res.ok) throw new Error(`Persona inquiry creation failed: ${res.status}`);
    const body = (await res.json()) as { data: { id: string; attributes: { "session-token"?: string } } };
    const ref = body.data.id;
    // Persona's hosted flow is normally opened via their JS SDK using the
    // session-token; a plain URL fallback keeps this usable without the SDK.
    return { inquiryUrl: `https://withpersona.com/verify?inquiry-id=${ref}`, ref };
  }
}

/** Null when this deployment doesn't verify identity at all. */
export function makeIdentityProvider(): IdentityProvider | null {
  // Deliberately off. Not a missing key, so nothing to warn about — and
  // crucially not the self-approving stub either.
  if (!identityVerificationEnabled()) return null;

  const apiKey = process.env.PERSONA_API_KEY;
  const templateId = process.env.PERSONA_TEMPLATE_ID;
  if (!apiKey || !templateId) {
    // Throws on anything that isn't a local dev box. A staging deployment that
    // silently self-approves identity is worse than one that won't start. Set
    // IDENTITY_VERIFICATION_ENABLED=false to run without it on purpose.
    useDevFallback("identity", ["PERSONA_API_KEY", "PERSONA_TEMPLATE_ID"]);
    return new DevIdentityProvider();
  }
  return new PersonaIdentityProvider(apiKey, templateId);
}
