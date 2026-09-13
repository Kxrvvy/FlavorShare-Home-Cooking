import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";
import "./globals.css";

/* The Figma file's actual typefaces are unconfirmed - a PNG export carries no
 * font names. Poppins matches the geometric, round-terminal headings and Inter
 * the neutral body copy. Both are declared here and nowhere else, so swapping
 * in the real families once they are known is a change to this file alone. */
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FlavorShare — Home Cooking",
  description:
    "Find, save and share recipes worth cooking. Browse by ingredient, diet or cuisine.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${poppins.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-canvas text-ink">
        {children}
      </body>
    </html>
  );
}
