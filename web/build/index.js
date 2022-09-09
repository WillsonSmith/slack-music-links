import { build as esbuild } from "esbuild";
import { buildHtml } from "./html/index.js";
import { buildCss } from "./css/index.js";
import { copyStatic } from "./static/index.js";

import { readdir } from "fs/promises";

let [...argus] = process.argv;
let flags = {
  watch: argus.includes(`--watch`),
  minify: argus.includes(`--minify`),
};

const webPath = `./web`;
const distPath = `./web/dist`;

console.log(`BUILD • HTML • ${flags.watch ? `WATCHING` : `BUILDING`}`);
buildHtml(
  [
    {
      location: `${webPath}/index.html`,
      destination: `${distPath}/index.html`,
      ...{ flags },
    },
  ].map((config) => ({ ...config, ...flags }))
);

// Javascript
readdir(`${webPath}/javascript/routes`).then((files) => {
  const bundles = files
    .filter((file) => file.endsWith(`.js`))
    .map((file) => {
      return `${webPath}/javascript/routes/${file}`;
    });

  esbuild({
    bundle: true,
    entryPoints: [`${webPath}/javascript/boot.js`, ...bundles],
    format: `esm`,
    minify: true,
    outdir: distPath,
    sourcemap: true,
    splitting: true,
    watch: flags.watch,
  });
});

// Static assets
const staticConfig = [
  {
    location: `./node_modules/@shoelace-style/shoelace`,
    destination: `${distPath}/vendor/modules/shoelace`,
  },
  {
    location: `${webPath}/service-worker.js`,
    destination: `${distPath}/service-worker.js`,
  },
  {
    location: `${webPath}/static`,
    destination: `${distPath}/static`,
  },
  {
    location: `./shared/fonts`,
    destination: `${distPath}/fonts`,
  },
].map((config) => ({ ...config, ...flags }));

console.log(`BUILD • STATIC • ${flags.watch ? `WATCHING` : `BUILDING`}`);
copyStatic(staticConfig);

const cssConfig = [
  {
    location: `${webPath}/css/main.css`,
    destination: `${distPath}/css/main.css`,
  },
].map((config) => ({ ...config, ...flags }));

console.log(`BUILD • CSS • ${flags.watch ? `WATCHING` : `BUILDING`}`);
buildCss(cssConfig);
