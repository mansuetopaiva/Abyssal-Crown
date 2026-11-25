// Declarações mínimas para o pacote `ws` (evita depender de @types/ws).
declare module 'ws' {
  import { EventEmitter } from 'node:events';
  import type { IncomingMessage, Server as HttpServer } from 'node:http';
  import type { Duplex } from 'node:stream';

  class WebSocket extends EventEmitter {
    constructor(url: string, opts?: { headers?: Record<string, string> });
    static readonly OPEN: number;
    readyState: number;
    bufferedAmount: number;
    send(data: string | Buffer, cb?: (err?: Error) => void): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
    ping(): void;
  }
  namespace WebSocket {
    interface ServerOptions {
      noServer?: boolean;
      server?: HttpServer;
      maxPayload?: number;
      perMessageDeflate?: boolean;
    }
  }
  class WebSocketServer extends EventEmitter {
    constructor(opts: WebSocket.ServerOptions);
    handleUpgrade(
      req: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      cb: (ws: WebSocket, req: IncomingMessage) => void,
    ): void;
    close(): void;
  }
  export { WebSocket, WebSocketServer };
  export default WebSocket;
}
