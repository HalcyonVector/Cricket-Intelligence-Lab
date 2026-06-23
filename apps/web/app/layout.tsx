import "./globals.css";
export const metadata = { title: "Cricket Intelligence Lab", description: "Ball-by-ball cricket intelligence" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"><body>
      <header className="border-b border-hair px-6 py-3 flex items-center gap-3">
        <span className="font-semibold tracking-tight">Cricket Intelligence Lab</span>
        <span className="text-muted text-sm">· ball-by-ball intelligence</span>
      </header>
      <main className="p-6 max-w-7xl mx-auto">{children}</main>
    </body></html>
  );
}
