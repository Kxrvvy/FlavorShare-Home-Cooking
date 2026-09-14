/* Form rules that have to agree with the backend.
 *
 * Django validates passwords server-side and will reject what it does not like,
 * so anything here is only about catching a problem before a round trip. The
 * rules are kept in one place because signup and password-reset both need them,
 * and two copies of a rule drift - the same way two names for one localStorage
 * key did.
 *
 * Deliberately NOT a mirror of Django. CommonPasswordValidator checks a list of
 * 20,000 passwords that is not worth shipping to the browser, and
 * UserAttributeSimilarityValidator needs the other form fields. Both still run
 * server-side, so a password can pass here and still be refused - which is why
 * the forms surface the backend's field errors rather than assuming a local
 * pass means success.
 */

/** Django's MinimumLengthValidator default. */
const MIN_LENGTH = 8;

/** At least one capital and one symbol - stricter than Django, kept from the
 * original signup form because it is what the form already promised users. */
const STRENGTH = /^(?=.*[A-Z])(?=.*[!@#$%^&*(),.?":{}|<>]).*$/;

/** Returns a message to show, or null when the password is acceptable. */
export function validatePassword(password: string): string | null {
  if (!password) return "Password is required";

  if (password.length < MIN_LENGTH) {
    return `Password must be at least ${MIN_LENGTH} characters`;
  }

  // Mirrors Django's NumericPasswordValidator.
  if (/^\d+$/.test(password)) {
    return "Password cannot be entirely numbers";
  }

  if (!STRENGTH.test(password)) {
    return "Must include at least one uppercase letter and one special character";
  }

  return null;
}

/** Rough shape check only; the browser's type="email" does the real work. */
export function validateEmail(email: string): string | null {
  if (!email) return "Email is required";
  if (!/\S+@\S+\.\S+/.test(email)) return "Email is invalid";
  return null;
}
