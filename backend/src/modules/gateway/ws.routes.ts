import { MAX_CLIENT_MESSAGE_BYTES } from '@voltix/protocol';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { requireHomeRole } from '../../lib/access';
import type { ControllerAuth, HandshakeMeta } from './gateway';

declare module 'fastify' {
  interface FastifyRequest {
    device?: { auth: ControllerAuth; meta: HandshakeMeta };
  }
}

const clientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), homeId: z.uuid() }),
  z.object({ type: z.literal('unsubscribe') }),
  z.object({ type: z.literal('ping') }),
]);

export const wsRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, { ctx }) => {
  /** Device boards. Authenticated by signed headers before the upgrade completes. */
  app.get(
    '/device',
    {
      websocket: true,
      config: { public: true, skipOriginCheck: true, rateLimit: { max: 30, timeWindow: '1 minute' } },
      preValidation: async (req) => {
        req.device = await ctx.services.gateway.authenticate(req.headers, req.ip);
      },
    },
    (socket, req) => {
      const { auth, meta } = req.device!;
      ctx.services.gateway.attach(socket, auth, meta);
    },
  );

  /** Browsers: live device state, online status and notifications for the subscribed home. */
  app.get('/ws', { websocket: true }, (socket, req) => {
    const allowed = new URL(ctx.env.APP_ORIGIN).origin;
    if (req.headers.origin !== allowed) {
      socket.close(4003, 'origin not allowed');
      return;
    }
    const userId = req.auth!.userId;
    const send = (data: unknown) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(data));
    const offUser = ctx.bus.subscribe(`user:${userId}`, send);
    let offHome: (() => void) | undefined;

    socket.on('message', async (raw) => {
      const text = raw.toString();
      if (text.length > MAX_CLIENT_MESSAGE_BYTES) return socket.close(1009, 'message too large');
      let msg: z.infer<typeof clientMessage>;
      try {
        msg = clientMessage.parse(JSON.parse(text));
      } catch {
        return send({ type: 'error', message: 'invalid message' });
      }
      if (msg.type === 'ping') return send({ type: 'pong' });
      offHome?.();
      offHome = undefined;
      if (msg.type === 'subscribe') {
        try {
          await requireHomeRole(ctx, req, msg.homeId);
        } catch {
          return send({ type: 'error', message: 'not a member of this home' });
        }
        // shortcut: membership is checked at subscribe time; a removed member keeps events until reconnect
        offHome = ctx.bus.subscribe(`home:${msg.homeId}`, send);
        send({ type: 'subscribed', homeId: msg.homeId });
      }
    });
    socket.on('close', () => {
      offUser();
      offHome?.();
    });
  });
};
