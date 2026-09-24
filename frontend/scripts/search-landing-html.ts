import type { Plugin } from "vite";
import { searchLandingMetadata } from "../src/config/search-landing.ts";

export function searchLandingHtml(): Plugin {
  return {
    name: "search-landing-html", enforce: "post",
    generateBundle(_options, bundle) {
      const index = bundle["index.html"];
      if (!index || index.type !== "asset") return;
      const html = String(index.source)
        .replace(/<title>[^<]*<\/title>/, `<title>${searchLandingMetadata.title}</title>`)
        .replace(/(<meta\s+name="description"\s+content=")[^"]*("\s*\/?>)/, `$1${searchLandingMetadata.description}$2`)
        .replace("</head>", `<link rel="canonical" href="${searchLandingMetadata.canonical}" />\n<meta property="og:title" content="${searchLandingMetadata.title}" />\n<meta property="og:description" content="${searchLandingMetadata.description}" />\n<meta property="og:url" content="${searchLandingMetadata.canonical}" />\n<meta property="og:type" content="website" />\n</head>`);
      this.emitFile({ type: "asset", fileName: "total-loss-review.html", source: html });
    },
  };
}
