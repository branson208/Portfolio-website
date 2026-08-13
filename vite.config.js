import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// A CNAME means the site is served from a custom domain root, not /<repo>/.
const hasCustomDomain = existsSync(fileURLToPath(new URL("./CNAME", import.meta.url)));
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base = repositoryName && !hasCustomDomain
  ? repositoryName.endsWith(".github.io")
    ? "/"
    : `/${repositoryName}/`
  : "/";

export default defineConfig({
  plugins: [react()],
  base,
  publicDir: "Images"
});
