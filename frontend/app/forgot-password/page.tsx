'use client';

import { useState, ChangeEvent, FormEvent } from 'react';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import axios from 'axios';

import { API_BASE_URL, extractApiErrors } from '@/lib/api';
import { validateEmail } from '@/lib/validation';

/* Step one of a password reset: ask where to send the code.
 *
 * The login page has always linked here; until now the link went nowhere.
 *
 * The same shape as signup -> verify, and for the same reason: the backend
 * emails a six-digit code and the next screen spends it. This one only
 * identifies the account.
 */

export default function ForgotPasswordPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    if (error) setError('');
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const emailError = validateEmail(email);
    if (emailError) {
      setError(emailError);
      return;
    }

    setLoading(true);
    setApiError('');

    try {
      await axios.post(`${API_BASE_URL}/accounts/password-reset/request/`, {
        email,
      });

      router.push(`/reset-password?email=${encodeURIComponent(email)}`);
    } catch (err: unknown) {
      const { fields, message } = extractApiErrors(
        err,
        'Could not send a reset code.',
      );

      // The API says plainly when no active account uses an address. That is
      // already discoverable through signup's uniqueness error, so repeating it
      // here costs nothing and saves someone staring at a form that silently
      // did nothing.
      if (fields.email) setError(fields.email);
      setApiError(message ?? '');
    } finally {
      setLoading(false);
    }
  };

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
          <div className="max-w-md mx-auto w-full">
            <header className="text-center mb-6">
              <h1 className="text-2xl sm:text-4xl font-bold mb-2 text-gray-900">
                FORGOT YOUR PASSWORD?
              </h1>
              <p className="text-xs sm:text-sm text-amber-900/70">
                Enter the email on your account and we&apos;ll send you a code to
                set a new password.
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
                  htmlFor="email"
                  className="block text-xs font-medium text-amber-900 mb-1"
                >
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={handleChange}
                  className={`w-full px-4 py-3 bg-white border border-amber-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-600 ${
                    error ? 'ring-2 ring-red-500' : ''
                  }`}
                  placeholder="Enter your email"
                />
                {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 bg-green-700 text-white rounded-full font-bold hover:bg-green-800 transition-colors disabled:opacity-60"
              >
                {loading ? 'Sending code...' : 'Send reset code'}
              </button>

              <div className="text-center">
                <Link
                  href="/login"
                  className="text-xs sm:text-sm text-amber-800 hover:text-amber-950"
                >
                  Remembered it? <span className="font-bold text-green-700">Log in</span>
                </Link>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
