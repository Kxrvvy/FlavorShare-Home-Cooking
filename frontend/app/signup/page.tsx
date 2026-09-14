// app/signup/page.tsx
'use client';

import { useState, ChangeEvent, FormEvent } from 'react';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import axios from 'axios';

import { API_BASE_URL, extractApiErrors } from '@/lib/api';
import { validateEmail, validatePassword } from '@/lib/validation';

interface FormData {
  username: string;
  email: string;
  password: string;
}

interface FormErrors {
  username?: string;
  email?: string;
  password?: string;
}

export default function SignupPage() {
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();

  const [formData, setFormData] = useState<FormData>({
    username: '',
    email: '',
    password: '',
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState('');

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = (): FormErrors => {
    const newErrors: FormErrors = {};

    if (!formData.username.trim()) {
      newErrors.username = 'Username is required';
    } else if (formData.username.length > 50) {
      newErrors.username = 'Username must be 50 characters or fewer';
    }

    const emailError = validateEmail(formData.email);
    if (emailError) newErrors.email = emailError;

    const passwordError = validatePassword(formData.password);
    if (passwordError) newErrors.password = passwordError;

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
      // Creates no account. /register/ answers 202 and emails a code; the
      // account only exists once /verify-email/ accepts that code, which is
      // why this goes to the verify screen rather than signing anyone in.
      await axios.post(`${API_BASE_URL}/accounts/register/`, {
        username: formData.username,
        email: formData.email,
        password: formData.password,
      });

      router.push(`/signup/verify?email=${encodeURIComponent(formData.email)}`);
    } catch (error: unknown) {
      const { fields, message } = extractApiErrors(
        error,
        'Could not create your account. Please try again.',
      );

      // Field errors go back to the input they belong to - a taken username
      // should be marked on the username box, not in a banner at the top.
      setErrors(fields as FormErrors);
      setApiError(message ?? '');
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
            <header className="text-center mb-6 sm:mb-8">
              <h1 className="text-2xl sm:text-4xl font-bold mb-1 text-gray-900">CREATE YOUR ACCOUNT</h1>
              <p className="text-xs sm:text-sm text-amber-900/70">Please fill in details to create your account</p>
            </header>

            {apiError && (
              <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-lg text-sm text-center">
                {apiError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
              <div>
                <label className="block text-xs font-medium text-amber-900 mb-1">Username</label>
                <input
                  type="text"
                  name="username"
                  value={formData.username}
                  onChange={handleChange}
                  className={`w-full px-4 py-3 bg-white border border-amber-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-600 ${errors.username ? 'ring-2 ring-red-500' : ''}`}
                  placeholder="Choose a username"
                />
                {errors.username && (
                  <p className="mt-1 text-sm text-red-600">{errors.username}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-amber-900 mb-1">Email</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  className={`w-full px-4 py-3 bg-white border border-amber-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-600 ${errors.email ? 'ring-2 ring-red-500' : ''}`}
                  placeholder="Enter your Email"
                />
                {errors.email && (
                  <p className="mt-1 text-sm text-red-600">{errors.email}</p>
                )}
              </div>

              <div className="mb-2">
                <label className="block text-xs font-medium text-amber-900 mb-1">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    className={`w-full px-4 py-3 bg-white border border-amber-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-600 ${errors.password ? 'ring-2 ring-red-500' : ''}`}
                    placeholder="Enter your password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 transform -translate-y-1/2 text-amber-700 hover:text-amber-900"
                  >
                    {showPassword ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="mt-1 text-sm text-red-600">{errors.password}</p>
                )}
              </div>

              <div className="relative pt-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-4 bg-green-700 text-white rounded-full font-bold hover:bg-green-800 transition-colors disabled:opacity-60"
                >
                  {loading ? 'Sending code...' : 'Create Account'}
                </button>
              </div>

              <div className="text-center">
                <Link href="/login" className="text-xs sm:text-sm text-amber-800 hover:text-amber-950">
                  Already a member? <span className="font-bold text-green-700">Log in</span>
                </Link>
              </div>
            </form>
          </div>
        </div>

      </div>
    </div>
  );
}