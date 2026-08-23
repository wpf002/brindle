"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { authed, onAuthChange } from "../lib/session";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

const POLL_MS = 30_000;

export function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await authed<{ notifications: Notification[]; unreadCount: number }>("/notifications");
      setItems(r.notifications);
      setUnread(r.unreadCount);
    } catch {
      // Signed out or API unavailable — leave the bell quiet rather than erroring.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    const offAuth = onAuthChange(() => void load());
    return () => { clearInterval(timer); offAuth(); };
  }, [load]);

  // Close on outside click so the panel doesn't get stuck open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function markAllRead() {
    try {
      await authed("/notifications/read-all", { method: "POST" });
      await load();
    } catch { /* best-effort */ }
  }

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <button
        className="btn-link bell"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && <span className="bell-dot">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-head">
            <strong>Notifications</strong>
            {unread > 0 && <button className="btn-link" onClick={markAllRead}>Mark all read</button>}
          </div>
          {items.length === 0 ? (
            <p className="dim" style={{ padding: "14px 16px", margin: 0, fontSize: 13.5 }}>
              Nothing yet. We&rsquo;ll tell you when you&rsquo;re outbid or a lot you won closes.
            </p>
          ) : (
            <ul className="notif-list">
              {items.slice(0, 12).map((n) => (
                <li key={n.id} className={n.readAt ? "" : "unread"}>
                  {n.href ? (
                    <Link href={n.href} onClick={() => setOpen(false)}>
                      <strong>{n.title}</strong>
                      <span>{n.body}</span>
                    </Link>
                  ) : (
                    <div><strong>{n.title}</strong><span>{n.body}</span></div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
