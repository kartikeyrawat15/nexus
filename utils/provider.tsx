"use client";

import React, { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RepositoryProvider } from "../context/repository-provider";

function Providers({ children }: React.PropsWithChildren) {
  const [isBrowser, setIsBrowser] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") setIsBrowser(true);
  }, []);

  const [client] = useState(() => new QueryClient());

  if (!isBrowser) return <div className="nx-boot" role="status">NEXUS · Opening your workspace…</div>;
  return (
    <QueryClientProvider client={client}>
      <RepositoryProvider>{children}</RepositoryProvider>
    </QueryClientProvider>
  );
}

export default Providers;
