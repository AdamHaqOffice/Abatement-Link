import webpush from 'web-push';

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    body: JSON.stringify(body, null, 2),
  };
}

export const handler = async (event) => {
  const configuredSecret = process.env.ADMIN_TOOLS_SECRET || process.env.DEVICE_INGEST_SECRET;
  const providedSecret = event.headers['x-admin-secret'] || event.queryStringParameters?.secret;
  if (configuredSecret && providedSecret !== configuredSecret) return json(401, { error: 'Invalid admin secret.' });
  const keys = webpush.generateVAPIDKeys();
  return json(200, {
    note: 'Copy these into Netlify environment variables, then clear cache and redeploy. Keep VAPID_PRIVATE_KEY secret.',
    VITE_VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT || 'mailto:support@abatement.ca',
  });
};
