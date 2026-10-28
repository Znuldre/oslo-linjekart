import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Linjekart for T-bane og trikk i Oslo",
  robots: { index: false },
};

/** Statisk eksport har ingen middleware: velg språk i nettleseren og gå videre. */
const redirectScript = `(function(){try{var stored=localStorage.getItem("lang");var nav=(navigator.language||"nb").toLowerCase();var lang=stored==="en"||stored==="nb"?stored:(nav.indexOf("en")===0?"en":"nb");var base=document.querySelector('meta[name="x-base-path"]').getAttribute("content")||"";location.replace(base+"/"+lang+"/"+location.search+location.hash);}catch(e){location.replace("/nb/");}})();`;

export default function RootPage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  return (
    <>
      <meta name="x-base-path" content={basePath} />
      <script dangerouslySetInnerHTML={{ __html: redirectScript }} />
      <noscript>
        <p style={{ padding: "2rem", fontFamily: "system-ui" }}>
          <a href={`${basePath}/nb/`}>Norsk</a> · <a href={`${basePath}/en/`}>English</a>
        </p>
      </noscript>
    </>
  );
}
