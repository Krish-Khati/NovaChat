import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "next-themes";
import "./globals.css";

export const metadata: Metadata = {
  title: "NovaChat — Your personal AI, on voice",
  description:
    "NovaChat is a personal ChatGPT-style assistant: streaming chat, Cartesia voice conversation, Google Search grounding, and a multi-conversation memory — in one crafted, dark-first interface.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#131110" },
    { media: "(prefers-color-scheme: light)", color: "#f6f5f1" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body className="h-full antialiased">
        {/* Dark is the default; light and system are first-class */}
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
