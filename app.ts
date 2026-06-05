/**
 * GPT-Vis MCP Server
 *
 * A local wrapper for antvis/mcp-server-chart that generates charts locally
 * without external server dependencies.
 */

import { render } from "@yaonyan/gpt-vis-ssr-napi-rs";
import { ComposableMCPServer, composeMcpDepTools } from "@mcpc/core";
import { generateId, jsonSchema } from "ai";
import { access, constants, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { CHART_TYPE_MAP, CHART_TYPE_UNSUPPORTED } from "./constant.ts";

/**
 * Configuration for the chart rendering service
 */
export interface ServerConfig {
  /** Directory path where generated images will be saved */
  renderedImagePath: string;
  /** Base URL for accessing images via web server (optional) */
  renderedImageHostPath?: string;
}

/**
 * Chart generation options
 */
export interface ChartOptions {
  type: string;
  data: Record<string, unknown>;
  [key: string]: unknown; // Allow additional properties
}

/**
 * Chart generation result
 */
export interface ChartResult {
  isError: boolean;
  content: Array<{
    type: "text";
    text: string;
  }>;
}

/**
 * HTTP API Response
 */
export interface ChartResponse {
  success: boolean;
  resultObj?: string;
  errorMessage?: string;
}

/**
 * MCP Tool definition
 */
interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// Server configuration with environment variable support
export const config: ServerConfig = {
  renderedImagePath: process.env.RENDERED_IMAGE_PATH ??
    join(tmpdir(), "gpt-vis-charts"),
  renderedImageHostPath: process.env.RENDERED_IMAGE_HOST_PATH,
};

/**
 * Initialize the chart generation directory
 */
export async function initializeImageDirectory(): Promise<void> {
  console.log(`🔍 Checking image directory: ${config.renderedImagePath}`);

  try {
    // Check if directory exists
    await access(config.renderedImagePath, constants.F_OK);
    console.log("✅ Image directory already exists");
  } catch {
    // Directory doesn't exist, create it
    console.log("📁 Image directory does not exist, creating...");
    try {
      await mkdir(config.renderedImagePath, { recursive: true });
      console.log("✅ Image directory created successfully");
    } catch (error) {
      console.error(
        `❌ Failed to create directory ${config.renderedImagePath}:`,
        error,
      );
      throw new Error(
        `Failed to initialize image directory: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/**
 * Generate a unique filename for the chart image
 */
export function generateImageFilename(): string {
  const id = generateId(8);
  const timestamp = Date.now();
  return `chart_${timestamp}_${id}.png`;
}

/**
 * Generate the appropriate response URL/path for the generated image
 * @param filename - The generated filename
 * @param forHttp - Whether this is for HTTP response (returns relative URL) or MCP (returns full path)
 */
export function generateImageResponse(
  filename: string,
  forHttp = false,
): string {
  if (config.renderedImageHostPath) {
    return `${config.renderedImageHostPath}/${filename}`;
  }

  if (forHttp) {
    // For HTTP server mode, return relative URL
    return `/charts/${filename}`;
  }

  // For MCP mode, return full path
  return join(config.renderedImagePath, filename);
}

/**
 * Generate a chart with the given options (MCP format result)
 */
export async function generateChart(
  options: ChartOptions,
): Promise<ChartResult> {
  const startTime = Date.now();
  console.log(`🎨 Starting chart generation: type=${options.type}`);

  try {
    // Render the chart using GPT-Vis SSR
    console.log("🔄 Rendering chart with GPT-Vis SSR...");
    const vis = await render(options);

    // Generate filename and full path
    const filename = generateImageFilename();
    const fullPath = join(config.renderedImagePath, filename);
    console.log(`💾 Saving chart to: ${filename}`);

    // Export chart to file
    vis.exportToFile(fullPath, {});

    const imageUrl = generateImageResponse(filename);
    const duration = Date.now() - startTime;

    console.log(
      `✅ Chart generated successfully in ${duration}ms: ${imageUrl}`,
    );

    return {
      isError: false,
      content: [
        {
          type: "text",
          text: config.renderedImageHostPath
            ? `Chart generated successfully! Access it at: ${imageUrl}`
            : `Chart generated and saved to: ${imageUrl}`,
        },
      ],
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `❌ Chart generation failed after ${duration}ms:`,
      errorMessage,
    );

    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Failed to generate chart: ${errorMessage}`,
        },
      ],
    };
  }
}

/**
 * Generate a chart with the given options (HTTP format result)
 */
export async function generateChartForHttp(
  options: ChartOptions,
): Promise<ChartResponse> {
  try {
    const { type, data, ...restOptions } = options;

    // Validate chart type
    if (!type) {
      throw new Error("Chart type is required");
    }

    // Prepare render options
    const renderOptions = {
      type,
      data,
      ...restOptions,
    };

    console.log(`🎨 Starting chart generation: type=${type}`);
    // Render the chart using GPT-Vis SSR
    const vis = await render(renderOptions);
    console.log("✅ Successfully rendered chart with GPT-Vis SSR");

    // Generate filename and full path
    const filename = generateImageFilename();
    const fullPath = join(config.renderedImagePath, filename);

    // Export chart to file
    vis.exportToFile(fullPath, {});

    const resultObj = generateImageResponse(filename, true);

    return {
      success: true,
      resultObj,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Chart generation failed:`, errorMessage);

    return {
      success: false,
      errorMessage,
    };
  }
}

/**
 * Create the MCP server and compose tools from the upstream chart server.
 *
 * Keep this lazy so the HTTP SSR server can import the chart helpers without
 * starting the MCP stdio dependency graph before Deno.serve() is available.
 */
export async function createMcpServer(): Promise<{
  server: ComposableMCPServer;
  cleanupClients: () => Promise<void>;
}> {
  console.log("🚀 Initializing GPT-Vis MCP Server...");
  console.log(`📁 Image directory: ${config.renderedImagePath}`);
  if (config.renderedImageHostPath) {
    console.log(`🌐 Host path: ${config.renderedImageHostPath}`);
  }

  try {
    await initializeImageDirectory();
    console.log("✅ Image directory initialized successfully");
  } catch (error) {
    console.error("❌ Startup failed:", error);
    process.exit(1);
  }

  console.log("🔧 Composing MCP tools from upstream chart server...");
  const { tools, cleanupClients } = await composeMcpDepTools({
    mcpServers: {
      "mcp-server-chart": {
        command: "npx",
        args: ["-y", "@antv/mcp-server-chart@0.7.1"],
      },
    },
  );
  console.log(
    `📊 Discovered ${Object.keys(tools).length} tools from upstream server`,
  );

  console.log("🏗️  Creating MCP server instance...");
  const server = new ComposableMCPServer(
    {
      name: "gpt-vis-mcp",
      version: "0.0.5",
    },
    { capabilities: { tools: {} } },
  );
  console.log("✅ MCP server instance created successfully");

  const registerToolWithLocalExecutor = (tool: MCPTool): void => {
    const { name, description, inputSchema } = tool;

    if (CHART_TYPE_UNSUPPORTED.includes(name)) {
      console.log(`⚠️  Skipping unsupported chart type: ${name}`);
      return;
    }

    console.log(`🔧 Registering tool: ${name}`);

    server.tool(
      name,
      description,
      jsonSchema(inputSchema),
      async (context: unknown): Promise<ChartResult> => {
        console.log(`🚀 Executing tool: ${name}`);

        try {
          const { data } = context as { data: Record<string, unknown> };
          console.log(
            `📝 Processing data for ${name}:`,
            Object.keys(data).length,
            "fields",
          );

          const type = CHART_TYPE_MAP[name as keyof typeof CHART_TYPE_MAP];

          if (!type) {
            throw new Error(`Unknown chart type for tool: ${name}`);
          }

          const options: ChartOptions = {
            type,
            data,
          };

          return await generateChart(options);
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          console.error(`❌ Tool execution failed for ${name}:`, errorMessage);

          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error executing ${name}: ${errorMessage}`,
              },
            ],
          };
        }
      },
    );
  };

  const supportedTools = (Object.values(tools) as MCPTool[]).filter(
    (tool: MCPTool) => !CHART_TYPE_UNSUPPORTED.includes(tool.name),
  );

  console.log(
    `📦 Registering ${supportedTools.length} supported tools out of ${
      Object.keys(tools).length
    } total tools`,
  );
  console.log(
    `🚫 Skipping ${CHART_TYPE_UNSUPPORTED.length} unsupported tools:`,
    CHART_TYPE_UNSUPPORTED.join(", "),
  );

  supportedTools.forEach(registerToolWithLocalExecutor);

  console.log("🎉 GPT-Vis MCP Server initialization completed successfully!");
  console.log(`🔧 Total registered tools: ${supportedTools.length}`);
  console.log("🟢 Server is ready to handle chart generation requests");

  return { server, cleanupClients };
}
