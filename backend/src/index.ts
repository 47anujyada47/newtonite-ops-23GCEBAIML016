import { createApp } from './app';
import { OutboxWorker } from './services/outboxWorker';

const PORT = process.env.PORT || 4000;
const app = createApp();

const server = app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Newtonite Operations API running on http://localhost:${PORT}`);
  console.log(`📡 Healthcheck: http://localhost:${PORT}/health`);
  console.log(`=======================================================`);

  // Start transactional outbox worker background loop
  OutboxWorker.start(2500);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, closing server and outbox worker...');
  OutboxWorker.stop();
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
});
