try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local is optional (e.g. in CI, where DATABASE_URL is injected directly)
}
