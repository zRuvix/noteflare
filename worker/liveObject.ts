import { DurableObject } from 'cloudflare:workers'

/**
 * Holds the open WebSockets of one user (hibernation API: the object sleeps between messages
 * and keeps no storage). The Worker posts a ready-made message to /notify; it is relayed as is.
 */
export class LiveSync extends DurableObject {
  async fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url)
    if (pathname === '/connect' && req.headers.get('Upgrade') === 'websocket') {
      const { 0: client, 1: server } = new WebSocketPair()
      this.ctx.acceptWebSocket(server)
      return new Response(null, { status: 101, webSocket: client })
    }
    if (pathname === '/notify' && req.method === 'POST') {
      const text = await req.text()
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(text)
        } catch {
          // a socket that just closed
        }
      }
      return new Response(null, { status: 204 })
    }
    return new Response(null, { status: 404 })
  }

  webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) {
    if (msg === 'ping') ws.send('pong')
  }

  webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code, 'bye')
    } catch {
      // already closed
    }
  }

  webSocketError() {}
}
