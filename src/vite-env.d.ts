declare module "virtual:json-manifest" {
  const manifest: Record<string, string>;
  export const lazy: Record<string, string>;
  export default manifest;
}
