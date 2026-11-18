/** Sign out this device. Clears the cookie whether or not the session resolved. */
import { route, json } from '@/lib/api';
import { clearSessionCookie, readSessionCookie, resolveSession, revokeSession } from '@/lib/auth/session';

export const POST = route({ loadActor: false }, async () => {
  const token = await readSessionCookie();
  const session = await resolveSession(token);
  if (session) await revokeSession(session.sessionId, 'signed out');
  await clearSessionCookie();
  return json({ status: 'signed-out' });
});
