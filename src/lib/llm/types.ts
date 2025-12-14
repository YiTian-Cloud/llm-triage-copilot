export type ChatMessage = {
    role: "system" | "user" | "assistant";
    content: string;
  };
  

  
  export type ChatOptions = {
    primaryModel?: string;
    fallbackModel?: string;
  };
  
  export type ChatResult = {
    text: string;
    usedModel?: string;
    raw?: unknown;
    trace?: {
      attempts?: Array<{
        model: string;
        attempt: number;
        status: number;
        latencyMs: number;
        note?: string;
      }>;
      usage?: any;
    };
  };
  
  export interface LLMProvider {
    chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
  }
  