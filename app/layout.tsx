import { type Metadata } from "next";
import { siteConfig } from "@/config/site";
import "@/styles/globals.css";
import Toaster from "@/components/toast";
import QueryProvider from "@/utils/provider";

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s - ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: [
    "NEXUS",
    "Next.js",
    "React",
    "Tailwind CSS",
    "Server Components",
    "Radix UI",
    "TanStack",
  ],
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteConfig.url,
    title: siteConfig.name,
    description: siteConfig.description,
    siteName: siteConfig.name,
  },
};

const RootLayout = ({ children }: { children: React.ReactNode }) => {
  const content = <QueryProvider>
    <Toaster position="bottom-left" reverseOrder={false} containerStyle={{ height: "92vh", marginLeft: "3vw" }} />
    {children}
  </QueryProvider>;
  return (
    <html lang="en">
      <head />
      <body>
        {content}
      </body>
    </html>
  );
};

export default RootLayout;
