import localFont from "next/font/local";

/**
 * TID UI – Ruters profilfont. Offentlig tilgjengelig i vektene 400 og 500;
 * 500 brukes som utheving.
 */
export const tid = localFont({
  src: [
    { path: "../../public/fonts/TIDUI-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/TIDUI-Medium.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-tid",
  display: "swap",
  fallback: ["system-ui", "Segoe UI", "sans-serif"],
});
