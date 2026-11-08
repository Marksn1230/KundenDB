import type { NextConfig } from "next";
import path from 'node:path';
const nextConfig: NextConfig = {
  poweredByHeader: false,
  distDir: process.env.NEXT_DIST_DIR || '.next',
  turbopack: { root: path.resolve('.') },
  serverExternalPackages: ['exceljs','pg'],
  logging: {incomingRequests:{ignore:[/\/auth\//,/\/api\/auth\//]},serverFunctions:false},
  async rewrites(){return process.env.OIDC_PROXY_ENABLED==='true'?[{source:'/auth/:path*',destination:(process.env.OIDC_INTERNAL_URL||'http://127.0.0.1:8080/auth').replace(/\/$/,'')+'/:path*'}]:[];},
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ...(process.env.APP_URL?.startsWith('https:') ? [{key:'Strict-Transport-Security',value:'max-age=31536000; includeSubDomains'}] : []),
    ] }];
  },
};
export default nextConfig;
