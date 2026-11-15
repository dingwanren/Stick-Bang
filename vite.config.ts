import { defineConfig } from "vite";

// base 用相对路径:GitHub Pages 项目页部署在 <user>.github.io/<repo>/ 子路径下也能正常加载
export default defineConfig({
  base: "./",
});
