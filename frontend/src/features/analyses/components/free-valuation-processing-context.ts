import { createContext } from "react";

export interface FreeValuationProcessingOptions {
  readonly reviewKey?: string;
  readonly heading?: string;
  readonly description?: string;
  readonly phase?: "preparing" | "connecting" | "reviewing" | "opening";
  readonly vehicle?: string;
  readonly notice?: string | null;
  readonly error?: string | null;
  readonly onRetry?: () => void;
  readonly retryDisabled?: boolean;
  readonly development?: boolean;
  readonly fullScreen?: boolean;
}

export const FreeValuationProcessingContext = createContext<{
  inline?: boolean;
  show: (owner: symbol, options: FreeValuationProcessingOptions) => void;
  hide: (owner: symbol) => void;
} | null>(null);

export const InlineValuationProcessingContext = createContext<FreeValuationProcessingOptions | null>(null);
