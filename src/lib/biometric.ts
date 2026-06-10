const CREDENTIAL_ID_KEY = 'adimat_biometric_credential';

export async function isBiometricAvailable(): Promise<boolean> {
  if (!window.PublicKeyCredential) {
    return false;
  }

  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return available;
  } catch {
    return false;
  }
}

export async function registerBiometric(userId: string, userName: string): Promise<{ success: boolean; error?: string }> {
  if (!window.PublicKeyCredential) {
    return { success: false, error: 'WebAuthn not supported' };
  }

  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    const userIdBytes = new TextEncoder().encode(userId);

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: 'Adimat POS',
          id: window.location.hostname,
        },
        user: {
          id: userIdBytes,
          name: userName,
          displayName: userName,
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },   // ES256
          { alg: -257, type: 'public-key' }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
        attestation: 'none',
      },
    }) as PublicKeyCredential | null;

    if (credential) {
      const credentialId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
      localStorage.setItem(CREDENTIAL_ID_KEY, JSON.stringify({
        id: credentialId,
        userId: userId,
      }));
      return { success: true };
    }

    return { success: false, error: 'No credential created' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('NotAllowedError')) {
      return { success: false, error: 'Biometric registration was cancelled' };
    }
    return { success: false, error: msg };
  }
}

export async function authenticateWithBiometric(): Promise<{ success: boolean; userId?: string; error?: string }> {
  if (!window.PublicKeyCredential) {
    return { success: false, error: 'WebAuthn not supported' };
  }

  const stored = localStorage.getItem(CREDENTIAL_ID_KEY);
  if (!stored) {
    return { success: false, error: 'No biometric credential registered. Please set up biometrics in Settings.' };
  }

  try {
    const { id: credentialId, userId } = JSON.parse(stored);
    const credentialIdBytes = Uint8Array.from(atob(credentialId), c => c.charCodeAt(0));

    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        allowCredentials: [{
          id: credentialIdBytes,
          type: 'public-key',
          transports: ['internal'],
        }],
        userVerification: 'required',
        timeout: 60000,
      },
    }) as PublicKeyCredential | null;

    if (assertion) {
      return { success: true, userId };
    }

    return { success: false, error: 'Authentication failed' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('NotAllowedError')) {
      return { success: false, error: 'Biometric authentication was cancelled' };
    }
    return { success: false, error: msg };
  }
}

export function hasBiometricRegistered(): boolean {
  return localStorage.getItem(CREDENTIAL_ID_KEY) !== null;
}

export function clearBiometricRegistration(): void {
  localStorage.removeItem(CREDENTIAL_ID_KEY);
}
