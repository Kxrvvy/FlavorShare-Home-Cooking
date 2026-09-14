'use client';

import { Suspense, useState, ChangeEvent, FormEvent } from 'react';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import axios from 'axios';

import { API_BASE_URL, extractApiErrors } from '@/lib/api';
import { setSession } from '@/lib/auth';

/* Step two of signup, and the step that actually creates the account.
 *
 * /register/ only stores a pending signup and emails a code; nothing exists in
 * the Users table until the code entered here is accepted. That is also why
 * this screen can sign someone straight in: /verify-email/ answers 201 with a
 * token pair, so there is no reason to send a person who has just proved their
 * address to a login form.
 *
 * The address travels in the query string rather than in component state so a
 * refresh - or reopening the tab - does not strand someone on a form that no
 * longer knows who it is verifying. The code is the secret here, not the email.
 */

const CODE_LENGTH = 6;

function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get('email') ?? '';

  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const handleCodeChange = (e: ChangeEvent<HTMLInputElement>) => {
    // Digits only, capped at six - the field cannot hold an invalid code.
    setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH));
    if (error) setError('');
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (code.length !== CODE_LENGTH) {
      setError(`Enter the ${CODE_LENGTH}-digit code from your email.`);
      return;
    }

    setLoading(true);
    setError('');
    setNotice('');

    try {
      const { data } = await axios.post(`${API_BASE_URL}/accounts/verify-email/`, {
        email,
        code,
      });

      // 201 carries the new account plus a token pair.
      setSession({ access: data.access, refresh: data.refresh }, data.user);
      router.push('/');
    } catch (err: unknown) {
      const { fields, message } = extractApiErrors(
        err,
        'That code could not be verified.',
      );
      setError(message ?? fields.code ?? fields.email ?? fields.username ?? '');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setError('');
    setNotice('');

    try {
      const { data } = await axios.post(`${API_BASE_URL}/accounts/resend-otp/`, {
        email,
      });
      setNotice(data.detail ?? 'We sent a new code to your email.');
      setCode('');
    } catch (err: unknown) {
      const { fields, message } = extractApiErrors(
        err,
        'Could not send a new code.',
      );
      setError(message ?? fields.email ?? '');
    } finally {
      setResending(false);
    }
  };

  // Arriving with no address means the redirect from /signup was bypassed.
  // Sending someone back is more useful than a form that cannot work.
  if (!email) {
    return (
      <div className="max-w-md mx-auto w-full text-center">
        <h1 className="text-2xl sm:text-4xl font-bold mb-2 text-gray-900">
          CHECK YOUR EMAIL
        </h1>
        <p className="text-sm text-amber-900/70 mb-6">
          We do not know which address to verify. Start your signup again and we
          will send a fresh code.
        </p>
        <Link
          href="/signup"
          className="inline-block py-3 px-8 bg-green-700 text-white rounded-full font-bold hover:bg-green-800 transition-colors"
        >
          Back to sign up
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto w-full">
      <header className="text-center mb-6">
        <h1 className="text-2xl sm:text-4xl font-bold mb-2 text-gray-900">
          CHECK YOUR EMAIL
        </h1>
        <p className="text-xs sm:text-sm text-amber-900/70">
          We sent a {CODE_LENGTH}-digit code to <strong>{email}</strong>. Enter
          it to finish creating your account.
        </p>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-lg text-sm text-center">
          {error}
        </div>
      )}

      {notice && (
        <div className="mb-4 p-3 bg-green-100 border border-green-400 text-green-800 rounded-lg text-sm text-center">
          {notice}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="code" className="block text-xs font-medium text-amber-900 mb-1">
            Verification code
          </label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={handleCodeChange}
            className="w-full px-4 py-3 bg-white border border-amber-200 rounded-xl text-center text-2xl tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-green-600"
            placeholder="000000"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-4 bg-green-700 text-white rounded-full font-bold hover:bg-green-800 transition-colors disabled:opacity-60"
        >
          {loading ? 'Verifying...' : 'Verify and continue'}
        </button>

        <div className="text-center space-y-3">
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="text-xs sm:text-sm text-amber-800 hover:text-amber-950 disabled:opacity-60"
          >
            {resending ? 'Sending...' : "Didn't get it? Send a new code"}
          </button>

          <Link href="/signup" className="block text-xs sm:text-sm text-amber-800">
            Wrong address? <span className="font-bold text-green-700">Start over</span>
          </Link>
        </div>
      </form>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div
      className="h-[100dvh] w-full bg-cover bg-center flex items-center justify-center p-4 sm:p-8 relative overflow-hidden"
      style={{ backgroundImage: "url('/images/Background.png')" }}
    >
      <div className="w-full max-w-6xl flex flex-col lg:flex-row gap-8 items-center justify-center h-full">
        <Link href="/signup" className="absolute top-6 left-6 z-20">
          <button className="w-10 h-10 bg-amber-800 rounded-full flex items-center justify-center hover:bg-amber-900 transition-colors">
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
        </Link>

        <div className="w-full max-w-[450px] lg:max-w-none lg:flex-1 bg-amber-50/90 backdrop-blur-sm border border-white/60 rounded-[2rem] p-6 sm:p-12 relative order-1 shadow-2xl">
          {/* useSearchParams needs a Suspense boundary or the route cannot be
           * prerendered. */}
          <Suspense fallback={<p className="text-center text-amber-900/70">Loading…</p>}>
            <VerifyForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
