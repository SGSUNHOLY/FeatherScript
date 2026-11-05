"use strict";
(() => {
  const modules = globalThis.FSRenderer ||= {};
  class BridgeSocket {
    constructor(onMessage, onToggle, onReady = () => {}) {
      this.ws = null;
      this.pending = new Map();
      this.requestId = 0;
      this.timer = 0;
      this.openTimer = 0;
      this.ping = 0;
      this.refresh = 0;
      this.retry = 0;
      this.onMessage = onMessage;
      this.onToggle = onToggle;
      this.onReady = onReady;
      this.stopped = true;
    }

    start() {
      if (!this.stopped) return;
      this.stopped = false;
      this.connect();
      this.refresh = setInterval(() => {
        if (this.ws && this.ws.readyState === 1) this.send({ type: "list_tools", id: Date.now() });
      }, 25000);
    }

    connect() {
      if (this.stopped || this.ws?.readyState === 0 || this.ws?.readyState === 1) return;
      clearTimeout(this.timer);
      let ws;
      try {
        ws = new WebSocket("ws://127.0.0.1:17613");
      } catch {
        this.retryLater();
        return;
      }
      this.ws = ws;
      const openTimer = setTimeout(() => {
        if (ws.readyState === 0) {
          try { ws.close(); } catch {}
        }
      }, 4000);
      this.openTimer = openTimer;

      ws.addEventListener("open", () => {
        clearTimeout(openTimer);
        if (this.stopped || this.ws !== ws) return;
        this.retry = 0;
        this.onToggle(true);
        this.onReady(this);
        this.send({ type: "list_tools", id: Date.now() });
        this.send({ type: "get_vault", id: "vault-load" });
        clearInterval(this.ping);
        this.ping = setInterval(() => this.send({ type: "ping", id: Date.now() }), 15000);
      });

      ws.addEventListener("message", (ev) => {
        if (this.stopped || this.ws !== ws) return;
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        const pending = this.pending.get(msg.id);
        if (pending) { clearTimeout(pending.timer); this.pending.delete(msg.id); pending.resolve(msg); }
        this.onMessage(msg);
      });

      const drop = () => {
        clearTimeout(openTimer);
        if (this.ws !== ws) return;
        clearInterval(this.ping);
        if (this.ws === ws) {
          this.onToggle(false);
          for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.resolve({ ok: false, error: "Bridge disconnected. Try again when it is online." }); }
          this.pending.clear();
        }
        this.retryLater();
      };
      ws.addEventListener("close", drop);
      ws.addEventListener("error", () => {
        try { ws.close(); } catch {}
      });
    }

    retryLater() {
      if (this.stopped) return;
      clearTimeout(this.timer);
      const delay = Math.min(9000, 800 * Math.pow(1.55, this.retry++));
      this.timer = setTimeout(() => this.connect(), delay);
    }

    request(type, fields = {}) {
      if (!this.ws || this.ws.readyState !== 1) return Promise.resolve({ ok: false, error: "Bridge offline. Wait for the app to reconnect." });
      const id = `app-${++this.requestId}`;
      return new Promise((resolve) => {
        const timer = setTimeout(() => { this.pending.delete(id); resolve({ ok: false, error: "The bridge did not respond in time." }); }, 15000);
        this.pending.set(id, { resolve, timer });
        if (!this.send({ ...fields, type, id })) {
          clearTimeout(timer);
          this.pending.delete(id);
          resolve({ ok: false, error: "Bridge disconnected before the request could be sent." });
        }
      });
    }

    send(obj) {
      if (!this.ws || this.ws.readyState !== 1) return false;
      try { this.ws.send(JSON.stringify(obj)); return true; }
      catch { try { this.ws.close(); } catch {} return false; }
    }

    stop() {
      this.stopped = true;
      clearTimeout(this.timer);
      clearTimeout(this.openTimer);
      clearInterval(this.ping);
      clearInterval(this.refresh);
      const ws = this.ws;
      this.ws = null;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.resolve({ ok: false, error: "Bridge connection stopped." });
      }
      this.pending.clear();
      try { ws?.close(); } catch {}
    }
  }

  modules.BridgeSocket = BridgeSocket;
})();
