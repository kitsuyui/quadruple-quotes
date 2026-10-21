import { createRoot } from "react-dom/client";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import { App } from "./App";
import { browserFiles } from "./browser-files";
import { createBrowserHost } from "./browser-host";
import { createDesktopHost, isDesktopRuntime } from "./desktop-host";
import { RECOVERY_PREFIX } from "./recovery";
import "./styles.css";

const element = document.getElementById("root");
if (!element) throw new Error("The application root is missing.");
const root = createRoot(element);

root.render(
  <div className="loading-screen">
    <span className="loading-mark">““</span>
    <p>Opening your workspace…</p>
  </div>,
);

(isDesktopRuntime() ? createDesktopHost() : createBrowserHost())
  .then((host) => {
    root.render(<App host={host} />);
    window.addEventListener(
      "pagehide",
      (event) => {
        if (!event.persisted) host.repository.dispose();
      },
      { once: true },
    );
  })
  .catch(() => {
    root.render(
      <div className="loading-screen">
        <span className="loading-mark">““</span>
        <h1>We couldn’t open your workspace.</h1>
        <p>
          Your saved texts have been left untouched.
          <br />
          Check that browser storage is available, then try reloading.
        </p>
        <button
          type="button"
          className="primary"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => {
            try {
              const raw =
                window.localStorage.getItem("quadruple-quotes.workspace.v1") ??
                "";
              browserFiles.download(
                "quadruple-quotes-workspace-raw.json",
                raw,
                "application/json",
              );
            } catch {
              window.alert(
                "Browser storage could not be read. Existing data has not been changed.",
              );
            }
          }}
        >
          Download raw workspace data
        </button>
        <button
          type="button"
          onClick={() => {
            try {
              const records: Record<string, string | null> = {};
              for (let index = 0; index < window.localStorage.length; index++) {
                const key = window.localStorage.key(index);
                if (key?.startsWith(RECOVERY_PREFIX))
                  records[key] = window.localStorage.getItem(key);
              }
              browserFiles.download(
                "quadruple-quotes-recovery-raw.json",
                JSON.stringify({ records }, null, 2),
                "application/json",
              );
            } catch {
              window.alert(
                "Browser recovery storage could not be read. Existing data has not been changed.",
              );
            }
          }}
        >
          Download raw recovery data
        </button>
      </div>,
    );
  });
