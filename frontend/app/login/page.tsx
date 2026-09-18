'use client';

import { useState, ChangeEvent, FormEvent } from 'react';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import axios from 'axios';

import { API_BASE_URL } from '@/lib/api';
import { setSession } from '@/lib/auth';
import { safeNextPath } from '@/lib/navigation';

interface FormData {
  username: string;
  password: string;
  rememberMe: boolean;
}

interface FormErrors {
  username?: string;
  password?: string;
}

export default function LoginPage() {
  const router = useRouter();

  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    username: '',
    password: '',
    rememberMe: false,
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState('');

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;

    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));

    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = (): FormErrors => {
    const newErrors: FormErrors = {};

    if (!formData.username) {
      newErrors.username = 'Username is required';
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
    }

    return newErrors;
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const newErrors = validateForm();

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);
    setApiError('');

    try {
      const tokenResponse = await axios.post(`${API_BASE_URL}/token/`, {
        username: formData.username,
        password: formData.password,
      });

      const { access, refresh } = tokenResponse.data;

      // The profile is fetched before anything is stored, so a failure here
      // leaves no half-session behind - tokens saved but no user.
      const meResponse = await axios.get(`${API_BASE_URL}/accounts/me/`, {
        headers: { Authorization: `Bearer ${access}` },
      });

      setSession({ access, refresh }, meResponse.data);

      /* Back to whatever sent them here - the Create Recipe button arrives as
       * /login?next=/recipes/create - and, when nothing did, wherever this
       * account actually lands: the admin dashboard for an admin, '/' for
       * everyone else. An admin's own account has no ordinary use for the
       * public homepage as a landing page, and making them click through to
       * the panel by hand every sign-in is the kind of friction nobody
       * should have to ask for twice.
       *
       * Read here rather than through useSearchParams because nothing on this
       * page *renders* the value; it is only needed at the moment we navigate.
       * The hook would additionally force this file behind a <Suspense> boundary
       * to keep /login prerenderable, which is a lot of restructuring for a
       * string read once in a click handler. safeNextPath is what makes an
       * attacker-supplied value safe to follow.
       */
      const next = new URLSearchParams(window.location.search).get('next');
      const fallback = meResponse.data.role === 'admin' ? '/admin/dashboard' : '/';
      router.push(safeNextPath(next, fallback));
    } catch (error: unknown) {
      // axios.isAxiosError narrows this properly, so the response body can be
      // read without an `any`. A network failure - the backend not running -
      // has no response at all, and says so rather than blaming the password.
      let message = 'Login failed. Please check your username and password.';

      if (axios.isAxiosError(error)) {
        message =
          error.response?.data?.detail ??
          (error.response
            ? message
            : 'Could not reach the server. Is the backend running?');
      }

      setApiError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-[100dvh] w-full bg-cover bg-center flex items-center justify-center p-4 sm:p-8 relative overflow-hidden"
    style={{ backgroundImage: "url('/images/Background.png')" }}>

      <div className="w-full max-w-6xl flex flex-col lg:flex-row gap-8 items-center justify-center h-full">

        {/* Back Button */}
        <Link href="/" className="absolute top-6 left-6 z-20">
          <button className="w-10 h-10 bg-amber-800 rounded-full flex items-center justify-center hover:bg-amber-900 transition-colors">
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
        </Link>

        {/* Form Container */}
        <div className="w-full max-w-[450px] lg:max-w-none lg:flex-1 bg-amber-50/90 backdrop-blur-sm border border-white/60 rounded-[2rem] p-6 sm:p-12 relative order-1 shadow-2xl">

          <div className="max-w-md mx-auto w-full">

            <header className="text-center mb-6 sm:mb-6">
              <h1 className="text-2xl sm:text-4xl font-bold mb-2 text-gray-900">WELCOME BACK</h1>
              <p className="text-xs sm:text-sm text-amber-900/70">
                Login to continue using FlavorShare
              </p>
            </header>

            {apiError && (
              <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-lg text-sm text-center">
                {apiError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">

              {/* Username */}
              <div>
                <label className="block text-xs font-medium text-amber-900 mb-1">
                  Username
                </label>

                <input
                  type="text"
                  name="username"
                  value={formData.username}
                  onChange={handleChange}
                  className={`w-full px-4 py-3 bg-white border border-amber-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-600 ${
                    errors.username ? 'ring-2 ring-red-500' : ''
                  }`}
                  placeholder="Enter your username"
                />

                {errors.username && (
                  <p className="mt-1 text-sm text-red-600">{errors.username}</p>
                )}
              </div>

              {/* Password */}
              <div className="relative">
                <label className="block text-xs font-medium text-amber-900 mb-1">
                  Password
                </label>

                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  className={`w-full px-4 py-3 bg-white border border-amber-200 rounded-xl pr-12 focus:outline-none focus:ring-2 focus:ring-green-600 ${
                    errors.password ? 'ring-2 ring-red-500' : ''
                  }`}
                  placeholder="Enter your password"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-[30px] text-amber-700 hover:text-amber-900"
                >
                  {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>

                {errors.password && (
                  <p className="mt-1 text-sm text-red-600">{errors.password}</p>
                )}
              </div>

              {/* Remember */}
              <div className="flex items-center">
                <input
                  type="checkbox"
                  name="rememberMe"
                  checked={formData.rememberMe}
                  onChange={handleChange}
                  className="w-4 h-4 text-green-600 bg-white border-amber-300 rounded focus:ring-green-600"
                />

                <label className="ml-2 text-sm text-amber-900">
                  Remember me
                </label>
              </div>

              {/* Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 bg-green-700 text-white rounded-full font-bold hover:bg-green-800 transition-colors disabled:opacity-60"
              >
                {loading ? 'Logging in...' : 'Log In'}
              </button>

              {/* Links */}
              <div className="text-center space-y-3 pt-2">

                <Link
                  href="/forgot-password"
                  className="block text-xs sm:text-sm text-amber-800 hover:text-amber-950"
                >
                  Forgot Password?
                </Link>

                <Link href="/signup" className="text-xs sm:text-sm text-amber-800">
                  Don&apos;t have an account? <span className="font-bold text-green-700">Create Account</span>
                </Link>

              </div>

            </form>
          </div>
        </div>

      </div>
    </div>
  );
}