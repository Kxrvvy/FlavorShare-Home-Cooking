import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Applied to every route. Deliberately not a Content-Security-Policy:
  // Next.js relies on inline scripts to hydrate the page, and a CSP wide
  // enough to allow those without also allowing arbitrary inline script
  // needs testing against the real app rather than a guessed policy - not
  // done here, so not shipped here.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Stops a browser from guessing a response's content type from
          // its bytes rather than trusting the Content-Type header - the
          // classic route from "this is actually HTML" to script execution
          // on a response meant to be plain data.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Refuses to let this site be framed at all, so nothing else can
          // put an invisible copy of it over a fake UI and capture clicks
          // meant for it (clickjacking).
          { key: "X-Frame-Options", value: "DENY" },
          // Sends the referring page's origin, never its full path/query,
          // and nothing at all on a downgrade to plain http - a recipe URL
          // reveals which site sent the click without also leaking a
          // signed-in page's full URL (a search term, an id in the path)
          // to whatever it links out to.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Turns off browser features this app never uses. An embedded
          // page (there shouldn't be one, given X-Frame-Options above, but
          // browser support for that header is not universal) inherits
          // none of them either way.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // Ignored by browsers over plain http - the directive only takes
          // effect once a request actually arrives over https - so this is
          // inert in local dev and starts mattering the moment the real
          // deployment does. Same starting value and reasoning as
          // backend/settings.py's SECURE_HSTS_SECONDS: short at first
          // because browsers cache and enforce this for the full duration,
          // refusing plain http entirely until it expires.
          {
            key: "Strict-Transport-Security",
            value: "max-age=3600; includeSubDomains",
          },
        ],
      },
    ];
  },

  images: {
    remotePatterns: [
      // Cloudinary-hosted uploads - recipes/models.py's Image.url. Wildcarded
      // to any cloud name, since that is a per-deployment setting
      // (CLOUDINARY_CLOUD_NAME) rather than something fixed here.
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
      // TheMealDB's own thumbnails - recipes/sources.py's imported recipes
      // link straight to the provider's photo rather than re-uploading it.
      {
        protocol: "https",
        hostname: "www.themealdb.com",
      },
    ],
  },
};

export default nextConfig;
