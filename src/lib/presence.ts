import { useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Live online status ("На связи" / "Не в сети") from Supabase Realtime
 * Presence. Not profiles.presence and not profiles.is_active (the account
 * state).
 *
 * Every user has one private topic, `luno-presence:<user id>`. Realtime
 * Authorization (migration 20261008100000) lets a user track presence only on
 * their own topic, and read a topic only when the profile is visible to them
 * (can_view_profile). One manager per signed-in app instance owns all
 * channels; they share the client's single WebSocket.
 *
 * - Own channel: track() once per tab, again after every (re)join. Several
 *   tabs are several entries under the same key; the user is online while at
 *   least one entry exists.
 * - Watch channels: read-only, one per profile the user may see (the profiles
 *   query is already filtered by RLS). Online = the topic has any entry.
 * - Closing the last tab or signing out removes the entry at once; a lost
 *   connection (sleep, network) is removed by the server heartbeat timeout.
 */

const TOPIC_PREFIX = "luno-presence:";
const VISIBLE_REFRESH_MS = 120_000;

let onlineIds: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function setOnline(id: string, online: boolean) {
  if (onlineIds.has(id) === online) return;
  const next = new Set(onlineIds);
  if (online) next.add(id);
  else next.delete(id);
  onlineIds = next;
  emit();
}

function subscribeStore(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const NO_ONE: ReadonlySet<string> = new Set();

/** Whether the user is online now; re-renders only when that user's status changes. */
export function useIsOnline(id: string | null | undefined) {
  return useSyncExternalStore(subscribeStore, () => (id ? onlineIds.has(id) : false), () => false);
}

/** The whole online set (for filters); a new set object only when it changes. */
export function useOnlineIds() {
  return useSyncExternalStore(subscribeStore, () => onlineIds, () => NO_ONE);
}

type Session = {
  userId: string;
  own: RealtimeChannel;
  watched: Map<string, RealtimeChannel>;
  refreshTimer: ReturnType<typeof setInterval>;
  stopped: boolean;
  cleanup: () => void;
};

let current: Session | null = null;

function hasEntries(channel: RealtimeChannel) {
  return Object.keys(channel.presenceState()).length > 0;
}

/** A read channel for one user's topic. */
function watchChannel(id: string) {
  const channel = supabase.channel(TOPIC_PREFIX + id, { config: { private: true, presence: { enabled: true } } });
  channel
    .on("presence", { event: "sync" }, () => setOnline(id, hasEntries(channel)))
    .subscribe((status) => {
      // Not authorized or connection lost: unknown, shown as offline until it rejoins.
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setOnline(id, false);
    });
  return channel;
}

/** The caller's own topic: tracked by this tab and read like any other. */
function ownChannel(userId: string) {
  const channel = supabase.channel(TOPIC_PREFIX + userId, { config: { private: true, presence: { key: userId, enabled: true } } });
  channel
    .on("presence", { event: "sync" }, () => setOnline(userId, hasEntries(channel)))
    .subscribe((status) => {
      // Re-track after every (re)join: a rejoined channel starts without our entry.
      if (status === "SUBSCRIBED") void channel.track({ online_at: new Date().toISOString() });
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setOnline(userId, false);
    });
  return channel;
}

async function refreshWatched(session: Session) {
  // RLS on profiles returns exactly the profiles this user may see.
  const { data, error } = await supabase.from("profiles").select("id");
  if (error || session.stopped || current !== session) return;
  const visible = new Set((data ?? []).map((row) => row.id).filter((id) => id !== session.userId));
  for (const [id, channel] of session.watched) {
    if (visible.has(id)) continue;
    void supabase.removeChannel(channel);
    session.watched.delete(id);
    setOnline(id, false);
  }
  for (const id of visible) {
    if (!session.watched.has(id)) session.watched.set(id, watchChannel(id));
  }
}

/** Recreates channels that ended in a closed/errored state (after sleep, bfcache, network loss). */
function revive(session: Session) {
  if (session.stopped) return;
  if (!supabase.realtime.isConnected()) supabase.realtime.connect();
  const dead = (channel: RealtimeChannel) => channel.state === "closed" || channel.state === "errored";
  if (dead(session.own)) {
    void supabase.removeChannel(session.own);
    session.own = ownChannel(session.userId);
  }
  for (const [id, channel] of session.watched) {
    if (!dead(channel)) continue;
    void supabase.removeChannel(channel);
    session.watched.set(id, watchChannel(id));
  }
  void refreshWatched(session);
}

/** Starts presence for the signed-in user; a no-op if already running for this user. */
export function startPresence(userId: string) {
  if (current?.userId === userId && !current.stopped) return;
  stopPresence();
  const session: Session = {
    userId,
    own: ownChannel(userId),
    watched: new Map(),
    refreshTimer: setInterval(() => void refreshWatched(session), VISIBLE_REFRESH_MS),
    stopped: false,
    cleanup: () => {},
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") revive(session);
  };
  const onOnline = () => revive(session);
  // Restored from the back/forward cache: the old socket is gone.
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) revive(session);
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onOnline);
  window.addEventListener("pageshow", onPageShow);
  session.cleanup = () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("pageshow", onPageShow);
  };
  current = session;
  void refreshWatched(session);
}

/** Stops presence: untracks this tab, leaves every channel and clears the store. */
export function stopPresence() {
  const session = current;
  current = null;
  if (session) {
    session.stopped = true;
    clearInterval(session.refreshTimer);
    session.cleanup();
    void session.own.untrack().finally(() => void supabase.removeChannel(session.own));
    session.watched.forEach((channel) => void supabase.removeChannel(channel));
    session.watched.clear();
  }
  if (onlineIds.size) {
    onlineIds = new Set();
    emit();
  }
}
