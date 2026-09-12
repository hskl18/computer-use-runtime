import type { Action, Inputs, Target } from "../core/contracts.ts";

export interface Observation {
  url: string;
  frameUrls: string[];
  text: string;
  image?: string;
}
export interface Surface {
  readonly sessionId: string;
  open(url: string, headless: boolean): Promise<void>;
  setHuman(value: boolean): void;
  observe(withImage?: boolean): Promise<Observation>;
  signature(): Promise<string>;
  execute(action: Action, inputs: Inputs): Promise<string | number | undefined>;
  assertState(): void;
  hasHeading(name: string): Promise<boolean>;
  hasDialog(): Promise<boolean>;
  reload(): Promise<void>;
  screenshot(path: string): Promise<void>;
  isVisible(target: Target): Promise<boolean>;
  url(): string;
  close(): Promise<void>;
}
