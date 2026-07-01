// WebSocket gateways must attach their message listener synchronously, but they
// can only *handle* messages after async setup (auth, auction lookup, event
// subscription) completes. A bid fired on `open` arrives in that gap. MessageGate
// buffers messages until the gateway is ready, then flushes them in arrival order
// and passes subsequent ones straight through — so no early message is ever lost.
//
// This exists as its own unit so the race that dropped bids during setup stays
// regression-tested, not just manually verified.
export class MessageGate<T> {
  private ready = false;
  private handler: ((message: T) => void) | null = null;
  private readonly pending: T[] = [];

  /** Called for every inbound message; buffers until open(), then dispatches. */
  push(message: T): void {
    if (this.ready && this.handler) this.handler(message);
    else this.pending.push(message);
  }

  /** Setup is done — install the handler, flush buffered messages in order. */
  open(handler: (message: T) => void): void {
    this.handler = handler;
    this.ready = true;
    for (const message of this.pending) handler(message);
    this.pending.length = 0;
  }

  get isReady(): boolean {
    return this.ready;
  }
}
