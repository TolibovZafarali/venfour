import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppProvider } from "@/app/app-provider";
import { createAppQueryClient } from "@/app/query-client";
import { createAppRouter } from "@/app/router";
import "@/styles/index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Application root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <AppProvider
      queryClient={createAppQueryClient()}
      router={createAppRouter()}
    />
  </StrictMode>,
);
