import { prisma, type NotificationType } from "@brindle/db";

// Email fan-out is a pluggable adapter, same shape as the payment gateway and
// identity provider: a real implementation and a dev fallback that just logs.
// The in-app Notification row is always created; email is best-effort on top
// and never blocks or fails the caller.
export interface EmailSender {
  send(to: string, subject: string, body: string): Promise<void>;
}

export class ConsoleEmailSender implements EmailSender {
  async send(to: string, subject: string, body: string): Promise<void> {
    console.log(`[email:dev] to=${to} subject="${subject}"\n${body}\n`);
  }
}

// Real provider swap point — Resend's API is small enough to call directly
// without adding their SDK as a dependency. Set RESEND_API_KEY to activate.
class ResendEmailSender implements EmailSender {
  constructor(private readonly apiKey: string) {}
  async send(to: string, subject: string, body: string): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "Brindle <notify@brindle.example>",
        to,
        subject,
        text: body,
      }),
    });
    if (!res.ok) throw new Error(`Resend send failed: ${res.status}`);
  }
}

function makeEmailSender(): EmailSender {
  const key = process.env.RESEND_API_KEY;
  return key ? new ResendEmailSender(key) : new ConsoleEmailSender();
}

const emailSender = makeEmailSender();

/**
 * Create an in-app notification and best-effort email it. Never throws — a
 * failed email (or DB hiccup on a non-critical path) should never take down
 * the caller, which is usually deep in the bid-processing hot path.
 */
export async function notify(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  href?: string,
): Promise<void> {
  try {
    const [, user] = await Promise.all([
      prisma.notification.create({ data: { userId, type, title, body, href } }),
      prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    ]);
    if (user) void emailSender.send(user.email, title, body).catch(() => {});
  } catch {
    // Notifications are strictly best-effort — never let this surface to the
    // caller (bid resolution, settlement, dispute transitions all call this).
  }
}

export interface LotContext {
  label: string;
  auctionName: string;
  sellerId: string;
  href: string;
}

/** Shared "what is this lot called, and who's the seller" lookup for notification copy. */
export async function lotContext(lotId: string): Promise<LotContext | null> {
  const lot = await prisma.lot.findUnique({
    where: { id: lotId },
    select: {
      lotNumber: true,
      bullName: true,
      category: true,
      auction: { select: { name: true, sellerId: true } },
    },
  });
  if (!lot) return null;
  return {
    label: lot.bullName ?? `Lot ${lot.lotNumber} (${lot.category})`,
    auctionName: lot.auction.name,
    sellerId: lot.auction.sellerId,
    href: `/lots/${lotId}`,
  };
}
