import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppProvider } from "@/app/app-provider";
import { createAppQueryClient } from "@/app/query-client";
import { createAppRouter } from "@/app/router";
import { applyVisualSystem } from "@/app/visual-system";
import "@/styles/index.css";

applyVisualSystem(window.location.pathname);

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
