export type Role = "user" | "assistant";
export type MessageStatus = "done" | "streaming" | "thinking";
export type WebSearchPhase = "idle" | "thinking" | "searching";

export interface Citation {
  id: string;
  title: string;
  source: string;
  url: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  status: MessageStatus;
  /** True when this assistant reply was grounded with web search. */
  webSearched?: boolean;
  citations?: Citation[];
  /** Set when generation failed — render an inline error instead of crashing. */
  error?: string;
  /**
   * User message: attached image (downscaled data URL) the model saw.
   * Assistant message: URL of a generated image (/api/image-gen proxy).
   */
  imageUrl?: string;
  /** Prompt used for a generated image — enables regenerate/retry. */
  imagePrompt?: string;
  /** True while an image is being generated → render the skeleton box. */
  imagePending?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

export interface Suggestion {
  id: string;
  icon: string; // lucide icon name resolved in the welcome component
  title: string;
  prompt: string;
}
