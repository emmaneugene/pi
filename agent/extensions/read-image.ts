import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { complete } from "@earendil-works/pi-ai/compat";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";

const VISION_PROVIDER = "openai-codex";
const VISION_MODEL = "gpt-5.4-mini";
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const TOOL_NAME = "read_image";

const modelSupportsImages = (model: Model | undefined): boolean =>
  model?.input?.includes("image") ?? false;

const mimeForPath = (filePath: string): string => {
  switch (path.extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
};

const resolveImagePath = (cwd: string, imagePath: string): string => {
  if (imagePath.startsWith("~")) {
    return path.join(process.env.HOME ?? "", imagePath.slice(1));
  }
  return path.isAbsolute(imagePath) ? imagePath : path.resolve(cwd, imagePath);
};

async function loadImage(cwd: string, imagePath: string) {
  const absolutePath = resolveImagePath(cwd, imagePath);
  const info = await stat(absolutePath);

  if (!info.isFile()) {
    throw new Error(`${imagePath} is not a file`);
  }
  if (info.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `${imagePath} is ${(info.size / 1024 / 1024).toFixed(1)}MB; max is ${MAX_IMAGE_BYTES / 1024 / 1024}MB`,
    );
  }

  return {
    absolutePath,
    content: {
      type: "image" as const,
      data: await readFile(absolutePath, "base64"),
      mimeType: mimeForPath(absolutePath),
    },
  };
}

async function askVisionModel(
  ctx: ExtensionContext,
  prompt: string,
  imagePaths: string[],
  signal?: AbortSignal,
): Promise<string> {
  const model = ctx.modelRegistry.find(VISION_PROVIDER, VISION_MODEL);
  if (!model) {
    throw new Error(
      `Vision model not found: ${VISION_PROVIDER}/${VISION_MODEL}`,
    );
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    throw new Error(
      `Auth failed for ${VISION_PROVIDER}/${VISION_MODEL}: ${auth.error}`,
    );
  }
  if (!auth.apiKey) {
    throw new Error(
      `No API key or login token available for ${VISION_PROVIDER}`,
    );
  }

  const loadedImages = await Promise.all(
    imagePaths.map((p) => loadImage(ctx.cwd, p)),
  );

  const response = await complete(
    model,
    {
      messages: [
        {
          role: "user" as const,
          timestamp: Date.now(),
          content: [
            { type: "text" as const, text: prompt },
            ...loadedImages.map((image) => image.content),
          ],
        },
      ],
    },
    {
      apiKey: auth.apiKey,
      headers: auth.headers,
      maxTokens: 4096,
      signal,
    },
  );

  const text = response.content
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();

  if (!text) {
    throw new Error(`${VISION_PROVIDER}/${VISION_MODEL} returned no text`);
  }

  return text;
}

export default function (pi: ExtensionAPI) {
  const syncReadImageTool = (model: Model | undefined) => {
    const activeTools = pi.getActiveTools();
    const isActive = activeTools.includes(TOOL_NAME);

    if (modelSupportsImages(model)) {
      if (isActive) {
        pi.setActiveTools(activeTools.filter((name) => name !== TOOL_NAME));
      }
    } else {
      if (!isActive) {
        pi.setActiveTools([...activeTools, TOOL_NAME]);
      }
    }
  };

  pi.registerTool({
    name: TOOL_NAME,
    label: "Read Image",
    description:
      "Ask a vision model to read one or more images and answer questions. Use this tool when you need information from screenshots, diagrams, photos or other images.",
    parameters: Type.Object({
      paths: Type.Array(Type.String(), {
        description: "Relative or absolute paths to image files.",
      }),
      prompt: Type.String({
        description: "Questions or instructions for the vision model.",
      }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const imagePaths = params.paths;

      if (imagePaths.length === 0) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "read_image requires at least one path in `paths`.",
            },
          ],
          details: {},
        };
      }

      const answer = await askVisionModel(
        ctx,
        params.prompt,
        imagePaths,
        signal,
      );
      return {
        content: [{ type: "text", text: answer }],
        details: {
          provider: VISION_PROVIDER,
          model: VISION_MODEL,
          paths: imagePaths,
        },
      };
    },
  });

  pi.on("session_start", (_event, ctx) => {
    syncReadImageTool(ctx.model);
  });

  pi.on("model_select", (event) => {
    syncReadImageTool(event.model);
  });

  pi.on("before_agent_start", (_event, ctx) => {
    syncReadImageTool(ctx.model);
  });
}
