import OpenAI from "openai";
import type { Config } from "../config.js";
import type { Message, ToolSchema } from "./types.js";

export class LLMClient {
  private client: OpenAI;
  private model: string;

  constructor(config: Config) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || undefined,
    });
    this.model = config.model;
  }

  async chat(messages: Message[], tools?: ToolSchema[]) {
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools,
    });
    return res.choices[0].message;
  }
}
