import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Tool, toolError } from "@vietor/agent-core";
import { runProcess, findCommands, CALL_TIMEOUT_MS, NO_OUTPUT } from "@vietor/agent-core/util";

const LANGUAGE_SPECS = {
  javascript: {
    commands: ["node", "bun"],
    extension: "js",
    args: (filepath: string) => [filepath],
  },
  python: {
    commands: ["python", "python3"],
    extension: "py",
    args: (filepath: string) => ["-u", filepath],
  },
};

interface LanguageConfig {
  command: string;
  extension: string;
  args: (filepath: string) => string[];
}

const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {};
for (const [language, spec] of Object.entries(LANGUAGE_SPECS)) {
  const command = findCommands(spec.commands)[0];
  if (command) LANGUAGE_CONFIGS[language] = { command, extension: spec.extension, args: spec.args };
}

const DESCRIPTION = `Execute ${Object.keys(LANGUAGE_CONFIGS)
  .map((name) => name[0].toUpperCase() + name.slice(1))
  .join(" or ")} script in a local environment.

Use this for throwaway code — quick computations, data transformation, or experiments — instead of writing files into the project or assembling a Shell one-liner. The script is saved to a temporary directory that is removed after execution, and runs with the working directory as cwd, so relative paths work. Print results to stdout; stdin is unavailable. Do not include a shebang line or interpreter flags in the script source.`;

export const localScriptTool: Tool = {
  name: "LocalScript",
  description: DESCRIPTION,
  parameters: {
    type: "object",
    properties: {
      language: {
        type: "string",
        enum: Object.keys(LANGUAGE_CONFIGS),
        description: "Programming language of the script",
      },
      script: { type: "string", description: "The source code to execute. No shebang line or interpreter flags; print results to stdout." },
    },
    required: ["language", "script"],
  },
  async execute(args, ctx) {
    const language = args.language as string;
    const config = LANGUAGE_CONFIGS[language];
    if (!config) {
      return toolError(`unsupported language: ${language}`);
    }
    const script = args.script;
    if (typeof script !== "string") {
      return toolError("script argument must be a string");
    }

    const tempDir = await mkdtemp(join(tmpdir(), "local-script-"));
    const filepath = join(tempDir, `script.${config.extension}`);

    try {
      await writeFile(filepath, script, "utf8");

      const r = await runProcess(
        config.command,
        config.args(filepath),
        { cwd: ctx.cwd, timeout: CALL_TIMEOUT_MS },
        ctx.signal,
      );
      if (r.status === 0 && !r.error) {
        return { content: r.stdout || NO_OUTPUT };
      }
      const parts = [r.stdout, r.stderr, r.error?.message].filter(Boolean);
      return toolError(parts.join("\n") || NO_OUTPUT);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  },
  argSummaryKeys: ["language"],
};
