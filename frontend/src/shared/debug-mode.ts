/** Debug commands are available only while running through the Vite development server. */
export function isDebugMode(): boolean {
  return Boolean(process.env.VITE_DEV_SERVER_URL);
}
