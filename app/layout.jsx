import "./globals.css";
import "./polish.css";
import "./ai-tools.css";
import "./workbench.css";
import "./brand.css";
import "./workspace.css";
import "./agents.css";
import "./studio.css";

export const metadata = {
  title: "Контур — управление проектами",
  description: "Self-hosted система управления проектами, задачами и процессами.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Контур", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/kontur-192.png", apple: "/icons/kontur-192.png" },
};

export const viewport = { themeColor: "#ffffff", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
