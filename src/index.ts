import Server from "./server";

const server = new Server();

// Start the server
server.start().catch((error) => {
  console.error("Failed to start the application:", error);
  process.exit(1);
});
