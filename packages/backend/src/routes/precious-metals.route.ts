import * as controller from '@controllers/precious-metals';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { validateEndpoint } from '@middlewares/validations';
import { Router } from 'express';

const router = Router({});
router.use(authenticateSession);
router.get('/', validateEndpoint(controller.list.schema), controller.list.handler);
router.post('/', checkBaseCurrencyLock, validateEndpoint(controller.create.schema), controller.create.handler);
router.post('/refresh', checkBaseCurrencyLock, validateEndpoint(controller.refresh.schema), controller.refresh.handler);
router.get('/:id', validateEndpoint(controller.get.schema), controller.get.handler);
router.patch('/:id', checkBaseCurrencyLock, validateEndpoint(controller.update.schema), controller.update.handler);
router.post(
  '/:id/events',
  checkBaseCurrencyLock,
  validateEndpoint(controller.createEvent.schema),
  controller.createEvent.handler,
);
router.delete(
  '/:id/events/:eventId',
  checkBaseCurrencyLock,
  validateEndpoint(controller.deleteEvent.schema),
  controller.deleteEvent.handler,
);
router.post(
  '/:id/events/:eventId/link',
  checkBaseCurrencyLock,
  validateEndpoint(controller.link.schema),
  controller.link.handler,
);
router.delete(
  '/:id/events/:eventId/link',
  checkBaseCurrencyLock,
  validateEndpoint(controller.unlink.schema),
  controller.unlink.handler,
);
router.post(
  '/:id/quotes',
  checkBaseCurrencyLock,
  validateEndpoint(controller.createQuote.schema),
  controller.createQuote.handler,
);
export default router;
