import type { Request, Response } from 'express';
import type { AssistantService } from '../services/ai/assistant.service.ts';
import type { NotificationService } from '../services/notification.service.ts';
import type { WhatsAppService } from '../services/whatsapp/whatsapp.service.ts';
import { ok, requestContext } from '../utils/http.ts';

const id = (req: Request) => (req.validated.params as { id: string }).id;

export class AiController {
  constructor(private readonly ai: AssistantService) {}

  usage = async (req: Request, res: Response) => ok(res, await this.ai.usage(req.tenant!));
  conversations = async (req: Request, res: Response) => ok(res, await this.ai.listConversations(req.tenant!, req.auth!.userId));
  conversation = async (req: Request, res: Response) => ok(res, await this.ai.getConversation(req.tenant!, req.auth!.userId, id(req)));
  ask = async (req: Request, res: Response) => ok(res, await this.ai.ask(req.tenant!, req.auth!.userId, req.body, requestContext(req)));
  extract = async (req: Request, res: Response) => ok(res, await this.ai.extract(req.tenant!, req.auth!.userId, req.body, requestContext(req)), 201);
  draft = async (req: Request, res: Response) => ok(res, await this.ai.getDraft(req.tenant!, req.auth!.userId, id(req)));
  confirmDraft = async (req: Request, res: Response) => ok(res, await this.ai.confirmDraft(req.tenant!, req.auth!.userId, id(req), req.body));
  discardDraft = async (req: Request, res: Response) => {
    await this.ai.discardDraft(req.tenant!, req.auth!.userId, id(req));
    res.status(204).end();
  };
  reminder = async (req: Request, res: Response) => ok(res, await this.ai.reminder(req.tenant!, req.body.buyerId));
}

export class CommunicationController {
  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly notifications: NotificationService,
  ) {}

  send = async (req: Request, res: Response) => {
    const r = await this.whatsapp.send(req.tenant!, req.auth!.userId, req.body, requestContext(req));
    // 202 = accepted but still queued (a temporary failure is being retried in the background).
    ok(res, r, r.status === 'QUEUED' ? 202 : 201);
  };
  messages = async (req: Request, res: Response) => {
    const q = req.validated.query as { page: number; pageSize: number; farmerId?: string; buyerId?: string };
    const [items, total] = await this.whatsapp.list(req.tenant!, q);
    ok(res, items, 200, { page: q.page, pageSize: q.pageSize, total, provider: this.whatsapp.providerName });
  };
  notificationsList = async (req: Request, res: Response) => {
    const r = await this.notifications.list(req.tenant!, req.auth!.userId, req.query.unread === 'true');
    ok(res, r.items, 200, { unread: r.unread });
  };
  markRead = async (req: Request, res: Response) => {
    await this.notifications.markRead(req.tenant!, req.auth!.userId, id(req));
    res.status(204).end();
  };
  markAllRead = async (req: Request, res: Response) => ok(res, await this.notifications.markAllRead(req.tenant!, req.auth!.userId));

  /** Meta webhook verification handshake (GET). */
  webhookVerify = (req: Request, res: Response) => {
    const challenge = this.whatsapp.verifySubscription(req.query['hub.mode'], req.query['hub.verify_token'], req.query['hub.challenge']);
    if (challenge === null) return res.status(403).end();
    res.status(200).type('text/plain').send(challenge);
  };

  /** Status callbacks & inbound replies (POST). Authenticated by X-Hub-Signature-256 over the raw body. */
  webhook = async (req: Request, res: Response) => {
    if (!this.whatsapp.verifySignature((req as Request & { rawBody?: Buffer }).rawBody, req.get('x-hub-signature-256'))) return res.status(401).end();
    const r = await this.whatsapp.handleWebhook(req.body);
    res.status(200).json({ ok: true, ...r });
  };
}
