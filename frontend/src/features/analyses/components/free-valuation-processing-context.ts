import { createContext } from "react";

export interface FreeValuationProcessingOptions {
  readonly reviewKey?: string;
  readonly phase?: "preparing" | "connecting" | "reviewing" | "opening";
  readonly vehicle?: string;
  readonly notice?: string | null;
  readonly error?: string | null;
  readonly onRetry?: () => void;
  readonly retryDisabled?: boolean;
  readonly development?: boolean;
}

export const FreeValuationProcessingContext = createContext<{
  show: (owner: symbol, options: FreeValuationProcessingOptions) => void;
  hide: (owner: symbol) => void;
} | null>(null);
