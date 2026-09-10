import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Nav } from "@/components/nav";
import { getCurrentUser } from "@/lib/auth/session";
import { cookies } from "next/headers";
import type { Theme } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: { default: "imta", template: "%s · imta" },
  description: "Scheduling for the open social web. Sign in with your Atmosphere account, share your availability, book meetings.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser().catch(() => null);
  const raw = (await cookies()).get("imta_theme")?.value;
  const theme: Theme = raw === "light" || raw === "dark" ? raw : "system";
  return (
    <html lang="en" className="h-full antialiased" data-theme={theme === "system" ? undefined : theme}>
      <body className="flex min-h-full flex-col">
        <Nav user={user} theme={theme} />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
        <footer className="border-t border-border py-6 text-center text-xs text-muted">
          <a href="/privacy" className="hover:underline">Privacy</a> · <a href="/terms" className="hover:underline">Terms</a> · Open source under MIT ·{" "}
          <a href="https://github.com/bravestarfish/imta" className="hover:underline">Source</a>
        </footer>
      </body>
    </html>
  );
}
