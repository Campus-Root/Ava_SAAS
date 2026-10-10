
import 'dotenv/config'
import { createApp } from './server.js';
const PORT = process.env.PORT;
if (!PORT) {
  console.error('PORT environment variable is not set');
  process.exit(1);
}
const { server } = await createApp();
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://0.0.0.0:${PORT}`));

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));