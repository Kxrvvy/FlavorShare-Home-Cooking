"use client";

/* Profile and password, for whoever is signed in.
 *
 * Pulled out of the admin Settings page once a matching page for a regular
 * registered user needed the exact same two forms - same fields, same two
 * endpoints (GET/PATCH /api/accounts/me/, POST /api/accounts/password/),
 * same "this signs you out everywhere" behaviour. An admin is a user first,
 * so there was never a reason for these to diverge by role; only where each
 * page puts this component (app/admin/settings vs app/me/settings) differs.
 */

import { useEffect, useState } from "react";

import { changePassword, getMe, updateMe } from "@/features/account/api";
import { ApiError } from "@/features/recipes/api";
import { updateSessionUser } from "@/lib/auth";
import { useSession } from "@/lib/useSession";

const FIELD =
  "rounded-xl border border-rule bg-field px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="font-display text-xs font-semibold uppercase tracking-wide text-muted">
      {children}
    </label>
  );
}

function ProfileForm() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [dietaryPreferences, setDietaryPreferences] = useState("");
  const [loaded, setLoaded] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await getMe();
        if (cancelled) return;
        setUsername(me.username);
        setEmail(me.email);
        setDietaryPreferences(me.dietary_preferences ?? "");
        setLoaded(true);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load your profile.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const updated = await updateMe({
        username: username.trim(),
        email: email.trim(),
        dietary_preferences: dietaryPreferences.trim() || null,
      });
      updateSessionUser(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return <p className="text-sm text-muted">Loading...</p>;
  }

  return (
    <div className="flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Username</Label>
        <input
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setSaved(false);
          }}
          className={FIELD}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Email</Label>
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setSaved(false);
          }}
          className={FIELD}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Dietary preferences</Label>
        <input
          value={dietaryPreferences}
          onChange={(e) => {
            setDietaryPreferences(e.target.value);
            setSaved(false);
          }}
          placeholder="e.g. vegetarian, no shellfish (optional)"
          className={FIELD}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {saved && !error && <p className="text-sm text-maroon">Saved.</p>}

      <button
        type="button"
        disabled={saving || !username.trim() || !email.trim()}
        onClick={save}
        className="self-start rounded-full bg-maroon px-5 py-2.5 font-display text-sm font-semibold text-card disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save profile"}
      </button>
    </div>
  );
}

function PasswordForm() {
  const { signOut } = useSession();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (busy || !currentPassword || !newPassword) return;
    setBusy(true);
    setError("");
    try {
      await changePassword(currentPassword, newPassword);
      // Changing a password revokes every refresh token this account holds,
      // including this session's own - staying "signed in" past this point
      // would just mean the next silent refresh fails with no explanation.
      await signOut();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change your password.");
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Current password</Label>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className={FIELD}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>New password</Label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className={FIELD}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={busy || !currentPassword || !newPassword}
        onClick={submit}
        className="self-start rounded-full border border-rule px-5 py-2.5 font-display text-sm font-semibold text-maroon disabled:opacity-50"
      >
        {busy ? "Changing..." : "Change password"}
      </button>
      <p className="text-xs text-muted">
        This signs you out everywhere, including this session - you&apos;ll need to sign
        back in with the new password.
      </p>
    </div>
  );
}

/** Profile and password, in one column - what app/admin/settings and
 * app/me/settings both render, each inside its own shell and its own
 * heading/intro copy. */
export function AccountSettings() {
  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className="font-display text-lg font-semibold text-ink">Profile</h2>
        <p className="mt-1 max-w-md text-sm text-muted">
          Your own account details - visible only to you.
        </p>
        <div className="mt-4">
          <ProfileForm />
        </div>
      </section>

      <section className="border-t border-rule pt-8">
        <h2 className="font-display text-lg font-semibold text-ink">Password</h2>
        <div className="mt-4">
          <PasswordForm />
        </div>
      </section>
    </div>
  );
}
