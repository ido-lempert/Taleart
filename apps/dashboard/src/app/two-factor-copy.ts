/**
 * The helpers the authenticator-app set-up and the recovery codes share, on the sign-in page and on
 * My sign-in methods: the secret key as groups of four, copying text to the clipboard, and saving the
 * recovery codes as a text file. The pages keep their own status text.
 */

/** The secret in groups of four, which is easier to type. */
export function groupSecretKey(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, '$1 ');
}

/** Copies text to the clipboard; false when the browser refuses, so the page can say to copy by hand. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Saves the recovery codes as a plain text file, one code to a line. */
export function downloadRecoveryCodes(codes: readonly string[]): void {
  const url = URL.createObjectURL(new Blob([`${codes.join('\n')}\n`], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'taleart-recovery-codes.txt';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
