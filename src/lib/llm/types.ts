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
  };
  
  export interface LLMProvider {
    chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
  }
  