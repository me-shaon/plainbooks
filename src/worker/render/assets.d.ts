// Vite inlines `?inline` imports as data URI strings.
declare module "*.woff2?inline" {
  const dataUri: string;
  export default dataUri;
}
