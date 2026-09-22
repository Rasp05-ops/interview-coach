import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Interview Coach — AI Mock Interviews",
  description: "AI mock interviews grounded in your resume and JD. Powered by Groq Llama + Whisper.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <main className="min-h-screen px-4 py-5 sm:px-8 sm:py-7">{children}</main>
      </body>
    </html>
  );
}
