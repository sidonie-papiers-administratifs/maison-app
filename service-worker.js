/* service-worker.js */
const CACHE_NAME = "maison-cache-v1";
const ASSETS = ["./", "./index.html", "./manifest.json", "./service-worker.js"];

// Copie “locale” de l’état (reçu depuis index.html)
let STATE = null;
const STORAGE_KEY = "maison_biblio_cuisine_v3";
const REMIND_DAYS = [3, 1, 0]; // ✅ J-3, J-1, Aujourd’hui

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // nettoyage anciens caches
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE_NAME) ? caches.delete(k) : Promise.resolve()));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  event.respondWith((async () => {
    const req = event.request;
    // cache-first for same-origin assets
    const cached = await caches.match(req);
    if(cached) return cached;
    try{
      const res = await fetch(req);
      return res;
    }catch(e){
      // offline fallback
      return caches.match("./index.html");
    }
  })());
});

// Receive state from page
self.addEventListener("message", (event) => {
  const msg = event.data;
  if(!msg || typeof msg !== "object") return;

  if(msg.type === "STATE_SYNC"){
    STATE = msg.payload;
    // schedule check (best effort)
    scheduleNextChecks();
  }
});

function todayISO(){
  const d = new Date();
  d.setHours(0,0,0,0);
  return d.toISOString().slice(0,10);
}

function parseISO(s){
  if(!s) return null;
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a,b){
  const ms = 24*60*60*1000;
  const A = new Date(a); A.setHours(0,0,0,0);
  const B = new Date(b); B.setHours(0,0,0,0);
  return Math.round((B - A)/ms);
}

function dueDiff(book){
  const due = parseISO(book.due);
  if(!due) return null;
  const t = parseISO(todayISO());
  return daysBetween(t, due); // due - today
}

function computeRemindersFromState(state){
  if(!state || !Array.isArray(state.books)) return [];
  const out = [];
  for(const b of state.books){
    if(!b || !b.due) continue;
    const diff = dueDiff(b);
    if(diff === null) continue;
    if(REMIND_DAYS.includes(diff)){
      const tag = (diff === 0) ? "AUJ" : `J-${diff}`;
      out.push({ book: b, diff, tag });
    }
  }
  const order = { "AUJ":0, "J-1":1, "J-3":2 };
  out.sort((a,b) => (order[a.tag] - order[b.tag]) || String(a.book.title||"").localeCompare(String(b.book.title||"")));
  return out;
}

function reminderKey(bookId, tag, dateIso){
  return `${bookId}|${tag}|${dateIso}`;
}

async function maybeNotify(){
  // Need permission
  if(Notification.permission !== "granted") return;
  if(!STATE || !STATE.notif || !STATE.notif.enabled) return;

  const dateIso = todayISO();
  STATE.notif.lastFired = STATE.notif.lastFired || {};

  const reminders = computeRemindersFromState(STATE);
  for(const r of reminders){
    const key = reminderKey(r.book.id, r.tag, dateIso);
    if(STATE.notif.lastFired[key]) continue;

    const lib = r.book.library ? ` (${r.book.library})` : "";
    const title = "📚 Rappel bibliothèque";
    const body = `${r.tag} : “${r.book.title}” à rendre${lib}. Retour : ${r.book.due}.`;

    await self.registration.showNotification(title, {
      body,
      tag: key, // prevents duplicates
      renotify: false
    });

    STATE.notif.lastFired[key] = Date.now();
  }
}

// Best effort scheduling: periodic background sync is not guaranteed everywhere.
// We do both:
// - periodicSync if available
// - alarm-ish by re-calling when a client opens + message sync
async function scheduleNextChecks(){
  // Immediate check
  await maybeNotify();

  // Periodic Background Sync (Chrome/Android supports in some cases)
  try{
    if("periodicSync" in self.registration){
      // Requires permission in some contexts; may throw.
      await self.registration.periodicSync.register("maison-reminders", {
        minInterval: 6 * 60 * 60 * 1000 // 6h
      });
    }
  }catch(e){
    // ignore
  }
}

self.addEventListener("periodicsync", (event) => {
  if(event.tag === "maison-reminders"){
    event.waitUntil(maybeNotify());
  }
});

// Notification click: open app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
    if(allClients.length > 0){
      allClients[0].focus();
      allClients[0].postMessage({ type:"OPEN_TAB", tab:"biblio" });
      return;
    }
    await clients.openWindow("./index.html");
  })());
});
