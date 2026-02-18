import crypto from 'crypto';
import { Router, type Request } from 'express';
import { AppDataSource } from '../app_data.js';
import { User } from '../entities/index.js';
import { asyncWrap } from '../lib/async_wrap.js';

const router = Router();

/** Look up the authenticated user from the Authorization header. */
export async function resolveUser(req: Request): Promise<User | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  if (!token) return null;
  const repo = AppDataSource.getRepository(User);
  return repo.findOneBy({ authToken: token });
}

// ─── Auth routes (unauthenticated) ──────────────────────────

router.post('/auth/google', asyncWrap(async (req, res) => {
  const { accessToken } = req.body as { accessToken: string };
  if (!accessToken) { res.status(400).json({ error: 'accessToken required' }); return; }

  const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!infoRes.ok) { res.status(401).json({ error: 'invalid token' }); return; }

  const info = await infoRes.json() as {
    sub: string; email: string; name?: string;
    given_name?: string; family_name?: string; picture?: string; hd?: string;
  };

  if (info.hd !== 'nurture.bio') {
    res.status(403).json({ error: 'Only nurture.bio accounts are allowed' });
    return;
  }

  const userRepo = AppDataSource.getRepository(User);
  const authToken = crypto.randomBytes(32).toString('hex');

  let user = await userRepo.findOneBy({ googleId: info.sub });
  if (user) {
    user.name = info.name ?? user.name;
    user.givenName = info.given_name ?? user.givenName;
    user.familyName = info.family_name ?? user.familyName;
    user.picture = info.picture ?? user.picture;
    user.lastLoginAt = new Date();
    user.authToken = authToken;
    await userRepo.save(user);
  } else {
    user = userRepo.create({
      googleId: info.sub,
      email: info.email,
      name: info.name ?? info.email,
      givenName: info.given_name ?? null,
      familyName: info.family_name ?? null,
      picture: info.picture ?? null,
      hd: info.hd ?? null,
      lastLoginAt: new Date(),
      authToken,
    });
    await userRepo.save(user);
  }

  res.json({ id: user.id, email: user.email, name: user.name, picture: user.picture, token: authToken });
}));

router.get('/auth/me', asyncWrap(async (req, res) => {
  const user = await resolveUser(req);
  if (!user) { res.status(401).json({ error: 'not authenticated' }); return; }
  res.json({ id: user.id, email: user.email, name: user.name, picture: user.picture });
}));

router.post('/auth/logout', asyncWrap(async (req, res) => {
  const user = await resolveUser(req);
  if (user) {
    user.authToken = null;
    await AppDataSource.getRepository(User).save(user);
  }
  res.json({ ok: true });
}));

export default router;
