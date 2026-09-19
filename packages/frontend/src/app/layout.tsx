import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "@/styles/globals.css";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { WalletProvider } from "@/components/wallet/WalletProvider";
import { LocaleProvider } from "@/i18n/LocaleProvider";

const dmSans = DM_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "HARVEST — Pre-harvest finance without revealing your yield",
  description:
    "Pre-harvest advances for growers: a zero-knowledge proof shows the harvest clears a threshold without disclosing the real figure. On Stellar, with local-currency anchors.",
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="tr" className={dmSans.variable}>
      <body className="font-sans antialiased bg-harvest-cream text-stone-900 min-h-screen flex flex-col selection:bg-harvest-wheat selection:text-harvest-earth">
        <LocaleProvider>
          <WalletProvider>
            <Navbar />
            <main className="flex-1">{children}</main>
            <Footer />
          </WalletProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
