import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';
import { config } from '../config.js';

export const msal = new PublicClientApplication({
  auth: {
    clientId: config.clientId,
    authority: `https://login.microsoftonline.com/${config.tenantId}`,
    redirectUri: config.redirectUri,
    navigateToLoginRequestUrl: true,
  },
  cache: { cacheLocation: 'localStorage' },
});

let ready;
// Must run once on startup: completes a redirect sign-in if one is in progress.
export function initAuth() {
  ready ??= (async () => {
    await msal.initialize();
    const result = await msal.handleRedirectPromise();
    if (result?.account) msal.setActiveAccount(result.account);
    else {
      const accounts = msal.getAllAccounts();
      if (accounts.length) msal.setActiveAccount(accounts[0]);
    }
    return msal.getActiveAccount();
  })();
  return ready;
}

export const login = () => msal.loginRedirect({ scopes: config.loginScopes });

export async function getToken() {
  const account = msal.getActiveAccount();
  if (!account) throw new Error('not_signed_in');
  try {
    const r = await msal.acquireTokenSilent({ scopes: config.loginScopes, account });
    return r.accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) await msal.acquireTokenRedirect({ scopes: config.loginScopes, account });
    throw e;
  }
}

// For the error screen: clears stale MSAL cache, then signs out.
export async function signOutAndClear() {
  const account = msal.getActiveAccount();
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
  if (account) await msal.logoutRedirect({ account, postLogoutRedirectUri: config.redirectUri });
  else location.assign('/');
}
