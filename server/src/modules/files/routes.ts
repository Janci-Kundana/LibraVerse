import { Router } from 'express';
import { AppError } from '../../core/errors';
import { isLocalPublicKey, openFile } from '../../core/storage';

/** Serves public uploads (logos, covers) stored on local disk. Private files never pass here. */
export const fileRoutes = Router();

fileRoutes.get('/*key', async (req, res) => {
  const key = ([] as string[]).concat(req.params.key as unknown as string[]).join('/');
  if (!isLocalPublicKey(key)) throw new AppError(404, 'NOT_FOUND', 'File not found');
  const file = await openFile(key);
  if ('redirect' in file) {
    res.redirect(302, file.redirect);
    return;
  }
  res.set('Cache-Control', 'public, max-age=86400');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.type(file.mime).send(file.data);
});
