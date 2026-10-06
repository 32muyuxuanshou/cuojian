declare module '*?url' {
  const url: string;
  export default url;
}
interface ImportMetaEnv {
  readonly VITE_RELAY_API_KEY?:string;
  readonly VITE_RELAY_BASE_URL?:string;
  readonly VITE_RELAY_MODEL?:string;
  readonly VITE_RELAY_TRANSPORT?:string;
}
interface ImportMeta {readonly env:ImportMetaEnv;}
