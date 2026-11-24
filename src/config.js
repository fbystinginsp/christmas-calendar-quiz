// Public values only. Safe to commit. Secrets live in Vercel env vars.
export const config = {
  clientId: 'd854928f-042c-44d0-a327-fc70520ff811',
  tenantId: '50ba63e0-0fc8-4a8a-b600-528fd10efe3e',
  redirectUri: window.location.origin,
  loginScopes: ['User.Read'],
};
