import type { Metadata } from "next";
import { Lato } from "next/font/google";
import "./globals.css";

const lato = Lato({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  variable: "--font-sans",
  display: "swap",
  fallback: ["Helvetica Neue", "Helvetica", "Segoe UI", "Tahoma", "Arial", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Insight",
  description: "Channels and activity for a research lab.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={lato.variable} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('insight-theme')||'system';var dark=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(dark)document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body className={`${lato.className} antialiased`}>{children}</body>
    </html>
  );
}
