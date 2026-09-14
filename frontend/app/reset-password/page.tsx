'use client';

import { Suspense, useState, ChangeEvent, FormEvent } from 'react';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import axios from 'axios';

import { API_BASE_URL, extractApiErrors } from '@/lib/api';
import { validatePassword } from '@/lib/validation';

/* Step two of a password reset: spend the code and set a new password.
 *
 * Unlike email verification, this does NOT sign anyone in. /verify-email/
 * returns a token pair because entering that code proves the person is at the
 * address; a reset code may have been read off someone's screen, so the backend
 * answers 204 and the person logs in with the password they just chose. It also
 * blacklists every outstanding refresh token, which ends whatever session
 * prompted the reset.
 *
 * Success is shown here rather than redirected to /login, because login would
 * need its own query-param plumbing to display a message it has no other reason
 * to know about.
 */

const CODE_LENGTH = 6;

function ResetForm() {
  const params = useSearchParams();
  const email = params.get('email') ?? '';

  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [codeError, setCodeError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleCodeChange = (e: ChangeEvent<HTMLInputElement>) => {
    setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH));
    if (codeError) setCodeError('');
    if (apiError) setApiError('');
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const pwError = validatePassword(password);
    const cError =
      code.length === CODE_LENGTH
        ? ''
        : `Enter the ${CODE_LENGTH}-digit code from your email.`;

    setCodeError(cError);
    setPasswordError(pwError ?? '');
    if (cError || pwError) return;

    setLoading(true);
    setApiError('');

    try {
      await axios.post(`${API_BASE_URL}/accounts/password-reset/confirm/`, {
        email,
        code,
        new_password: password,
      });

      setDone(true);
    } catch (err: unknown) {
      const { fields, message } = extractApiErrors(
        err,
        'Could not reset your password.',
      );

      if (fields.code) setCodeError(fields.code);
      if (fields.new_password) setPasswordError(fields.new_password);
      setApiError(message ?? fields.email ?? '');
    } finally {
      setLoading(false);
    }
  };

  // Arriving with no address means the redirect from /forgot-password was
  // bypassed. Sending someone back beats a form that cannot work.
  if (!email) {
    return (
      <div className="max-w-md mx-auto w-full text-center">
        <h1 className="text-2xl sm:text-4xl font-bold mb-2 text-gray-900">
          SET A NEW PASSWORD
        </h1>
        <p className="text-sm text-amber-900/70 mb-6">
          We do not know which account to reset. Request a new code and we will
          bring you back here.
        </p>
        <Link
          href="/forgot-password"
          className="inline-block py-3 px-8 bg-green-700 text-white rounded-full font-bold hover:bg-green-800 transition-colors"
        >
          Request a code
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto w-full text-center">
        <h1 className="text-2xl sm:text-4xl font-bold mb-2 text-gray-900">
          PASSWORD UPDATED
        </h1>
        <p className="text-sm text-amber-900/70 mb-6">
          Your password has been changed and any other sessions have been signed
          out. Log in with your new password to continue.
        </p>
        <Link
          href="/login"
          className="inline-block py-3 px-8 bg-green-700 text-white rounded-full font-bold hover:bg-green-800 transition-colors"
        >
          Log in
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto w-full">
      <header className="text-center mb-6">
        <h1 className="text-2xl sm:text-4xl font-bold mb-2 text-gray-900">
          SET A NEW PASSWORD
        </h1>
        <p className="text-xs sm:text-sm text-amber-900/70">
          Enter the {CODE_LENGTH}-digit code we sent to <strong>{email}</strong>,
          then choose a new password.
        </p>
      </header>

      {apiError && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-lg text-sm text-center">
          {apiError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label
            htmlFor="code"
            className="block text-xs font-medium text-amber-900 mb-1"
          >
            Reset code
          </label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={handleCodeChange}
            className={`w-full px-4 py-3 bg-white border border-amber-200 rounded-xl text-center text-2xl tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-green-600 ${
              codeError ? 'ring-2 ring-red-500' : ''
            }`}
            placeholder="000000"
          />
          {codeError && <p className="mt-1 text-sm text-red-600">{codeError}</p>}
        </div>

        <div>
          <label
            htmlFor="new_password"
            className="block text-xs font-medium text-amber-900 mb-1"
          >
            New password
          </label>
          <div className="relative">
            <input
              id="new_password"
              name="new_password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (passwordError) setPasswordError('');
              }}
              className={`w-full px-4 py-3 bg-white border border-amber-200 rounded-xl pr-12 focus:outline-none focus:ring-2 focus:ring-green-600 ${
                passwordError ? 'ring-2 ring-red-500' : ''
              }`}
              placeholder="Enter a new password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-amber-700 hover:text-amber-900"
            >
              {showPassword ? (
                <Eye className="w-5 h-5" />
              ) : (
                <EyeOff className="w-5 h-5" />
              )}
            </button>
          </div>
          {passwordError && (
            <p className="mt-1 text-sm text-red-600">{passwordError}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-4 bg-green-700 text-white rounded-full font-bold hover:bg-green-800 transition-colors disabled:opacity-60"
        >
          {loading ? 'Updating...' : 'Update password'}
        </button>

        <div className="text-center">
          <Link
            href="/forgot-password"
            className="text-xs sm:text-sm text-amber-800 hover:text-amber-950"
          >
            Code expired?{' '}
            <span className="font-bold text-green-700">Send a new one</span>
          </Link>
        </div>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div
      className="h-[100dvh] w-full bg-cover bg-center flex items-center justify-center p-4 sm:p-8 relative overflow-hidden"
      style={{ backgroundImage: "url('/images/Background.png')" }}
    >
      <div className="w-full max-w-6xl flex flex-col lg:flex-row gap-8 items-center justify-center h-full">
        <Link href="/login" className="absolute top-6 left-6 z-20">
          <button className="w-10 h-10 bg-amber-800 rounded-full flex items-center justify-center hover:bg-amber-900 transition-colors">
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
        </Link>

        <div className="w-full max-w-[450px] lg:max-w-none lg:flex-1 bg-amber-50/90 backdrop-blur-sm border border-white/60 rounded-[2rem] p-6 sm:p-12 relative order-1 shadow-2xl">
          {/* useSearchParams needs a Suspense boundary to prerender. */}
          <Suspense
            fallback={<p className="text-center text-amber-900/70">Loading…</p>}
          >
            <ResetForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
