export function requireAdminPassword(req, res, next) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return res.status(500).send('Server missing ADMIN_PASSWORD');

  const hdr = req.headers.authorization || '';
  const [kind, token] = hdr.split(' ');
  if (kind !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Unauthorized', hint: 'Send Authorization: Bearer <ADMIN_PASSWORD>' });
  }

  if (token !== password) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  next();
}
