export function requireCronSecret(req, res, next) {
  const provided = req.header('X-Cron-Secret');
  if (!process.env.CRON_SECRET) {
    return res.status(500).json({ error: 'Server misconfigured: CRON_SECRET not set' });
  }
  if (provided !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Invalid or missing X-Cron-Secret header' });
  }
  next();
}
