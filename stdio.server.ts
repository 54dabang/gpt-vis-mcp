import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./app.ts";

const transport = new StdioServerTransport();
const { cleanupClients, server } = await createMcpServer();

transport.onclose = async () => {
  await cleanupClients();
  console.log("🔌 Transport closed, cleaning up dependent clients...");
};

await server.connect(transport);
