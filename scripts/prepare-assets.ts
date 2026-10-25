import fs from "node:fs";
fs.mkdirSync("public/vendor/maplibre", { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"])
  fs.copyFileSync(
    "node_modules/maplibre-gl/dist/" + file,
    "public/vendor/maplibre/" + file,
  );
fs.copyFileSync(
  "node_modules/maplibre-gl/LICENSE.txt",
  "public/vendor/maplibre/LICENSE.txt",
);
// Local detector experiments use these assets. Production scanning uses Gemini.
if (!process.env.VERCEL) {
  fs.mkdirSync("public/vision-runtime", { recursive: true });
  for (const file of fs.readdirSync("node_modules/onnxruntime-web/dist")) {
    if (file === "ort.webgpu.min.mjs" || /^ort-wasm-simd-threaded(?:\.(?:jsep|asyncify|jspi))?\.(?:mjs|wasm)$/.test(file))
      fs.copyFileSync(`node_modules/onnxruntime-web/dist/${file}`, `public/vision-runtime/${file}`);
  }
  fs.copyFileSync("node_modules/onnxruntime-web/README.md", "public/vision-runtime/README.md");
}
