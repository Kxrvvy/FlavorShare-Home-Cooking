// app/signup/page.tsx
'use client';

import { useState, ChangeEvent, FormEvent } from 'react';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';

interface FormData {
  name: string;
  email: string;
  password: string;
}

interface FormErrors {
  name?: string;
  email?: string;
  password?: string;
}

export default function SignupPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    name: '',
    email: '',
    password: '',
  });

  const [errors, setErrors] = useState<FormErrors>({});

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = (): FormErrors => {
    const newErrors: FormErrors = {};
    const passwordRegex = /^(?=.*[A-Z])(?=.*[!@#$%^&*(),.?":{}|<>]).*$/;

    if (!formData.name.trim()) newErrors.name = 'Name is required';

    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Email is invalid';
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    } else if (!passwordRegex.test(formData.password)) {
      newErrors.password = 'Must include at least one uppercase letter and one special character';
    }

    return newErrors;
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const newErrors = validateForm();

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // TODO: wire up to backend once signup flow (register/verify-email) is ready
    console.log('Form submitted:', formData);
  };

  return (
    <div className="h-[100dvh] w-full bg-cover bg-center flex items-center justify-center p-4 sm:p-8 relative overflow-hidden"
    style={{ backgroundImage: "url('/images/background.png')" }}>
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

            <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
              <div>
                <label className="block text-xs font-medium text-amber-900 mb-1">Name</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  className={`w-full px-4 py-3 bg-white border border-amber-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-600 ${errors.name ? 'ring-2 ring-red-500' : ''}`}
                  placeholder="Enter your full name"
                />
                {errors.name && (
                  <p className="mt-1 text-sm text-red-600">{errors.name}</p>
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
                  className="w-full py-4 bg-green-700 text-white rounded-full font-bold hover:bg-green-800 transition-colors"
                >
                  Create Account
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